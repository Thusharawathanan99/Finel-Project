import type { FaceCopy } from './faceReport';
export type LiveExpression = 'angry' | 'disgusted' | 'fearful' | 'happy' | 'neutral' | 'sad' | 'surprised';
export type LiveExpressionResult = LiveExpression | 'uncertain';
export type LiveExpressionScores = Record<LiveExpression, number>;
export type LiveEvidenceMode = 'single-frame' | 'temporal';
export type LiveUncertaintyReason = 'small-face' | 'low-face-confidence' | 'weak-expression-score' | 'close-leading-scores' | 'history-disagreement' | 'collecting-evidence';
/** Face-ROI pixel facts and 2-D eye-line tilt; thresholds are uncalibrated heuristics. */
export interface FaceImageQuality {
  version: 'face-image-quality-v1'; sampleWidth: number; sampleHeight: number;
  meanLuminance: number; darkFraction: number; clippedFraction: number;
  laplacianVariance: number; eyeTiltDegrees: number | null;
}
export interface RawLiveFace {
  box: { x: number; y: number; width: number; height: number };
  detectionConfidence: number;
  scores: LiveExpressionScores;
  landmarks: Array<{ x: number; y: number }>;
  imageQuality?: FaceImageQuality;
}
export interface RawLiveFrame {
  version: 'live-face-v1'; provider: 'face-api.js-local'; width: number; height: number;
  capturedAt: string; completedAt?: string; processingTimeMs: number; faces: RawLiveFace[];
}
export interface TrackedLiveFace extends RawLiveFace {
  id: string; smoothedScores: LiveExpressionScores; expression: LiveExpressionResult;
  expressionConfidence: number; stable: boolean;
  evidenceMode: LiveEvidenceMode; evidenceFrames: number; evidenceDurationMs: number;
  uncertaintyReason?: LiveUncertaintyReason | null;
}
export interface TrackedLiveFrame extends Omit<RawLiveFrame, 'faces'> { faces: TrackedLiveFace[]; }
export interface LiveTrackerOptions {
  alpha?: number; minConfidence?: number; minMargin?: number; stableFrames?: number;
  minFacePixels?: number; minFaceArea?: number; minEvidenceMs?: number;
}
export interface LiveFaceTracker { update(input: unknown): TrackedLiveFrame; reset(): void; }
export interface LiveFaceCopy extends FaceCopy {
  studio:string; studioSubtitle:string; patientContext:string; signalProfile:string;
  liveTitle: string; localProcessing: string; localPrivacy: string; startCamera: string; stopCamera: string;
  modelLoading: string; fps: string; updateRate: string; liveResults: string; updating: string; latestFrame: string; processingTime: string; milliseconds: string; expression: string;
  expressionConfidence: string; stable: string; uncertain: string; rawScores: string; smoothedScores: string;
  evidenceMode: string; singleFrame: string; temporalEvidence: string; evidenceFrames: string; evidenceDuration: string;
  landmarks: string; probabilityHelp: string; likelihoodHelp: string; trackingHelp: string; reportAt: string;
  analysisCompletedAt: string; captureToResultDelay: string;
  downloadReport: string; modelUnavailable: string; liveError: string; usePhoto: string; cloudPhoto: string;
  live: string; paused: string; waitingFresh: string; balanced: string; enhanced: string; detectorMode: string;
  cloudAssist: string; cloudConsent: string; cloudWaiting: string; cloudLastChecked: string; showLandmarks: string;
  qualityHint: string; sampledPreview: string; localPhoto: string; cloudReport: string; cloudError: string;
  stop: string; retry: string;
  highestModelScore: string; notConfirmed: string; rawModelScores: string; uncertaintyReason: string;
  noModelScores: string; noUniqueLeadingScore: string; unconfirmedExplanation: string;
  uncertaintyReasons: Readonly<Record<LiveUncertaintyReason, string>>;
  expressions: Readonly<Record<LiveExpressionResult, string>>;
}
export const LIVE_EXPRESSIONS: ReadonlyArray<LiveExpression>;
export const expressionEmoji: Readonly<Record<LiveExpressionResult, string>>;
export const EXPRESSION_LABELS: Readonly<Record<'en' | 'ta' | 'si', Readonly<Record<LiveExpressionResult, string>>>>;
/** Strict, fresh numeric whitelist. Scores allow at most 0.02 rounding error in their sum. */
export function validateLiveFrame(input: unknown): RawLiveFrame;
/** No persistence; missing, ambiguous or crossing detections expire old identity and smoothing. */
export function createLiveFaceTracker(options?: LiveTrackerOptions): LiveFaceTracker;
export function getLiveFaceCopy(language?: string): Readonly<LiveFaceCopy>;
export const LIVE_UNCERTAINTY_REASONS: ReadonlyArray<LiveUncertaintyReason>;
export interface LiveModelScoreEntry { expression: LiveExpression; label: string; emoji: string; score: number; valueText: string; }
/** Raw model scores are separate from the threshold-supported expression and measured accuracy. */
export function getLiveExpressionSummary(face: unknown, language?: string): {
  leading: LiveModelScoreEntry | null; scoreEntries: LiveModelScoreEntry[];
  supported: LiveModelScoreEntry | null;
  uncertaintyReason: LiveUncertaintyReason | null; explanation: string | null;
};
export function getExpressionDisplay(expression: string, value: number | string | null, language?: string): {
  label: string; emoji: string; valueText: string; kind: 'probability' | 'likelihood' | 'unknown';
};
/** Only a unique highest LIKELY/VERY_LIKELY signal selects an expression; other inputs stay uncertain. Never returns a percent. */
export function getCloudExpressionDisplay(signals: unknown, language?: string): {
  label: string; emoji: string; valueText: string; kind: 'likelihood' | 'unknown';
};
/** Includes anonymous numeric facts and model caveats, never images, notes or actual-feeling claims. */
export function buildLiveReportText(input: TrackedLiveFrame, language?: string): string;
