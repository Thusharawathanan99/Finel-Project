/**
 * Medication Parser
 * Advanced regex-based medication extraction from OCR text.
 * Uses multi-pattern matching and RxNorm dictionary fuzzy matching.
 */

import { Medication } from '../../models/Medication';
import { parseRegimenTail } from '../../../../../4-system-engine/api/routes/prescriptionSafety.js';
import { findDrugMatch, expandAbbreviation, PRESCRIPTION_ABBREVIATIONS } from './rxnormDictionary';

export interface ParsedMedication {
  medication: Medication;
  confidence: number;
  matchedDrugClass?: string;
  rawMatch: string;
}

/**
 * Regex patterns for common prescription formats.
 * Each handles different ways doctors write prescriptions.
 */
const MEDICATION_PATTERNS = [
  // Match one complete line. Horizontal whitespace prevents cross-line drug names.
  /(?:^|\n)[ \t]*(?:\d+[.)][ \t]*)?(?:(?:Drug|Medication|Rx|Tab\.?|Cap\.?|Inj\.?|Syp\.?)[ \t]*:?[ \t]+)?([A-Za-z][\w \t'-]*?)[ \t]+(\d+(?:\.\d+)?|\.\d+)[ \t]*(mg|mcg|g|ml|units?|IU|mEq)[ \t]*([^\r\n]*)(?=\r?\n|$)/gi,
];

/** Parse each detected line once, retaining different dose schedules. */
export function parseMedications(ocrText: string): ParsedMedication[] {
  const results: ParsedMedication[] = [];
  const seenDrugs = new Set<string>();

  for (const pattern of MEDICATION_PATTERNS) {
    // Reset regex lastIndex
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = pattern.exec(ocrText)) !== null) {
      const rawDrugName = match[1].trim().replace(/^(?:Tab|Cap|Inj|Syp|Rx)\.?\s+/i, '');
      const dosageAmount = match[2].startsWith('.') ? `0${match[2]}` : match[2];
      const dosageUnit = match[3];
      const drugOffset = match.index + match[0].indexOf(match[1]);
      const rawLine = ocrText.slice(drugOffset).split(/\r?\n/, 1)[0].trim();
      const strength = rawLine.match(/(?:\d+(?:\.\d+)?|\.\d+)\s*(?:mg|mcg|g|ml|units?|IU|mEq)\b/i);
      const rawFrequency = strength ? rawLine.slice(strength.index! + strength[0].length) : (match[4] || '');

      // Skip overly short matches or noise
      if (rawDrugName.length < 3) continue;

      // Match against RxNorm dictionary
      const drugMatch = findDrugMatch(rawDrugName);
      const isExact = drugMatch ? drugMatch.exact : false;
      const drugName = isExact ? drugMatch.drug.name : rawDrugName; // Preserve literal reading unless exact match
      const isFuzzy = Boolean(drugMatch && !isExact);
      const confidence = drugMatch ? (isExact ? Math.min(0.85, drugMatch.confidence) : Math.min(0.60, drugMatch.confidence)) : 0.3;
      const drugClass = drugMatch?.drug.drugClass;

      // Deduplicate
      const regimenLine = rawFrequency.toLowerCase().replace(/\s+/g, ' ').trim();
      const key = `${drugName.toLowerCase()}-${dosageAmount}${dosageUnit}-${regimenLine}`;
      if (seenDrugs.has(key)) continue;
      seenDrugs.add(key);

      // Extract duration if present (e.g. "for 7 days", "x 5 days", "10 days")
      const { frequency, duration, instructions, needsReview: regimenNeedsReview } = parseRegimenTail(rawFrequency, PRESCRIPTION_ABBREVIATIONS);
      const dosage = `${dosageAmount}${dosageUnit}`;
      const needsReview = regimenNeedsReview || isFuzzy || confidence < 0.65 || !dosageAmount || frequency === 'Needs Review';

      const medication = new Medication(
        drugName,
        dosage,
        frequency,
        undefined,
        duration,
        instructions,
        confidence,
        needsReview
      );
      if (isFuzzy && drugMatch) {
        medication.reviewReasons = [`Suggested: ${drugMatch.drug.name} (original reading: ${rawDrugName})`];
      }

      results.push({
        medication,
        confidence,
        matchedDrugClass: drugClass,
        rawMatch: rawLine,
      });
    }
  }

  // Sort by confidence (highest first)
  results.sort((a, b) => b.confidence - a.confidence);

  return results;
}

