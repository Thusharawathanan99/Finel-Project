/**
 * Server-Side Ensemble Module
 * Ported from the web app's EnsembleOrchestrator.ts + MedicationParser.ts + rxnormDictionary.ts
 *
 * Provides:
 *  - RxNorm drug dictionary with fuzzy matching
 *  - Regex-based medication parser
 *  - Gemini multi-model retry with exponential backoff
 *  - Weighted confidence voting & candidate merging
 */

import { reconcileCandidates, parseRegimenTail } from './prescriptionSafety.js';

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// RxNorm Drug Database (top ~80 commonly prescribed)
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const DRUG_DATABASE = [
  { name: 'Lisinopril', aliases: ['zestril','prinivil'], drugClass: 'ACE Inhibitor' },
  { name: 'Amlodipine', aliases: ['norvasc'], drugClass: 'Calcium Channel Blocker' },
  { name: 'Atorvastatin', aliases: ['lipitor'], drugClass: 'Statin' },
  { name: 'Metoprolol', aliases: ['lopressor','toprol'], drugClass: 'Beta Blocker' },
  { name: 'Losartan', aliases: ['cozaar'], drugClass: 'ARB' },
  { name: 'Hydrochlorothiazide', aliases: ['hctz','microzide'], drugClass: 'Diuretic' },
  { name: 'Warfarin', aliases: ['coumadin','jantoven'], drugClass: 'Anticoagulant' },
  { name: 'Clopidogrel', aliases: ['plavix'], drugClass: 'Antiplatelet' },
  { name: 'Furosemide', aliases: ['lasix'], drugClass: 'Loop Diuretic' },
  { name: 'Spironolactone', aliases: ['aldactone'], drugClass: 'Potassium-Sparing Diuretic' },
  { name: 'Valsartan', aliases: ['diovan'], drugClass: 'ARB' },
  { name: 'Diltiazem', aliases: ['cardizem','tiazac'], drugClass: 'Calcium Channel Blocker' },
  { name: 'Carvedilol', aliases: ['coreg'], drugClass: 'Beta Blocker' },
  { name: 'Simvastatin', aliases: ['zocor'], drugClass: 'Statin' },
  { name: 'Rosuvastatin', aliases: ['crestor'], drugClass: 'Statin' },
  { name: 'Pravastatin', aliases: ['pravachol'], drugClass: 'Statin' },
  { name: 'Metformin', aliases: ['glucophage','fortamet'], drugClass: 'Biguanide' },
  { name: 'Glipizide', aliases: ['glucotrol'], drugClass: 'Sulfonylurea' },
  { name: 'Insulin Glargine', aliases: ['lantus','basaglar','toujeo'], drugClass: 'Insulin' },
  { name: 'Sitagliptin', aliases: ['januvia'], drugClass: 'DPP-4 Inhibitor' },
  { name: 'Empagliflozin', aliases: ['jardiance'], drugClass: 'SGLT2 Inhibitor' },
  { name: 'Acetaminophen', aliases: ['tylenol','paracetamol','apap'], drugClass: 'Analgesic' },
  { name: 'Ibuprofen', aliases: ['advil','motrin'], drugClass: 'NSAID' },
  { name: 'Naproxen', aliases: ['aleve','naprosyn'], drugClass: 'NSAID' },
  { name: 'Meloxicam', aliases: ['mobic'], drugClass: 'NSAID' },
  { name: 'Tramadol', aliases: ['ultram'], drugClass: 'Opioid Analgesic' },
  { name: 'Gabapentin', aliases: ['neurontin','gralise'], drugClass: 'Anticonvulsant/Neuropathic' },
  { name: 'Pregabalin', aliases: ['lyrica'], drugClass: 'Anticonvulsant/Neuropathic' },
  { name: 'Celecoxib', aliases: ['celebrex'], drugClass: 'COX-2 Inhibitor' },
  { name: 'Diclofenac', aliases: ['voltaren','cataflam'], drugClass: 'NSAID' },
  { name: 'Sertraline', aliases: ['zoloft'], drugClass: 'SSRI' },
  { name: 'Escitalopram', aliases: ['lexapro'], drugClass: 'SSRI' },
  { name: 'Fluoxetine', aliases: ['prozac','sarafem'], drugClass: 'SSRI' },
  { name: 'Citalopram', aliases: ['celexa'], drugClass: 'SSRI' },
  { name: 'Duloxetine', aliases: ['cymbalta'], drugClass: 'SNRI' },
  { name: 'Venlafaxine', aliases: ['effexor'], drugClass: 'SNRI' },
  { name: 'Bupropion', aliases: ['wellbutrin','zyban'], drugClass: 'NDRI' },
  { name: 'Trazodone', aliases: ['desyrel','oleptro'], drugClass: 'SARI' },
  { name: 'Mirtazapine', aliases: ['remeron'], drugClass: 'NaSSA' },
  { name: 'Amitriptyline', aliases: ['elavil'], drugClass: 'TCA' },
  { name: 'Alprazolam', aliases: ['xanax'], drugClass: 'Benzodiazepine' },
  { name: 'Lorazepam', aliases: ['ativan'], drugClass: 'Benzodiazepine' },
  { name: 'Quetiapine', aliases: ['seroquel'], drugClass: 'Atypical Antipsychotic' },
  { name: 'Aripiprazole', aliases: ['abilify'], drugClass: 'Atypical Antipsychotic' },
  { name: 'Albuterol', aliases: ['proventil','ventolin','salbutamol'], drugClass: 'Beta-2 Agonist' },
  { name: 'Fluticasone', aliases: ['flonase','flovent'], drugClass: 'Corticosteroid' },
  { name: 'Montelukast', aliases: ['singulair'], drugClass: 'Leukotriene Modifier' },
  { name: 'Prednisone', aliases: ['deltasone','rayos'], drugClass: 'Corticosteroid' },
  { name: 'Cetirizine', aliases: ['zyrtec'], drugClass: 'Antihistamine' },
  { name: 'Loratadine', aliases: ['claritin'], drugClass: 'Antihistamine' },
  { name: 'Omeprazole', aliases: ['prilosec'], drugClass: 'PPI' },
  { name: 'Pantoprazole', aliases: ['protonix'], drugClass: 'PPI' },
  { name: 'Esomeprazole', aliases: ['nexium'], drugClass: 'PPI' },
  { name: 'Famotidine', aliases: ['pepcid'], drugClass: 'H2 Blocker' },
  { name: 'Ondansetron', aliases: ['zofran'], drugClass: 'Antiemetic' },
  { name: 'Amoxicillin', aliases: ['amoxil','trimox'], drugClass: 'Penicillin' },
  { name: 'Azithromycin', aliases: ['zithromax','z-pack'], drugClass: 'Macrolide' },
  { name: 'Ciprofloxacin', aliases: ['cipro'], drugClass: 'Fluoroquinolone' },
  { name: 'Levofloxacin', aliases: ['levaquin'], drugClass: 'Fluoroquinolone' },
  { name: 'Doxycycline', aliases: ['vibramycin','doryx'], drugClass: 'Tetracycline' },
  { name: 'Metronidazole', aliases: ['flagyl'], drugClass: 'Nitroimidazole' },
  { name: 'Cephalexin', aliases: ['keflex'], drugClass: 'Cephalosporin' },
  { name: 'Nitrofurantoin', aliases: ['macrobid'], drugClass: 'Nitrofuran' },
  { name: 'Clindamycin', aliases: ['cleocin'], drugClass: 'Lincosamide' },
  { name: 'Levothyroxine', aliases: ['synthroid','levoxyl','tirosint'], drugClass: 'Thyroid Hormone' },
  { name: 'Vitamin D', aliases: ['cholecalciferol','ergocalciferol'], drugClass: 'Vitamin' },
  { name: 'Ferrous Sulfate', aliases: ['feosol','iron supplement'], drugClass: 'Iron Supplement' },
  { name: 'Folic Acid', aliases: ['folate'], drugClass: 'Vitamin' },
  { name: 'Zolpidem', aliases: ['ambien'], drugClass: 'Sedative-Hypnotic' },
  { name: 'Tamsulosin', aliases: ['flomax'], drugClass: 'Alpha Blocker' },
  { name: 'Finasteride', aliases: ['proscar','propecia'], drugClass: '5-Alpha Reductase Inhibitor' },
  { name: 'Levetiracetam', aliases: ['keppra'], drugClass: 'Anticonvulsant' },
  { name: 'Lamotrigine', aliases: ['lamictal'], drugClass: 'Anticonvulsant' },
  { name: 'Topiramate', aliases: ['topamax'], drugClass: 'Anticonvulsant' },
  { name: 'Phenytoin', aliases: ['dilantin'], drugClass: 'Anticonvulsant' },
  { name: 'Valproic Acid', aliases: ['depakote','depakene'], drugClass: 'Anticonvulsant' },
];

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Prescription Abbreviations
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const PRESCRIPTION_ABBREVIATIONS = {
  'qd': 'once daily', 'od': 'once daily', 'bid': 'twice daily',
  'tid': 'three times daily', 'qid': 'four times daily',
  'q4h': 'every 4 hours', 'q6h': 'every 6 hours', 'q8h': 'every 8 hours',
  'q12h': 'every 12 hours', 'prn': 'as needed', 'hs': 'at bedtime',
  'qhs': 'at bedtime', 'ac': 'before meals', 'pc': 'after meals',
  'stat': 'immediately', 'qam': 'every morning', 'qpm': 'every evening',
  'qwk': 'once weekly', 'biw': 'twice weekly',
  'po': 'by mouth', 'sl': 'sublingual', 'im': 'intramuscular',
  'iv': 'intravenous', 'sc': 'subcutaneous', 'inh': 'inhaled', 'top': 'topically',
};

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Levenshtein Distance & Fuzzy Matching
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function levenshtein(a, b) {
  const matrix = [];
  for (let i = 0; i <= a.length; i++) matrix[i] = [i];
  for (let j = 0; j <= b.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(matrix[i-1][j]+1, matrix[i][j-1]+1, matrix[i-1][j-1]+cost);
    }
  }
  return matrix[a.length][b.length];
}

