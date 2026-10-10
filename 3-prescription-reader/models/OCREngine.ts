import { CRNNOCREngine, OCRResult } from '../client/crnn-ocr/CRNNOCREngine';
import { geminiVisionOCR, isGeminiEnabled } from '../client/nlp/geminiService';
import { analyzePrescriptionWithDonut, isDonutEnabledSync, checkDonutHealth } from '../client/nlp/donutService';

export class OCREngine {
  modelVersion: string;
  private crnnEngine: CRNNOCREngine;
  private _isInitialized: boolean = false;
  private _crnnAvailable: boolean = false;
  private _donutAvailable: boolean = false;
  private preferDonutOCR: boolean;
  private enableCrnnOCR: boolean;

  constructor(modelVersion: string) {
    this.modelVersion = modelVersion;
    this.crnnEngine = new CRNNOCREngine('/models/crnn/crnn.onnx', false);
    this.preferDonutOCR = import.meta.env.VITE_PREFER_DONUT_OCR !== 'false';
    this.enableCrnnOCR = import.meta.env.VITE_ENABLE_CRNN_OCR === 'true';
  }

  /**
   * Lazy-initialize the CRNN model and check Donut backend.
   * Call this before first extraction or let extractText() handle it automatically.
   */
  async initialize(): Promise<void> {
    if (this._isInitialized) return;
    this._isInitialized = true;

    // Check Donut backend availability
    try {
      const health = await checkDonutHealth();
      this._donutAvailable = health.status === 'ok';
      if (this._donutAvailable) {
        console.log(`[OCREngine] 🧠 Donut backend available (${health.device})`);
      }
    } catch {
      this._donutAvailable = false;
    }

    // CRNN model files are optional and not bundled by default.
    if (!this.enableCrnnOCR) {
      this._crnnAvailable = false;
      if (this._donutAvailable) {
        console.log('[OCREngine] CRNN disabled — Donut + Gemini ensemble will handle extraction');
      } else if (isGeminiEnabled()) {
        console.log('[OCREngine] CRNN disabled (set VITE_ENABLE_CRNN_OCR=true to enable) — using Gemini Vision OCR');
      }
      return;
    }

    // Try CRNN initialization
    try {
      await this.crnnEngine.initialize();
      this._crnnAvailable = true;
      console.log(`OCR Engine v${this.modelVersion} initialized (CRNN backend)`);
    } catch (error) {
      this._crnnAvailable = false;
      if (this._donutAvailable) {
        console.log(`[OCREngine] CRNN not available — Donut backend will be used`);
      } else if (isGeminiEnabled()) {
        console.log(`[OCREngine] CRNN not available — using Gemini Vision OCR`);
      } else {
        console.warn('[OCREngine] No OCR backend available. Configure server GEMINI_API_KEY or start the Donut server.');
      }
    }
  }

  /**
   * Extract text from a prescription image.
   * 
   * Priority chain:
   *  1. CRNN model (if .onnx file is present) — fully offline
   *  2. Gemini Vision OCR (if API key is set) — cloud-based, no model files needed
   *  3. Error message
   * 
   * Note: When Donut backend is available, the NLPEngine's ensemble mode
   * bypasses OCR entirely — Donut goes image → medications directly.
   * This OCR engine is still used for text extraction display purposes.
   */
  async extractText(imageSource: File | string): Promise<OCRResult> {
    const startTime = performance.now();
    console.log(`OCR Engine v${this.modelVersion} processing image...`);

    await this.initialize();

    // When Donut backend is available, use CRNN for text extraction (feeds regex parser).
    // IMPORTANT: Do NOT call geminiVisionOCR here — it creates a leaked promise
    // that retries in the background, doubling API requests and causing sustained 503s.
    // The ensemble's Gemini task is the ONLY place that should call Gemini.
    if (this._donutAvailable && this.preferDonutOCR) {
      if (this._crnnAvailable) {
        try {
          console.log('[OCREngine] ⚡ Using CRNN for text extraction (feeds regex parser in ensemble)');
          return await this.crnnEngine.extractText(imageSource);
        } catch (error) {
          console.warn('[OCREngine] CRNN inference failed:', error);
        }
      }
      // No CRNN or CRNN failed — return empty, ensemble Gemini will handle it
      console.log('[OCREngine] ⚡ No local OCR — ensemble Gemini will extract directly from image');
      return {
        text: '',
        confidence: 0,
        lines: [],
        processingTimeMs: performance.now() - startTime,
      };
    }

    // Priority 1: Try CRNN model
    if (this._crnnAvailable) {
      try {
        return await this.crnnEngine.extractText(imageSource);
      } catch (error) {
        console.warn('[OCREngine] CRNN inference failed, trying Gemini:', error);
      }
    }

    // Priority 2: Gemini Vision OCR (just needs an API key)
    if (isGeminiEnabled()) {
      try {
        const result = await geminiVisionOCR(imageSource);
        const processingTimeMs = performance.now() - startTime;

        console.log(`[OCREngine] Gemini Vision OCR completed in ${processingTimeMs.toFixed(0)}ms`);

        return {
          text: result.text,
          confidence: result.confidence,
          lines: result.text.split('\n').filter(l => l.trim()).map((text, i) => ({
            text,
            confidence: result.confidence,
            lineIndex: i,
            region: { y: 0, h: 0 },
          })),
          processingTimeMs,
        };
      } catch (error) {
        console.error('[OCREngine] Gemini Vision OCR failed:', error);
      }
    }

    // No backend available
    return {
      text: '',
      confidence: 0,
      lines: [],
      processingTimeMs: performance.now() - startTime,
    };
  }

  /**
   * Check which OCR backend is active.
   */
  getBackendStatus(): { crnn: boolean; gemini: boolean; donut: boolean } {
    return {
      crnn: this._crnnAvailable,
      gemini: isGeminiEnabled(),
      donut: this._donutAvailable,
    };
  }

  isReady(): boolean {
    return this._donutAvailable || this._crnnAvailable || isGeminiEnabled();
  }

  async dispose(): Promise<void> {
    await this.crnnEngine.dispose();
    this._isInitialized = false;
    this._crnnAvailable = false;
  }
}
