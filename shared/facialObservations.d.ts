export type FacialObservationState = 'unavailable' | 'observing' | 'no-significant-change' | 'repeated-change';
export type FacialMetricKey = 'leftEyeOpeningRatio' | 'rightEyeOpeningRatio' | 'mouthOpeningRatio' | 'mouthCornerAsymmetryRatio' | 'eyeLineRollDegrees';
export type FacialObservationReason = 'waiting' | 'invalid-frame' | 'timestamp-order' | 'no-face' | 'multiple-faces' | 'missing-track' |
  'quality-unavailable' | 'small-face' | 'low-confidence' | 'dim-pixels' | 'clipped-pixels' | 'low-detail' |
  'tilted-view' | 'oblique-geometry' | 'invalid-landmarks' | 'view-changed' | 'sampled-only';
export type FacialBaselineStatus = 'off' | 'collecting' | 'ready';
/** Dimensionless pixel-geometry ratios; tilt in degrees. None is confidence or a medical score. */
export type FacialObservationMetrics = Record<FacialMetricKey, number>;
export interface FacialObservationHistoryEntry {
  capturedAt: string; metrics: FacialObservationMetrics; state: FacialObservationState; changedMetrics: FacialMetricKey[];
}
export interface FacialObservationSnapshot {
  version: 'facial-observation-v1'; state: FacialObservationState;
  capturedAt: string | null; completedAt: string | null; metrics: FacialObservationMetrics | null;
  qualityReasons: FacialObservationReason[]; changedMetrics: FacialMetricKey[];
  samplingGapMs: number | null; temporalContinuity: 'reset' | 'sampled' | 'sparse';
  sampleCount: number; windowDurationMs: number; comparison: 'session-baseline' | 'sampled-geometry';
  baseline: { status: FacialBaselineStatus; sampleCount: number; requiredSamples: number; minimumDurationMs: number;
    reason: 'tracking-reset' | 'unstable-samples' | null };
  /** Maximum 60 eligible entries in a 30-second capture window; no photos, IDs or embeddings. */
  history: FacialObservationHistoryEntry[];
}
export interface FacialObservationCopy {
  title: string; states: Readonly<Record<FacialObservationState, string>>;
  metrics: Readonly<Record<FacialMetricKey, string>>; metricLabels: Readonly<Record<FacialMetricKey, string>>;
  baselineStatuses: Readonly<Record<FacialBaselineStatus, string>>; baselineStates: Readonly<Record<FacialBaselineStatus, string>>;
  reasons: Readonly<Record<FacialObservationReason, string>>; changeLabels: Readonly<Record<FacialMetricKey, string>>;
  notice: string; researchNotice: string; notHealth: string; sampledNotice: string; sparseNotice: string; privacy: string;
  baselineConsent: string; baselineStart: string; baselineReset: string; startBaseline: string; resetBaseline: string;
  report: string; share: string; timeline: string; clearSession: string; downloadReport: string; downloadFailed: string;
  baselineProgress: string; ratioUnit: string; degreesUnit: string; status: string; captureTime: string; completionTime: string;
  samples: string; samplingGap: string; baseline: string; unknown: string; unavailable: string;
  checkInSuggested: string; changedExplanation: string; noChangeExplanation: string; observingExplanation: string; noBaseline: string;
  baselineResetReason: string; baselineUnstable: string; baselineComparison: string; geometryComparison: string;
}
export const FACIAL_OBSERVATION_LIMITS: Readonly<{ historySamples: number; windowMs: number; repeatedSamples: number;
  repeatedSpanMs: number; baselineSamples: number; baselineSpanMs: number; sparseGapMs: number; maximumGapMs: number }>;
export function getFacialObservationCopy(language?: string): Readonly<FacialObservationCopy>;
/** Input uses actual normalized 68-point frames from createLiveFaceTracker.update(). Invalid or missing inputs withhold observations. */
export function createFacialObservationSession(): {
  update(trackedFrame: unknown): FacialObservationSnapshot;
  /** Caller presents consent text. true is required; reference remains in this session and single anonymous track only. */
  startBaseline(options: { consent: true }): FacialObservationSnapshot;
  resetBaseline(): FacialObservationSnapshot;
  reset(): FacialObservationSnapshot;
};
/** Exports whitelisted sampled measurements and limitations, never a diagnosis or health clearance. */
export function buildFacialObservationReport(snapshot: unknown, language?: string): string;
