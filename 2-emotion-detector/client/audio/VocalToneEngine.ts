/**
 * Vocal Tone Analysis Engine
 * Uses acoustic heuristics and the Web Audio API; scores are not clinical measurements.
 * Analyzes pitch, energy, and spectral features to determine emotional tone.
 */

export type VocalToneCategory = 'calm' | 'stressed' | 'anxious' | 'happy' | 'flat' | 'energetic' | 'distressed';

export interface VocalToneResult {
  dominant: VocalToneCategory;
  scores: Record<VocalToneCategory, number>;
  wellnessScore: number;
  features: AudioFeatures;
  processingTimeMs: number;
  needsReview: boolean;
  analysisKind: 'acoustic-heuristic';
}

export interface AudioFeatures {
  pitchMean: number;
  pitchVariance: number;
  energy: number;
  spectralCentroid: number;
  zeroCrossingRate: number;
  speechRate: number;
}

// Tone-to-wellness score mapping
const TONE_WELLNESS_WEIGHTS: Record<VocalToneCategory, number> = {
  happy: 90,
  energetic: 80,
  calm: 75,
  flat: 40,
  anxious: 25,
  stressed: 20,
  distressed: 10,
};

export class VocalToneEngine {
  private audioContext: AudioContext | null = null;
  private isInitialized: boolean = false;

  constructor() {
    // AudioContext will be created on first use (requires user gesture)
  }

  /**
   * Initialize the audio context.
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    this.audioContext = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    this.isInitialized = true;
    console.log('[VocalTone] Audio engine initialized');
  }

  /**
   * Analyze vocal tone from an audio buffer.
   */
  async analyzeBuffer(audioBuffer: AudioBuffer): Promise<VocalToneResult> {
    const startTime = performance.now();
    await this.initialize();

    const channelData = audioBuffer.getChannelData(0);
    const sampleRate = audioBuffer.sampleRate;

    if (!Number.isFinite(sampleRate) || sampleRate < 8000 || sampleRate > 192000 || channelData.length < Math.max(2048, sampleRate / 4) || channelData.some(value => !Number.isFinite(value))) throw new Error('Vocal analysis requires a valid recording with audible speech.');
    const rms = Math.sqrt(channelData.reduce((sum, value) => sum + value * value, 0) / channelData.length);
    if (rms < 0.003) throw new Error('No audible speech detected. Please record again.');

    // Extract audio features
    const features = this.extractFeatures(channelData, sampleRate);

    // Classify tone based on features
    if (!Object.values(features).every(Number.isFinite) || features.pitchMean <= 0) throw new Error('No voiced speech was detected. Please record again.');
    const scores = this.classifyTone(features);
    if (!Object.values(scores).every(Number.isFinite)) throw new Error('Vocal analysis is unavailable for this recording.');

    // Find dominant tone
    let dominant: VocalToneCategory = 'calm';
    let maxScore = 0;
    for (const [tone, score] of Object.entries(scores)) {
      if (score > maxScore) {
        maxScore = score;
        dominant = tone as VocalToneCategory;
      }
    }

    // Compute wellness score
    let wellnessScore = 0;
    for (const [tone, probability] of Object.entries(scores)) {
      wellnessScore += probability * TONE_WELLNESS_WEIGHTS[tone as VocalToneCategory];
    }
    wellnessScore = Math.round(Math.max(0, Math.min(100, wellnessScore)));

    const processingTimeMs = performance.now() - startTime;
    console.log(`[VocalTone] Tone: ${dominant} (${(maxScore * 100).toFixed(1)}%) — wellness: ${wellnessScore}`);

    return {
      dominant,
      scores,
      wellnessScore,
      features,
      processingTimeMs,
      needsReview: true,
      analysisKind: 'acoustic-heuristic',
    };
  }

  /**
   * Analyze vocal tone from a File (WAV, MP3, etc.).
   */
  async analyzeFile(file: File): Promise<VocalToneResult> {
    await this.initialize();

    const arrayBuffer = await file.arrayBuffer();
    const audioBuffer = await this.audioContext!.decodeAudioData(arrayBuffer);
    return this.analyzeBuffer(audioBuffer);
  }

