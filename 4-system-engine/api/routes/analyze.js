// Analyze API route — Full Ensemble Mode (Donut + Regex + Gemini)
// Matches the web app's EnsembleOrchestrator pipeline exactly.
import { Router } from 'express';
import { validateImage } from '../middleware/inferenceLimits.js';
import { GoogleGenerativeAI } from '@google/generative-ai';
import {
  parseMedications,
  extractEntities,
  extractPrescriptionMetadata,
  callGeminiWithRetry,
  mergeCandidates,
  GEMINI_PROMPT,
} from './ensemble.js';
import { cleanPrescriptionField } from './prescriptionSafety.js';

const router = Router();

// Configure Gemini
let genAI = null;
const serverApiKey = process.env.GEMINI_API_KEY;
if (serverApiKey) {
  genAI = new GoogleGenerativeAI(serverApiKey);
  console.log('✅ Gemini API initialized for ensemble analysis');
} else {
  console.warn('⚠️  Server Gemini API key not set — Gemini will be unavailable in ensemble');
}

const DONUT_BASE = process.env.DONUT_API_URL || 'http://localhost:8000';
const DONUT_URL = DONUT_BASE.replace(/\/$/, '') + '/api/predict-base64';
const DONUT_TIMEOUT_MS = Number(process.env.DONUT_TIMEOUT_MS || 25000);
const GEMINI_TIMEOUT_MS = Number(process.env.GEMINI_TIMEOUT_MS || 15000);

function candidateFromMedication(m, source, fallbackConfidence = 0.5) {
  const dosage = cleanPrescriptionField(m.dosage) || 'Needs Review';
  const frequency = cleanPrescriptionField(m.frequency) || 'Needs Review';
  const confidence = Number.isFinite(m.confidence) ? Math.max(0, Math.min(1, m.confidence)) : fallbackConfidence;
  return {
    drugName: m.drugName || m.drug_name || m.name,
    dosage, frequency,
    duration: cleanPrescriptionField(m.duration) || 'As directed',
    instructions: cleanPrescriptionField(m.instructions) || 'Follow doctor guidance',
    route: cleanPrescriptionField(m.route),
    rawMatch: cleanPrescriptionField(m.rawMatch || m.raw_match),
    confidence,
    needsReview: Boolean(m.needsReview || confidence < 0.65 || dosage === 'Needs Review' || frequency === 'Needs Review'),
    source,
    extra: { warnings: m.warnings, drugClass: m.drugClass },
  };
}