function findDrugMatch(input, maxDistance = 3) {
  const norm = input.toLowerCase().trim();
  if (norm.length < 3) return null;
  let bestMatch = null, bestDist = Infinity;
  for (const drug of DRUG_DATABASE) {
    const d = levenshtein(norm, drug.name.toLowerCase());
    if (d < bestDist) { bestDist = d; bestMatch = drug; }
    for (const alias of drug.aliases) {
      const ad = levenshtein(norm, alias.toLowerCase());
      if (ad < bestDist) { bestDist = ad; bestMatch = drug; }
    }
    if (bestDist === 0) break;
  }
  if (bestMatch && bestDist <= maxDistance) {
    const maxLen = Math.max(norm.length, bestMatch.name.length);
    return { drug: bestMatch, confidence: Math.max(0, 1 - bestDist / maxLen), exact: bestDist === 0 };
  }
  return null;
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Regex Medication Parser
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const MEDICATION_PATTERNS = [
  // Match one complete line. Horizontal whitespace prevents cross-line drug names.
  /(?:^|\n)[ \t]*(?:\d+[.)][ \t]*)?(?:(?:Drug|Medication|Rx|Tab\.?|Cap\.?|Inj\.?|Syp\.?)[ \t]*:?[ \t]+)?([A-Za-z][\w \t'-]*?)[ \t]+(\d+(?:\.\d+)?|\.\d+)[ \t]*(mg|mcg|g|ml|units?|IU|mEq)[ \t]*([^\r\n]*)(?=\r?\n|$)/gi,
];

export function parseMedications(ocrText) {
  const results = [];
  const seenDrugs = new Set();
  for (const pattern of MEDICATION_PATTERNS) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(ocrText)) !== null) {
      const rawDrugName = match[1].trim().replace(/^(?:Tab|Cap|Inj|Syp|Rx)\.?\s+/i, '');
      const dosageAmount = match[2].startsWith('.') ? `0${match[2]}` : match[2];
      const dosageUnit = match[3];
      const drugOffset = match.index + match[0].indexOf(match[1]);
      const rawLine = ocrText.slice(drugOffset).split(/\r?\n/, 1)[0].trim();
      const strength = rawLine.match(/(?:\d+(?:\.\d+)?|\.\d+)\s*(?:mg|mcg|g|ml|units?|IU|mEq)\b/i);
      const rawFrequency = strength ? rawLine.slice(strength.index + strength[0].length) : (match[4] || '');
      if (rawDrugName.length < 3) continue;
      const drugMatch = findDrugMatch(rawDrugName);
      const drugName = drugMatch ? drugMatch.drug.name : rawDrugName;
      const confidence = drugMatch ? Math.min(0.8, drugMatch.confidence) : 0.3;
      const drugClass = drugMatch?.drug.drugClass;
      const regimenLine = rawFrequency.toLowerCase().replace(/\s+/g, ' ').trim();
      const key = `${drugName.toLowerCase()}-${dosageAmount}${dosageUnit}-${regimenLine}`;
      if (seenDrugs.has(key)) continue;
      seenDrugs.add(key);
      const { frequency, duration, instructions, needsReview: regimenNeedsReview } = parseRegimenTail(rawFrequency, PRESCRIPTION_ABBREVIATIONS);

      results.push({
        drugName,
        dosage: `${dosageAmount}${dosageUnit}`,
        frequency,
        duration,
        instructions,
        confidence,
        needsReview: regimenNeedsReview || confidence < 0.65 || !dosageAmount || frequency === 'Needs Review',
        drugClass,
        rawMatch: rawLine,
      });
    }
  }
  results.sort((a, b) => b.confidence - a.confidence);
  return results;
}

