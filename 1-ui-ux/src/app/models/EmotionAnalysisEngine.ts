import { EmotionalState } from './EmotionalState';
import { FacialEmotionEngine, EmotionDetectionResult } from '../ml/emotion/FacialEmotionEngine';
import { VocalToneEngine, VocalToneResult } from '../ml/audio/VocalToneEngine';

export interface EmotionAnalysisResult {
  emotionalState: EmotionalState;
  facialResult?: EmotionDetectionResult;
  vocalResult?: VocalToneResult;
  dominantFacialEmotion?: string;
  dominantVocalTone?: string;
  processingTimeMs: number;
  unavailableModalities?: string[];
}

export class EmotionAnalysisEngine {
  modelVersion: string;
  private facialEngine: FacialEmotionEngine;
  private vocalEngine: VocalToneEngine;

  constructor(modelVersion: string) {
    this.modelVersion = modelVersion;
    this.facialEngine = new FacialEmotionEngine('/models/face-api');
    this.vocalEngine = new VocalToneEngine();
  }

  /**
   * Initialize both engines (lazy-loads models).
   */
  async initialize(): Promise<void> {
    await Promise.allSettled([
      this.facialEngine.initialize(),
      this.vocalEngine.initialize(),
    ]);
  }

  /**
   * Analyze facial expression from an image source.
   */
  async analyzeFacialExpression(imageSource: File | string): Promise<number> {
    console.log(`Analyzing facial expression with model v${this.modelVersion}...`);
    try {
      const result = await this.facialEngine.analyzeFromImage(imageSource);
      if (!result.faceDetected || !Number.isFinite(result.wellnessScore)) throw new Error('No usable face was detected.');
      return result.wellnessScore;
    } catch (error) {
      console.warn('[EmotionEngine] Facial analysis failed:', error);
      throw new Error('Facial analysis is unavailable. Please use a clear image with a visible face.');
    }
  }

  /**
   * Analyze facial expression from a video/canvas/image element.
   */
  async analyzeFacialElement(
    element: HTMLImageElement | HTMLCanvasElement | HTMLVideoElement
  ): Promise<EmotionDetectionResult> {
    await this.facialEngine.initialize();
    return this.facialEngine.analyze(element);
  }

  /**
   * Analyze vocal tone from an audio file.
   */
  async analyzeVocalTone(audioSource: File): Promise<number> {
    console.log(`Analyzing vocal tone with model v${this.modelVersion}...`);
    try {
      const result = await this.vocalEngine.analyzeFile(audioSource);
      return result.wellnessScore;
    } catch (error) {
      console.warn('[EmotionEngine] Vocal analysis failed:', error);
      throw new Error('Vocal analysis is unavailable. Please record audible speech.');
    }
  }

  /**
   * Record from microphone and analyze for vocal tone.
   */
  async recordAndAnalyzeVocal(durationMs: number = 5000): Promise<VocalToneResult> {
    await this.vocalEngine.initialize();
    return this.vocalEngine.recordAndAnalyze(durationMs);
  }

  /**
   * Generate a combined emotional state from facial and vocal scores.
   */
  generateEmotionalState(facialScore?: number, vocalScore?: number): EmotionalState {
    const scores = [facialScore, vocalScore].filter((score): score is number => typeof score === 'number' && Number.isFinite(score) && score >= 0 && score <= 100);
    if (!scores.length) throw new Error('Emotion analysis is unavailable: no valid facial or vocal measurement.');
    return new EmotionalState(new Date(), Math.round(scores.reduce((a, b) => a + b, 0) / scores.length));
  }

  /**
   * Full analysis: combine facial + vocal into a single EmotionalState.
   */
  async analyzeResident(
    facialImage?: File | string,
    vocalAudio?: File
  ): Promise<EmotionAnalysisResult> {
    const startTime = performance.now();
    let facialScore: number | undefined;
    let vocalScore: number | undefined;
    const unavailableModalities: string[] = [];
    let facialResult: EmotionDetectionResult | undefined;
    let vocalResult: VocalToneResult | undefined;

    // Run both analyses in parallel when possible
    const tasks: Promise<void>[] = [];

    if (facialImage) {
      tasks.push(
        (async () => {
          try {
            if (facialImage instanceof File || typeof facialImage === 'string') {
              facialResult = await this.facialEngine.analyzeFromImage(facialImage);
              if (!facialResult.faceDetected || !Number.isFinite(facialResult.wellnessScore)) throw new Error('No usable face detected.');
              facialScore = facialResult.wellnessScore;
            }
          } catch (error) {
            facialResult = undefined;
            unavailableModalities.push('facial');
            console.warn('[EmotionEngine] Facial analysis failed:', error);
          }
        })()
      );
    }

    if (vocalAudio) {
      tasks.push(
        (async () => {
          try {
            vocalResult = await this.vocalEngine.analyzeFile(vocalAudio);
            if (!Number.isFinite(vocalResult.wellnessScore)) throw new Error('Invalid vocal measurement.');
            vocalScore = vocalResult.wellnessScore;
          } catch (error) {
            vocalResult = undefined;
            unavailableModalities.push('vocal');
            console.warn('[EmotionEngine] Vocal analysis failed:', error);
          }
        })()
      );
    }

    await Promise.all(tasks);

    const emotionalState = this.generateEmotionalState(facialScore, vocalScore);
    const processingTimeMs = performance.now() - startTime;

    return {
      emotionalState,
      unavailableModalities,
      facialResult,
      vocalResult,
      dominantFacialEmotion: facialResult?.dominant,
      dominantVocalTone: vocalResult?.dominant,
      processingTimeMs,
    };
  }

  /**
   * Start continuous facial emotion monitoring from webcam.
   */
  startContinuousMonitoring(
    videoElement: HTMLVideoElement,
    onResult: (result: EmotionDetectionResult) => void,
    intervalMs: number = 2000
  ): () => void {
    return this.facialEngine.startContinuousDetection(videoElement, onResult, intervalMs);
  }

  /**
   * Check if engines are ready.
   */
  isReady(): { facial: boolean; vocal: boolean } {
    return {
      facial: this.facialEngine.isReady(),
      vocal: this.vocalEngine.isReady(),
    };
  }
}
