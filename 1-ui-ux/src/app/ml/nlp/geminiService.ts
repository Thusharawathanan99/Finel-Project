/** Authenticated AI transport. Provider credentials and model selection stay on the server. */
import { apiPost } from '../../services/apiService';

type ContentPart = { text: string } | { inlineData: { mimeType: string; data: string } };
interface ServerModel {
  generateContent(contents: ContentPart[] | string): Promise<{ response: { text: () => string } }>;
}
function createServerModel(task: 'prescription' | 'meal-plan' = 'prescription'): ServerModel {
  return {
  async generateContent(contents) {
    const parts = typeof contents === 'string' ? [{ text: contents }] : contents;
    const result = await apiPost<{ text: string }>('/ai/generate', { contents: parts, task });
    if (typeof result.text !== 'string' || !result.text.trim()) throw new Error('The analysis service returned an empty result. Please try again.');
    return { response: { text: () => result.text } };
  },
  };
}
const serverModel = createServerModel();
const GEMINI_VERIFY_TIMEOUT_MS = 180000;
const GEMINI_VISION_TIMEOUT_MS = 180000;
const GEMINI_VERIFY_MAX_RETRIES = 0;
const GEMINI_VISION_MAX_RETRIES = 0;
function getModel(): ServerModel { return serverModel; }

/** The server owns provider retries; duplicate client requests must not consume extra quota. */
export async function callWithRetry<T>(fn: (model: ServerModel) => Promise<T>, options?: { maxRetries?: number; timeoutMs?: number; task?: 'prescription' | 'meal-plan' }): Promise<T> {
  return fn(options?.task === 'meal-plan' ? createServerModel('meal-plan') : serverModel);
}
export interface GeminiMedicationResult {
  patientName?: string;
  doctorName?: string;
  date?: string;
  medications: {
    drugName: string;
    dosage: string;
    frequency: string;
    duration?: string;
    instructions?: string;
    route?: string;
    confidence: number;
    needsReview?: boolean;
    warnings: string[];
  }[];
  corrections: string[];
  overallConfidence: number;
  rawText?: string;
}

/**
 * Verify and correct OCR-extracted medication text using Gemini.
 * Gemini cross-checks the OCR output and fills in missing/ambiguous fields.
 */
