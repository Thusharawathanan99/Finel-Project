import type { TrackedLiveFrame, LiveEvidenceMode } from './liveFace';
export type LiveFaceQualityState = 'waiting' | 'unavailable' | 'noFace' | 'observed' | 'limited' | 'stale';
export type LiveFaceQualityIssue = 'waiting' | 'invalidFrame' | 'invalidMetrics' | 'noFace' | 'multipleFaces' | 'lowConfidence' | 'smallFace' | 'uncertainExpression' | 'staleFrame' | 'slowProcessing' | 'slowUpdates' | 'cpuBackend' | 'dimPixels' | 'clippedPixels' | 'lowImageDetail' | 'eyeLineTilt';
export type LiveFaceQualityBackend = 'cpu' | 'wasm' | 'webgl' | 'webgl2';
export const LIVE_FACE_QUALITY_THRESHOLDS: Readonly<{ minDetectionConfidence: number; minFaceArea: number; minFacePixels: number; staleAfterMs: number; slowProcessingAfterMs: number; minUpdateRateHz: number; minMeanLuminance: number; maxMeanLuminance: number; maxDarkFraction: number; maxClippedFraction: number; minLaplacianVariance: number; maxEyeTiltDegrees: number }>;
export interface LiveFaceQualityOptions {
  completedRateHz?: number; fps?: number; frameAgeMs?: number; now?: number; backend?: LiveFaceQualityBackend | null;
  mode?: 'live' | 'photo';
}
export interface LiveFaceQualitySummary {
  readonly state: LiveFaceQualityState; readonly issues: readonly LiveFaceQualityIssue[];
  readonly reasonCodes: readonly LiveFaceQualityIssue[];
  readonly faceCount: number | null; readonly stableCount: number | null; readonly uncertainCount: number | null;
  readonly lowConfidenceCount: number | null; readonly smallFaceCount: number | null;
  readonly processingTimeMs: number | null; readonly completedRateHz: number | null;
  readonly frameAgeMs: number | null; readonly backend: LiveFaceQualityBackend | null;
  readonly evidenceMode: LiveEvidenceMode | null;
}
export interface LiveFaceQualityCopy {
  readonly title: string; readonly faces: string; readonly stable: string; readonly uncertain: string;
  readonly updateRate: string; readonly processingTime: string; readonly status: string; readonly unknown: string;
  readonly evidenceNotice: string; readonly singleFrameNotice: string; readonly notHealth: string;
  readonly states: Readonly<Record<LiveFaceQualityState, string>>;
  readonly issues: Readonly<Record<LiveFaceQualityIssue, string>>;
  readonly tips: Readonly<Record<LiveFaceQualityIssue, string>>;
}
export function getLiveFaceQualityCopy(language?: string): Readonly<LiveFaceQualityCopy>;
/** Unknown/malformed evidence is unavailable, never a zero-face or healthy result. */
export function summarizeLiveFaceQuality(input: TrackedLiveFrame | null | undefined | unknown, options?: LiveFaceQualityOptions): Readonly<LiveFaceQualitySummary>;