router.post('/analyze-prescription', async (req, res) => {
  const startTime = Date.now();
  try {
    const { image } = req.body;
    if (!validateImage(image)) {
      return res.status(400).json({ error: 'Image base64 data is required' });
    }

    console.log('[Ensemble] 🚀 Starting prescription analysis...');

    const candidates = [];
    const sourcesUsed = [];
    const corrections = [];
    const timings = {};
    let donutRawText = '';
    let geminiRawText = '';
    let geminiPatientName = '';
    let geminiDoctorName = '';
    let geminiDate = '';
    let providerSucceeded = false;

    // ── Task 1: Donut (custom ML model) ──
    const donutTask = (async () => {
      const t0 = Date.now();
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), DONUT_TIMEOUT_MS);
        let result;
        try {
          const r = await fetch(DONUT_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...(process.env.DONUT_INTERNAL_TOKEN ? { 'X-Donut-Token': process.env.DONUT_INTERNAL_TOKEN } : {}) },
            body: JSON.stringify({ image }),
            signal: controller.signal,
          });
          if (!r.ok) throw new Error(`Donut HTTP ${r.status}`);
          result = await r.json();
        } finally {
          clearTimeout(timeout);
        }
        if (!result || typeof result !== 'object') throw new Error('Donut returned an invalid response');
        providerSucceeded = true;
        timings.donutMs = Date.now() - t0;
        donutRawText = result.raw_text || '';

        // Direct structured medications
        if (Array.isArray(result.medications) && result.medications.length > 0) {
          sourcesUsed.push('donut');
          return result.medications.filter(m => m && typeof m === 'object').map(m => candidateFromMedication(m, 'donut'));
        }

        // Fallback: parse Donut raw text with regex
        if (result.raw_text) {
          const fallback = parseMedications(result.raw_text);
          if (fallback.length > 0) {
            console.log(`[Ensemble] Donut fallback parser recovered ${fallback.length} medication(s)`);
            sourcesUsed.push('donut');
            return fallback.map(r => candidateFromMedication({ ...r, confidence: Math.min(0.75, r.confidence * 0.9) }, 'donut'));
          }

          // Last-resort: entity extraction
          const entities = extractEntities(result.raw_text);
          if (entities.drugs.length > 0) {
            console.log(`[Ensemble] Donut entity recovery found ${entities.drugs.length} drug(s)`);
            sourcesUsed.push('donut');
            return entities.drugs.map(drug => ({
              drugName: drug,
              dosage: 'Needs Review',
              frequency: 'Needs Review',
              needsReview: true,
              confidence: 0.42,
              source: 'donut',
            }));
          }
        }
        return [];
      } catch (err) {
        timings.donutMs = Date.now() - t0;
        console.warn('[Ensemble] Donut failed:', err.message);
        return [];
      }
    })();

    // ── Task 2: Regex Parser (runs on Donut raw text once available) ──
    const regexTask = donutTask.then(donutCandidates => {
      const t0 = Date.now();
      try {
        // Use donut raw text for regex parsing (if available)
        const textToParse = donutRawText || req.body?.text || req.body?.raw_text || req.body?.ocr_text || '';
        if (!textToParse || textToParse.trim().length < 5) {
          timings.regexMs = Date.now() - t0;
          return { donutCandidates, regexCandidates: [] };
        }
        const results = parseMedications(textToParse);
        timings.regexMs = Date.now() - t0;
        if (results.length > 0) sourcesUsed.push('regex');
        const regexCandidates = results.map(r => candidateFromMedication(r, 'regex'));
        return { donutCandidates, regexCandidates };
      } catch (err) {
        timings.regexMs = Date.now() - t0;
        console.warn('[Ensemble] Regex failed:', err.message);
        return { donutCandidates, regexCandidates: [] };
      }
    });

    // ── Task 3: Gemini (cloud AI with multi-model retry) ──
    const geminiTask = (async () => {
      if (!genAI) return [];
      const t0 = Date.now();
      try {
        let cleanBase64 = image;
        const dataUrlMatch = image.match(/^data:([^;]+);base64,(.+)$/);
        if (dataUrlMatch) {
          cleanBase64 = dataUrlMatch[2];
        } else {
          cleanBase64 = image.replace(/^data:[^;]+;base64,/, '');
        }

        const mimeType = (dataUrlMatch && dataUrlMatch[1]) ? dataUrlMatch[1] : 'image/jpeg';
        const parts = [
          { text: GEMINI_PROMPT },
          { inlineData: { mimeType, data: cleanBase64 } },
        ];

        const result = await callGeminiWithRetry(genAI, parts, {
          maxRetries: 2,
          timeoutMs: GEMINI_TIMEOUT_MS,
        });

        timings.geminiMs = Date.now() - t0;
        const text = result.response.text();
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (!jsonMatch) return [];

        const parsed = JSON.parse(jsonMatch[0]);
        if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.medications)) throw new Error('Gemini returned an invalid prescription response');
        providerSucceeded = true;
        geminiRawText = parsed.rawText || '';
        geminiPatientName = parsed.patientName || '';
        geminiDoctorName = parsed.doctorName || '';
        geminiDate = parsed.date || '';
        if (parsed.corrections?.length > 0) corrections.push(...parsed.corrections);

        if (parsed.medications.length > 0) {
          sourcesUsed.push('gemini');
          return parsed.medications.filter(m => m && typeof m === 'object').map(m => candidateFromMedication(m, 'gemini'));
        }
        return [];
      } catch (err) {
        timings.geminiMs = Date.now() - t0;
        console.error('[Ensemble] Gemini failed:', err.message);
        return [];
      }
    })();

    // ── Run all tasks in parallel (regex depends on donut) ──
    const [regexResult, geminiCandidates] = await Promise.all([regexTask, geminiTask]);
    const { donutCandidates, regexCandidates } = regexResult;

    candidates.push(...donutCandidates, ...regexCandidates, ...geminiCandidates);

    // ── Merge with weighted voting ──
    const mergedMedications = mergeCandidates(candidates);
    if (!mergedMedications.length) {
      return res.status(providerSucceeded ? 422 : 503).json({
        success: false,
        error: providerSucceeded ? 'No readable medication regimen was found. Please use a clearer prescription image.' : 'Prescription analysis is currently unavailable. Please try again later.',
        code: providerSucceeded ? 'PRESCRIPTION_NOT_READABLE' : 'PRESCRIPTION_ANALYSIS_UNAVAILABLE',
        retryable: true,
      });
    }

    const rawText = geminiRawText || donutRawText || '';
    const totalMs = Date.now() - startTime;
    const metadata = extractPrescriptionMetadata(rawText);

    const patientName = (geminiPatientName && geminiPatientName !== 'Needs Review') ? geminiPatientName : metadata.patientName;
    const doctorName = (geminiDoctorName && geminiDoctorName !== 'Needs Review') ? geminiDoctorName : metadata.doctorName;
    const date = (geminiDate && geminiDate !== 'Needs Review') ? geminiDate : metadata.date;

    // Log structured summary
    console.log(
      `[Ensemble] ── Results (${totalMs}ms) ──\n` +
      `  Donut: ${donutCandidates.length} meds (${timings.donutMs || 'n/a'}ms)\n` +
      `  Regex: ${regexCandidates.length} meds (${timings.regexMs || 'n/a'}ms)\n` +
      `  Gemini: ${geminiCandidates.length} meds (${timings.geminiMs || 'n/a'}ms)\n` +
      `  ✅ Final: ${mergedMedications.length} merged medications from [${sourcesUsed.join(', ')}]`
    );

    res.json({
      success: true,
      raw_text: rawText,
      rawText: rawText,
      patient_name: patientName,
      patientName: patientName,
      doctor_name: doctorName,
      doctorName: doctorName,
      date: date,
      medications: mergedMedications,
      needsReview: mergedMedications.some(m => m.needsReview),
      ensemble_sources: {
        donut_used: sourcesUsed.includes('donut'),
        regex_used: sourcesUsed.includes('regex'),
        gemini_used: sourcesUsed.includes('gemini'),
        sources: [...new Set(sourcesUsed)],
      },
      corrections,
      timings: { ...timings, totalMs },
    });

  } catch (err) {
    console.error('[Analyze] Error:', err);
    res.status(500).json({ error: 'Failed to analyze prescription' });
  }
});

export default router;