export async function verifyPrescriptionWithGemini(
  ocrText: string,
  imageBase64?: string
): Promise<GeminiMedicationResult> {
  const prompt = `You are an expert clinical pharmacist AI. Analyze the following prescription and extract all structured data accurately.

${ocrText.trim().length > 10 ? `OCR Text:
"""
${ocrText}
"""
` : 'No OCR text is available. Read and extract ALL information directly from the prescription image.\n'}

EXTRACTION INSTRUCTIONS:
1. Extract ALL prescription header info:
   - "patientName": Name of patient (e.g. "John Doe"). If illegible, absent, or low confidence, output "Needs Review".
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
3. If ANY text cannot be recognized confidently, output "Needs Review" instead of guessing or hallucinating false information.
4. Correct obvious handwriting/OCR typos (e.g. "Llsinopril" -> "Lisinopril") and list corrections in "corrections".
5. In "rawText", include the complete raw text read from the prescription.

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

  try {
    const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [
      { text: prompt },
    ];

    // If an image is provided, include it for visual verification
    if (imageBase64) {
      let mimeType = 'image/jpeg';
      let cleanBase64 = imageBase64;
      
      const match = imageBase64.match(/^data:([^;]+);base64,(.+)$/);
      if (match) {
        mimeType = match[1];
        cleanBase64 = match[2];
      } else {
        // Fallback for hard replacement just in case
        cleanBase64 = imageBase64.replace(/^data:[^;]+;base64,/, '');
      }

      parts.push({
        inlineData: {
          mimeType: mimeType,
          data: cleanBase64,
        },
      });
    }

    const result = await callWithRetry(
      m => m.generateContent(parts),
      {
        maxRetries: GEMINI_VERIFY_MAX_RETRIES,
        timeoutMs: GEMINI_VERIFY_TIMEOUT_MS,
      }
    );
    const responseText = result.response.text();

    // Extract JSON from response (handle markdown code blocks)
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('Gemini response did not contain valid JSON');
    }

    const parsed = JSON.parse(jsonMatch[0]) as GeminiMedicationResult;
    parsed.patientName = parsed.patientName || 'Needs Review';
    parsed.doctorName = parsed.doctorName || 'Needs Review';
    parsed.date = parsed.date || 'Needs Review';

    parsed.medications = (parsed.medications || []).map(m => {
      const dosage = (!m.dosage || m.dosage.trim().toLowerCase() === 'missing' || m.dosage.trim().toLowerCase() === 'n/a') ? 'Needs Review' : m.dosage.trim();
      const frequency = (!m.frequency || m.frequency.trim().toLowerCase() === 'missing' || m.frequency.trim().toLowerCase() === 'n/a') ? 'Needs Review' : m.frequency.trim();
      const duration = m.duration?.trim() || 'As directed';
      const instructions = m.instructions?.trim() || 'Follow doctor guidance';
      const confidence = Number.isFinite(m.confidence) ? Math.max(0, Math.min(1, m.confidence)) : 0;
      const needsReview = Boolean(m.needsReview || confidence < 0.65 || dosage === 'Needs Review' || frequency === 'Needs Review');

      return {
        ...m,
        dosage,
        frequency,
        duration,
        instructions,
        confidence,
        needsReview,
      };
    });

    console.log(`[Gemini] Verified ${parsed.medications.length} medications with ${(parsed.overallConfidence * 100).toFixed(0)}% confidence`);
    if (parsed.rawText) {
      console.log(`[Gemini] Extracted ${parsed.rawText.length} chars of raw text`);
    }

    return parsed;
  } catch (error) {
    console.error('[Gemini] Verification failed:', error);
    return {
      medications: [],
      corrections: [],
      overallConfidence: 0,
      rawText: '',
    };
  }
}

/**
 * Check if Gemini verification is enabled and configured.
 */
export function isGeminiEnabled(): boolean {
  return import.meta.env.VITE_ENABLE_AI !== 'false';
}

/**
 * Get the Gemini model instance for use by other modules (e.g., meal planning).
 */
export function getGeminiModel(): ServerModel {
  return getModel();
}

/**
 * Gemini Vision OCR — Extract text directly from a prescription image.
 * This is the easiest way to get OCR working: just needs a Gemini API key.
 * No model files needed.
 */
export async function geminiVisionOCR(
  imageSource: File | string
): Promise<{ text: string; confidence: number }> {
  const gemini = getModel();

  const prompt = `You are an expert medical OCR system. Extract ALL text from this prescription image exactly as written.

INSTRUCTIONS:
1. Read every line of text in the image, including the doctor's name, date, patient info, and all medications
2. Preserve the original formatting and line breaks
3. If handwriting is unclear, provide your best interpretation with [?] after uncertain words
4. Include dosages, frequencies, and any special instructions exactly as written
5. Do NOT add any commentary — just the extracted text

Return ONLY the extracted text, nothing else.`;

  try {
    // Convert File to base64 if needed
    let base64Data: string;
    let mimeType = 'image/jpeg';

    if (imageSource instanceof File) {
      mimeType = imageSource.type || 'image/jpeg';
      base64Data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          const result = reader.result as string;
          resolve(result.split(',')[1] || '');
        };
        reader.onerror = reject;
        reader.readAsDataURL(imageSource);
      });
    } else {
      // base64 data URL string processing
      const match = imageSource.match(/^data:([^;]+);base64,(.+)$/);
      if (match) {
        mimeType = match[1];
        base64Data = match[2];
      } else {
        base64Data = imageSource.replace(/^data:[^;]+;base64,/, '');
      }
    }

    const contentParts = [
      { text: prompt },
      {
        inlineData: {
          mimeType,
          data: base64Data,
        },
      },
    ];

    const result = await callWithRetry(
      m => m.generateContent(contentParts),
      {
        maxRetries: GEMINI_VISION_MAX_RETRIES,
        timeoutMs: GEMINI_VISION_TIMEOUT_MS,
      }
    );

    const extractedText = result.response.text().trim();
    console.log(`[Gemini Vision OCR] Extracted ${extractedText.length} characters`);

    return {
      text: extractedText,
      confidence: 0.85, // Gemini is generally high-confidence for printed text
    };
  } catch (error) {
    console.error('[Gemini Vision OCR] Failed:', error);
    throw error;
  }
}