export function extractPrescriptionMetadata(text) {
  let patientName = '';
  let doctorName = '';
  let date = '';

  const patientMatch = text.match(/(?:patient(?:\s+name)?|pt(?:\s+name)?|name)\s*[:\-]\s*([A-Za-z\s\.\,\-\'\"]{2,40})/i);
  if (patientMatch) {
    const raw = patientMatch[1].split(/[\n\r,]/)[0].trim();
    if (raw.length > 2 && !raw.toLowerCase().includes('rx') && !raw.toLowerCase().includes('dr')) {
      patientName = raw;
    }
  }

  const doctorMatch = text.match(/(?:dr\.?|doctor|physician|prescriber)\s*[:\-]?\s*([A-Za-z\s\.\,\-]{2,40})/i);
  if (doctorMatch) {
    let raw = doctorMatch[1].split(/[\n\r,]/)[0].trim();
    if (!raw.toLowerCase().startsWith('dr') && !raw.toLowerCase().startsWith('doctor')) {
      raw = `Dr. ${raw}`;
    }
    if (raw.length > 4) doctorName = raw;
  }

  const dateMatch = text.match(/(?:date|issued|rx\s*date)\s*[:\-]?\s*([0-9]{1,4}[\/\-\.][0-9]{1,2}[\/\-\.][0-9]{1,4})/i)
    || text.match(/\b([0-9]{1,2}[\/\-\.][0-9]{1,2}[\/\-\.][0-9]{2,4})\b/);
  if (dateMatch) date = dateMatch[1].trim();
  // An absent issue date is unknown, not today's date.

  return {
    patientName: patientName || 'Needs Review',
    doctorName: doctorName || 'Needs Review',
    date: date || 'Needs Review',
  };
}

export function extractEntities(text) {
  const drugs = [], dosages = [], frequencies = [];
  for (const word of text.split(/[\s,;:]+/)) {
    const m = findDrugMatch(word, 2);
    if (m) drugs.push(m.drug.name);
  }
  const dp = /(?:\d+(?:\.\d+)?|\.\d+)\s*(?:mg|mcg|g|ml|units?|IU|mEq)/gi;
  let dm; while ((dm = dp.exec(text)) !== null) dosages.push(dm[0].trim());
  for (const [abbr, full] of Object.entries(PRESCRIPTION_ABBREVIATIONS)) {
    if (full.includes('daily') || full.includes('times') || full.includes('hours') || full.includes('bedtime') || full.includes('needed')) {
      if (new RegExp(`\\b${abbr}\\b`, 'gi').test(text)) frequencies.push(full);
    }
  }
  return { drugs: [...new Set(drugs)], dosages: [...new Set(dosages)], frequencies: [...new Set(frequencies)] };
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Gemini Multi-Model Retry
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const DEFAULT_MODELS = ['gemini-3.5-flash-lite', 'gemini-2.5-flash', 'gemini-3.5-flash'];
const PERMANENTLY_UNAVAILABLE = new Set();

function parseGeminiModels() {
  const configured = process.env.GEMINI_MODELS;
  if (!configured) return DEFAULT_MODELS;
  const parsed = configured.split(',').map(m => m.trim()).filter(Boolean);
  return parsed.length > 0 ? parsed : DEFAULT_MODELS;
}

function isRetryableError(msg) {
  const lower = msg.toLowerCase();
  return lower.includes('429') || lower.includes('quota') || lower.includes('503') ||
    lower.includes('500') || lower.includes('overloaded') || lower.includes('high demand') ||
    lower.includes('temporarily unavailable') || lower.includes('timeout');
}

export async function callGeminiWithRetry(genAI, parts, options = {}) {
  const maxRetries = options.maxRetries ?? 2;
  const timeoutMs = options.timeoutMs ?? 15000;
  const models = parseGeminiModels();
  let lastError = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const modelsToTry = models.filter(m => !PERMANENTLY_UNAVAILABLE.has(m));
    const active = modelsToTry.length > 0 ? modelsToTry : models;

    for (const modelName of active) {
      try {
        const model = genAI.getGenerativeModel({ model: modelName });
        let timeout;
        let result;
        try {
          result = await Promise.race([
            model.generateContent(parts),
            new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error(`Gemini timeout after ${timeoutMs}ms`)), timeoutMs); })
          ]);
        } finally {
          clearTimeout(timeout);
        }
        console.log(`[Ensemble] âœ… Gemini model "${modelName}" succeeded`);
        return result;
      } catch (error) {
        lastError = error;
        const errMsg = error instanceof Error ? error.message : String(error);
        if (errMsg.includes('404')) {
          PERMANENTLY_UNAVAILABLE.add(modelName);
          console.warn(`[Ensemble] Model "${modelName}" returned 404 â€” trying next...`);
          continue;
        }
        if (errMsg.includes('429') || errMsg.toLowerCase().includes('quota exceeded')) {
          PERMANENTLY_UNAVAILABLE.add(modelName);
          console.warn(`[Ensemble] Model "${modelName}" quota exceeded â€” marked unavailable, trying next...`);
          continue;
        }
        if (isRetryableError(errMsg)) {
          console.warn(`[Ensemble] Model "${modelName}" overloaded â€” trying next...`);
          continue;
        }
        throw error;
      }
    }

    if (attempt < maxRetries) {
      const waitMs = Math.min(6000, 2000 * Math.pow(2, attempt)) + Math.floor(Math.random() * 300);
      console.log(`[Ensemble] All models failed, retrying in ${waitMs}ms (attempt ${attempt+1}/${maxRetries})...`);
      await new Promise(r => setTimeout(r, waitMs));
    }
  }
  throw lastError || new Error('All Gemini models failed');
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Weighted Voting & Candidate Merging
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export function mergeCandidates(candidates) {
  return reconcileCandidates(candidates, name => {
    const match = findDrugMatch(name);
    return match && match.confidence > 0.8 ? match.drug.name : name;
  });
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Full Gemini Prompt (matches web app)
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export const GEMINI_PROMPT = `You are an expert clinical pharmacist AI. Analyze the following prescription and extract all structured data accurately.

CRITICAL RULES:
- Extract EVERY medication/drug name you see, even if you do not recognize it.
- Include brand names, generic names, and local/regional drug names.
- If any text cannot be recognized confidently, output "Needs Review" instead of guessing or returning incorrect information.
- Items prefixed with "G." or "Rx" are medications â€” always include them.

EXTRACTION INSTRUCTIONS:
1. Extract ALL prescription header info:
   - "patientName": Name of patient (e.g. "John Doe"). If illegible or absent, output "Needs Review".
   - "doctorName": Name of prescribing doctor with title (e.g. "Dr. Sarah Connor"). If illegible or absent, output "Needs Review".
   - "date": Date of issue (e.g. "2026-10-04"). If illegible or absent, output "Needs Review".
2. Extract EVERY medication listed:
   - "drugName": Full brand or generic drug name.
   - "dosage": Strength/amount (e.g. "500mg", "10ml", "1 tablet"). If illegible or absent, output "Needs Review".
   - "frequency": How often to take (e.g. "Once daily", "Twice daily after meals", "Every 8 hours"). Expand clinical abbreviations (BID -> Twice daily, TID -> Three times daily, QD -> Once daily, PRN -> As needed). If illegible or absent, output "Needs Review".
   - "duration": How long to take (e.g. "7 days", "14 days", "1 month", "Ongoing"). If absent, output "As directed".
   - "instructions": Specific instructions (e.g. "Take after food with full glass of water", "Apply topically"). If absent, output "Follow doctor guidance".
   - "route": e.g. "oral", "topical", "inhalation".
   - "confidence": Float between 0.0 and 1.0 representing your confidence in this extraction.
   - "needsReview": true if confidence < 0.70 or if any critical field (drugName, dosage, frequency) is uncertain or marked "Needs Review"; false otherwise.
   - "warnings": Potential interactions, allergies, or precautions.
3. Correct obvious handwriting/OCR typos (e.g. "Llsinopril" -> "Lisinopril") and list corrections in "corrections".
4. In "rawText", include the complete raw text read from the prescription.

Return ONLY valid JSON matching this exact structure:
{
  "rawText": "Full text read from the prescription",
  "patientName": "John Doe",
  "doctorName": "Dr. Sarah Connor",
  "date": "2026-10-04",
  "medications": [
    {
      "drugName": "Amoxicillin",
      "dosage": "500mg",
      "frequency": "Three times daily after meals",
      "duration": "7 days",
      "instructions": "Take with full glass of water",
      "route": "oral",
      "confidence": 0.95,
      "needsReview": false,
      "warnings": []
    }
  ],
  "corrections": [],
  "overallConfidence": 0.95
}`;