  /**
   * Record audio from microphone and analyze.
   * Returns a promise that resolves after the specified duration.
   */
  async recordAndAnalyze(durationMs: number = 5000): Promise<VocalToneResult> {
    await this.initialize();
    if (!Number.isFinite(durationMs) || durationMs < 250 || durationMs > 30000) throw new Error('Recording duration must be between 250ms and 30 seconds.');

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mediaRecorder = new MediaRecorder(stream);
    const chunks: Blob[] = [];

    return new Promise((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout>;
      mediaRecorder.onerror = () => {
        clearTimeout(timer);
        stream.getTracks().forEach(t => t.stop());
        reject(new Error('Audio recording failed. Please try again.'));
      };
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        clearTimeout(timer);
        stream.getTracks().forEach(t => t.stop());
        try {
          const blob = new Blob(chunks, { type: 'audio/webm' });
          const arrayBuffer = await blob.arrayBuffer();
          const audioBuffer = await this.audioContext!.decodeAudioData(arrayBuffer);
          const result = await this.analyzeBuffer(audioBuffer);
          resolve(result);
        } catch (err) {
          reject(err);
        }
      };

      mediaRecorder.start();
      timer = setTimeout(() => { if (mediaRecorder.state !== 'inactive') mediaRecorder.stop(); }, durationMs);
    });
  }

  /**
   * Extract audio features from raw sample data.
   */
  private extractFeatures(samples: Float32Array, sampleRate: number): AudioFeatures {
    const frameSize = 2048;
    const hopSize = 512;
    const numFrames = Math.max(0, 1 + Math.floor((samples.length - frameSize) / hopSize));

    // --- Pitch estimation via autocorrelation ---
    const pitches: number[] = [];
    for (let f = 0; f < Math.min(numFrames, 50); f++) {
      const offset = f * hopSize;
      const frame = samples.slice(offset, offset + frameSize);
      const pitch = this.estimatePitch(frame, sampleRate);
      if (pitch > 50 && pitch < 500) {
        pitches.push(pitch);
      }
    }

    const pitchMean = pitches.length > 0
      ? pitches.reduce((a, b) => a + b, 0) / pitches.length
      : 0;
    const pitchVariance = pitches.length > 1
      ? pitches.reduce((s, p) => s + (p - pitchMean) ** 2, 0) / pitches.length
      : 0;

    // --- RMS Energy ---
    let sumSquares = 0;
    for (let i = 0; i < samples.length; i++) {
      sumSquares += samples[i] * samples[i];
    }
    const energy = Math.sqrt(sumSquares / samples.length);

    // --- Spectral Centroid ---
    const fft = this.computeFFTMagnitude(samples.slice(0, frameSize));
    let weightedSum = 0;
    let magnitudeSum = 0;
    for (let i = 0; i < fft.length; i++) {
      const freq = (i * sampleRate) / (fft.length * 2);
      weightedSum += freq * fft[i];
      magnitudeSum += fft[i];
    }
    const spectralCentroid = magnitudeSum > 0 ? weightedSum / magnitudeSum : 0;

    // --- Zero Crossing Rate ---
    let zeroCrossings = 0;
    for (let i = 1; i < samples.length; i++) {
      if ((samples[i] >= 0 && samples[i - 1] < 0) || (samples[i] < 0 && samples[i - 1] >= 0)) {
        zeroCrossings++;
      }
    }
    const zeroCrossingRate = zeroCrossings / samples.length;

    // --- Speech Rate (estimated from energy envelope peaks) ---
    const envelopeFrameSize = Math.floor(sampleRate * 0.05); // 50ms frames
    const envelope: number[] = [];
    for (let i = 0; i < samples.length; i += envelopeFrameSize) {
      let frameEnergy = 0;
      const end = Math.min(i + envelopeFrameSize, samples.length);
      for (let j = i; j < end; j++) {
        frameEnergy += samples[j] * samples[j];
      }
      envelope.push(Math.sqrt(frameEnergy / (end - i)));
    }

    // Count peaks in envelope (syllable-like events)
    let peakCount = 0;
    const envMean = envelope.reduce((a, b) => a + b, 0) / envelope.length;
    for (let i = 1; i < envelope.length - 1; i++) {
      if (envelope[i] > envelope[i - 1] && envelope[i] > envelope[i + 1] && envelope[i] > envMean * 1.5) {
        peakCount++;
      }
    }
    const durationSec = samples.length / sampleRate;
    const speechRate = durationSec > 0 ? peakCount / durationSec : 0;

    return {
      pitchMean,
      pitchVariance,
      energy,
      spectralCentroid,
      zeroCrossingRate,
      speechRate,
    };
  }

  /**
   * Estimate fundamental frequency using autocorrelation.
   */
  private estimatePitch(frame: Float32Array, sampleRate: number): number {
    const minLag = Math.floor(sampleRate / 500); // 500 Hz max
    const maxLag = Math.floor(sampleRate / 50);  // 50 Hz min

    let bestCorrelation = 0;
    let bestLag = 0;

    for (let lag = minLag; lag < Math.min(maxLag, frame.length); lag++) {
      let correlation = 0;
      for (let i = 0; i < frame.length - lag; i++) {
        correlation += frame[i] * frame[i + lag];
      }
      if (correlation > bestCorrelation) {
        bestCorrelation = correlation;
        bestLag = lag;
      }
    }

    return bestLag > 0 ? sampleRate / bestLag : 0;
  }

  /**
   * Simple FFT magnitude computation (DFT for small windows).
   */
  private computeFFTMagnitude(frame: Float32Array): Float32Array {
    const N = frame.length;
    const halfN = Math.floor(N / 2);
    const magnitudes = new Float32Array(halfN);

    for (let k = 0; k < halfN; k++) {
      let real = 0;
      let imag = 0;
      for (let n = 0; n < N; n++) {
        const angle = (2 * Math.PI * k * n) / N;
        real += frame[n] * Math.cos(angle);
        imag -= frame[n] * Math.sin(angle);
      }
      magnitudes[k] = Math.sqrt(real * real + imag * imag);
    }

    return magnitudes;
  }

  /**
   * heuristic-based tone classification from audio features.
   * Uses feature thresholds derived from vocal emotion research.
   */
  private classifyTone(features: AudioFeatures): Record<VocalToneCategory, number> {
    const scores: Record<VocalToneCategory, number> = {
      calm: 0,
      stressed: 0,
      anxious: 0,
      happy: 0,
      flat: 0,
      energetic: 0,
      distressed: 0,
    };

    const { pitchMean, pitchVariance, energy, spectralCentroid, zeroCrossingRate, speechRate } = features;

    // Calm: low energy, moderate pitch, low variance
    scores.calm = this.sigmoid(
      -2 * energy + 0.5 - Math.abs(pitchMean - 150) / 200 - pitchVariance / 2000
    );

    // Happy: higher pitch, higher variance, moderate-high energy
    scores.happy = this.sigmoid(
      pitchMean / 300 + pitchVariance / 3000 + energy * 3 - 1
    );

    // Stressed: high energy, high pitch, fast speech
    scores.stressed = this.sigmoid(
      energy * 4 + pitchMean / 200 + speechRate / 5 - 2
    );

    // Anxious: high pitch variance, moderate energy, fast speech
    scores.anxious = this.sigmoid(
      pitchVariance / 2000 + speechRate / 4 + zeroCrossingRate * 20 - 1.5
    );

    // Flat: low pitch variance, low energy, low speech rate
    scores.flat = this.sigmoid(
      -pitchVariance / 500 - energy * 5 - speechRate / 3 + 1
    );

    // Energetic: high energy, high speech rate, high spectral centroid
    scores.energetic = this.sigmoid(
      energy * 5 + speechRate / 3 + spectralCentroid / 2000 - 2
    );

    // Distressed: very high pitch, high energy, high variance
    scores.distressed = this.sigmoid(
      pitchMean / 200 + pitchVariance / 1000 + energy * 5 - 3
    );

    // Normalize to sum to 1
    const total = Object.values(scores).reduce((a, b) => a + b, 0);
    if (total > 0) {
      for (const key of Object.keys(scores) as VocalToneCategory[]) {
        scores[key] /= total;
      }
    }

    return scores;
  }

  private sigmoid(x: number): number {
    return 1 / (1 + Math.exp(-x));
  }

  isReady(): boolean {
    return this.isInitialized;
  }

  async dispose(): Promise<void> {
    if (this.audioContext) {
      await this.audioContext.close();
      this.audioContext = null;
    }
    this.isInitialized = false;
  }
}
