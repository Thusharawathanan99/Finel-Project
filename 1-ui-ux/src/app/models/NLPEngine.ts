import { Medication } from './Medication';
import { parseMedications, ParsedMedication, extractPrescriptionMetadata } from '../ml/nlp/MedicationParser';
import { runEnsemble, EnsembleResult, ModelSource } from '../ml/ensemble/EnsembleOrchestrator';

export interface NLPResult {
  predictionId?: string;
  patientName?: string;
  doctorName?: string;
  date?: string;
  medications: Medication[];
  confidence: number;
  source: 'local' | 'cloud' | 'gemini' | 'combined' | 'ensemble';
  details: ParsedMedication[];
  geminiVerified: boolean;
  corrections: string[];
  processingTimeMs: number;
  /** Raw extracted text from AI models (Gemini rawText or Donut raw_text) */
  rawText?: string;
  /** Ensemble-specific data (present when ensemble mode is active) */
  ensemble?: {
    sourcesUsed: ModelSource[];
    modelAgreementRate: number;
    medicationSources: { drugName: string; sources: ModelSource[]; confidence: number }[];
    timings: EnsembleResult['timings'];
    donutAvailable: boolean;
  };
}

export class NLPEngine {
  modelVersion: string;

  constructor(modelVersion: string, _confidenceThreshold: number = 0.5) {
    this.modelVersion = modelVersion;
  }

  /** Use the shared, review-aware merge for every combination of available sources. */
  async parseTextToMedication(
    extractedText: string,
    imageBase64?: string,
    imageSource?: File | string,
    donutPromise?: Promise<any>
  ): Promise<NLPResult> {
    const startTime = performance.now();
    console.log(`NLP Engine v${this.modelVersion} parsing text...`);

    // The same reconciliation rules apply even when the Donut service is offline.
    // The orchestrator uses whichever sources are available, including local regex.
    return this.runEnsemblePipeline(extractedText, imageSource || '', imageBase64, startTime, donutPromise);
  }

  /**
   * Ensemble pipeline: Donut + Regex + Gemini in parallel.
   */
  private async runEnsemblePipeline(
    extractedText: string,
    imageSource: File | string,
    imageBase64: string | undefined,
    startTime: number,
    donutPromise?: Promise<any>
  ): Promise<NLPResult> {
    console.log('[NLP] 🚀 Running ENSEMBLE mode (Donut + Regex + Gemini)');

    const ensembleResult = await runEnsemble(extractedText, imageSource, imageBase64, donutPromise);

    const processingTimeMs = performance.now() - startTime;

    // Extract raw text from whichever AI model provided it
    const rawText = ensembleResult.rawOutputs.gemini?.rawText
      || ensembleResult.rawOutputs.donut?.raw_text
      || extractedText;

    return {
      predictionId: ensembleResult.predictionId,
      patientName: ensembleResult.patientName,
      doctorName: ensembleResult.doctorName,
      date: ensembleResult.date,
      medications: ensembleResult.medications.map(m => m.medication),
      confidence: ensembleResult.overallConfidence,
      source: 'ensemble',
      details: ensembleResult.rawOutputs.regex || [],
      geminiVerified: ensembleResult.sourcesUsed.includes('gemini'),
      corrections: ensembleResult.corrections,
      processingTimeMs,
      rawText,
      ensemble: {
        sourcesUsed: ensembleResult.sourcesUsed,
        modelAgreementRate: ensembleResult.modelAgreementRate,
        medicationSources: ensembleResult.medications.map(m => ({
          drugName: m.medication.drugName,
          sources: m.sources,
          confidence: m.confidence,
        })),
        timings: ensembleResult.timings,
        donutAvailable: ensembleResult.sourcesUsed.includes('donut'),
      },
    };
  }

  /**
   * Synchronous legacy method for backward compatibility.
   */
  parseTextToMedicationSync(extractedText: string): Medication[] {
    const results = parseMedications(extractedText);
    if (results.length > 0) {
      return results.map(r => r.medication);
    }
    // Fallback to basic parsing if no regex matches
    return this.basicParse(extractedText);
  }

  /**
   * Very basic line-by-line parsing as a last resort.
   */
  private basicParse(text: string): Medication[] {
    const medications: Medication[] = [];
    const lines = text.split('\n').filter(line => line.trim());

    for (const line of lines) {
      const pattern = /(\w+)\s+(\d+mg)\s+(.*)/i;
      const match = line.match(pattern);
      if (match) {
        const [, drugName, dosage, frequency] = match;
        medications.push(new Medication(drugName, dosage, frequency, undefined, 'As directed', 'Follow doctor guidance', 0.3, true));
      }
    }

    return medications;
  }
}
