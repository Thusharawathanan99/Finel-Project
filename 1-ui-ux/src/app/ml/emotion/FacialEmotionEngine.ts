/**
 * Facial Emotion Detection Engine
 * Uses face-api.js (built on TensorFlow.js) for real facial expression analysis.
 * Detects 7 emotions: angry, disgusted, fearful, happy, neutral, sad, surprised
 */

import * as faceapi from 'face-api.js';
import { EXPRESSION_WEIGHTS } from '../../../../../shared/experimentalWellness';

export interface EmotionDetectionResult {
  dominant: string;
  scores: Record<string, number>;
  wellnessScore: number;
  faceDetected: boolean;
  processingTimeMs: number;
}

// Emotion-to-wellness score mapping
// Higher score = more positive emotional state
const EMOTION_WELLNESS_WEIGHTS = EXPRESSION_WEIGHTS;

export class FacialEmotionEngine {
  private modelsLoaded: boolean = false;
  private modelsPath: string;
  private isLoading: boolean = false;

  constructor(modelsPath: string = '/models/face-api') {
    this.modelsPath = modelsPath;
  }

  /**
   * Lazy-load face-api.js models (tinyFaceDetector + faceExpressionNet).
   */
  async initialize(): Promise<void> {
    if (this.modelsLoaded || this.isLoading) return;

    this.isLoading = true;
    try {
      await Promise.all([
        faceapi.nets.tinyFaceDetector.loadFromUri(this.modelsPath),
        faceapi.nets.faceExpressionNet.loadFromUri(this.modelsPath),
      ]);
      this.modelsLoaded = true;
      console.log('[FaceAPI] Models loaded successfully');
    } catch (error) {
      console.error('[FaceAPI] Failed to load models:', error);
      throw new Error(`Face detection model loading failed: ${error}`);
    } finally {
      this.isLoading = false;
    }
  }

  /**
   * Analyze facial expression from an image element, canvas, or video element.
   */
  async analyze(
    input: HTMLImageElement | HTMLCanvasElement | HTMLVideoElement
  ): Promise<EmotionDetectionResult> {
    const startTime = performance.now();

    await this.initialize();

    try {
      if (typeof HTMLVideoElement !== 'undefined' && input instanceof HTMLVideoElement) {
        if (input.videoWidth === 0 || input.videoHeight === 0 || input.paused) {
          return {
            dominant: 'neutral',
            scores: {},
            wellnessScore: Number.NaN,
            faceDetected: false,
            processingTimeMs: performance.now() - startTime,
          };
        }
      }

      // Pass 1: Standard balance between speed and accuracy
      let detection = await faceapi
        .detectSingleFace(input, new faceapi.TinyFaceDetectorOptions({
          inputSize: 320,
          scoreThreshold: 0.20,
        }))
        .withFaceExpressions();

      // Pass 2: Sensitive pass with smaller input size for tricky lighting/angles
      if (!detection) {
        detection = await faceapi
          .detectSingleFace(input, new faceapi.TinyFaceDetectorOptions({
            inputSize: 224,
            scoreThreshold: 0.12,
          }))
          .withFaceExpressions();
      }

      // Pass 3: Detailed pass for distant or smaller faces
      if (!detection) {
        detection = await faceapi
          .detectSingleFace(input, new faceapi.TinyFaceDetectorOptions({
            inputSize: 416,
            scoreThreshold: 0.10,
          }))
          .withFaceExpressions();
      }

      if (!detection) {
        return {
          dominant: 'neutral',
          scores: {},
          wellnessScore: Number.NaN,
          faceDetected: false,
          processingTimeMs: performance.now() - startTime,
        };
      }

      const expressions = detection.expressions;
      const scores: Record<string, number> = {
        angry: expressions.angry,
        disgusted: expressions.disgusted,
        fearful: expressions.fearful,
        happy: expressions.happy,
        neutral: expressions.neutral,
        sad: expressions.sad,
        surprised: expressions.surprised,
      };

      // Find dominant emotion
      let dominant = 'neutral';
      let maxScore = 0;
      for (const [emotion, score] of Object.entries(scores)) {
        if (score > maxScore) {
          maxScore = score;
          dominant = emotion;
        }
      }

      // Calculate wellness score as weighted average of all emotions
      let wellnessScore = 0;
      for (const [emotion, probability] of Object.entries(scores)) {
        wellnessScore += probability * (EMOTION_WELLNESS_WEIGHTS[emotion] || 50);
      }
      wellnessScore = Math.round(Math.max(0, Math.min(100, wellnessScore)));
      const leading = Object.values(scores).sort((a, b) => b - a);
      if (detection.detection.score < 0.6 || leading[0] < 0.45 || leading[0] - leading[1] < 0.1) {
        dominant = 'uncertain'; wellnessScore = Number.NaN;
      }

      const processingTimeMs = performance.now() - startTime;
      console.log(`[FaceAPI] Detected emotion: ${dominant} (${(maxScore * 100).toFixed(1)}%) — wellness: ${wellnessScore}`);

      return {
        dominant,
        scores,
        wellnessScore,
        faceDetected: true,
        processingTimeMs,
      };
    } catch (error) {
      console.error('[FaceAPI] Analysis error:', error);
      return {
        dominant: 'neutral',
        scores: {},
        wellnessScore: Number.NaN,
        faceDetected: false,
        processingTimeMs: performance.now() - startTime,
      };
    }
  }

  /**
   * Analyze emotion from an image File or base64 URL.
   */
  async analyzeFromImage(source: File | string): Promise<EmotionDetectionResult> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = async () => {
        try {
          const result = await this.analyze(img);
          resolve(result);
        } catch (err) {
          reject(err);
        }
      };
      img.onerror = reject;

      if (source instanceof File) {
        const reader = new FileReader();
        reader.onloadend = () => {
          img.src = reader.result as string;
        };
        reader.readAsDataURL(source);
      } else {
        img.src = source;
      }
    });
  }

  /**
   * Start continuous emotion detection from a video stream.
   * Returns a cleanup function to stop the loop.
   */
  startContinuousDetection(
    videoElement: HTMLVideoElement,
    onResult: (result: EmotionDetectionResult) => void,
    intervalMs: number = 1000
  ): () => void {
    let running = true;

    const detectLoop = async () => {
      while (running) {
        try {
          if (videoElement.readyState >= 2 && videoElement.videoWidth > 0 && !videoElement.paused) {
            const result = await this.analyze(videoElement);
            if (running) onResult(result);
          }
        } catch (err) {
          console.warn('[FaceAPI] Detection tick warning:', err);
        }
        await new Promise(r => setTimeout(r, intervalMs));
      }
    };

    this.initialize().then(() => detectLoop());

    return () => {
      running = false;
    };
  }

  isReady(): boolean {
    return this.modelsLoaded;
  }
}