/**
 * Extract prescription metadata: Patient Name, Doctor Name, Date.
 */
export function extractPrescriptionMetadata(text: string): {
  patientName: string;
  doctorName: string;
  date: string;
} {
  let patientName = '';
  let doctorName = '';
  let date = '';

  // Patient Name patterns
  const patientMatch = text.match(/(?:patient(?:\s+name)?|pt(?:\s+name)?|name)\s*[:\-]\s*([A-Za-z\s\.\,\-\'\"]{2,40})/i);
  if (patientMatch) {
    const raw = patientMatch[1].split(/[\n\r,]/)[0].trim();
    if (raw.length > 2 && !raw.toLowerCase().includes('rx') && !raw.toLowerCase().includes('dr')) {
      patientName = raw;
    }
  }

  // Doctor Name patterns
  const doctorMatch = text.match(/(?:dr\.?|doctor|physician|prescriber)\s*[:\-]?\s*([A-Za-z\s\.\,\-]{2,40})/i);
  if (doctorMatch) {
    let raw = doctorMatch[1].split(/[\n\r,]/)[0].trim();
    if (!raw.toLowerCase().startsWith('dr') && !raw.toLowerCase().startsWith('doctor')) {
      raw = `Dr. ${raw}`;
    }
    if (raw.length > 4) {
      doctorName = raw;
    }
  }

  // Date patterns
  const dateMatch = text.match(/(?:date|issued|rx\s*date)\s*[:\-]?\s*([0-9]{1,4}[\/\-\.][0-9]{1,2}[\/\-\.][0-9]{1,4})/i)
    || text.match(/\b([0-9]{1,2}[\/\-\.][0-9]{1,2}[\/\-\.][0-9]{2,4})\b/);
  if (dateMatch) {
    date = dateMatch[1].trim();
  } else {
    // Missing issue dates must remain unknown.
  }

  return {
    patientName: patientName || 'Needs Review',
    doctorName: doctorName || 'Needs Review',
    date: date || 'Needs Review',
  };
}

/**
 * Extract all potential medication-related entities from text,
 * including drugs, dosages, and frequencies, even if they're not
 * in a standard prescription format.
 */
export function extractEntities(text: string): {
  drugs: string[];
  dosages: string[];
  frequencies: string[];
} {
  const drugs: string[] = [];
  const dosages: string[] = [];
  const frequencies: string[] = [];

  // Extract drug names via dictionary matching
  const words = text.split(/[\s,;:]+/);
  for (const word of words) {
    const match = findDrugMatch(word, 2);
    if (match) {
      drugs.push(match.drug.name);
    }
  }

  // Extract dosages
  const dosagePattern = /(?:\d+(?:\.\d+)?|\.\d+)\s*(?:mg|mcg|g|ml|units?|IU|mEq)/gi;
  let dosageMatch: RegExpExecArray | null;
  while ((dosageMatch = dosagePattern.exec(text)) !== null) {
    dosages.push(dosageMatch[0].trim());
  }

  // Extract frequencies
  const freqTerms = Object.keys(PRESCRIPTION_ABBREVIATIONS).filter(k => {
    const category = expandAbbreviation(k);
    return category.includes('daily') || category.includes('times') ||
           category.includes('hours') || category.includes('bedtime') ||
           category.includes('needed') || category.includes('meals') ||
           category.includes('weekly');
  });

  for (const term of freqTerms) {
    const regex = new RegExp(`\\b${term}\\b`, 'gi');
    if (regex.test(text)) {
      frequencies.push(expandAbbreviation(term));
    }
  }

  return {
    drugs: [...new Set(drugs)],
    dosages: [...new Set(dosages)],
    frequencies: [...new Set(frequencies)],
  };
}
