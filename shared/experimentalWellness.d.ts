export const EXPRESSION_WEIGHTS: Readonly<Record<string, number>>;
export const ASSESSMENT_VERSION: string;
export interface ExperimentalAssessment { version: string; facialScore: number; dominantExpression: string; capturedAt: string; stateScore: number; vocalScore: number | null; vocalStabilityScore: number | null; vocalDistressScore: number | null; modalities: string[]; reviewRequired: boolean; clinicalDiagnosis: boolean; }
export function assessExpressionFrame(frame: unknown): Omit<ExperimentalAssessment, 'stateScore'|'vocalScore'|'vocalStabilityScore'|'vocalDistressScore'|'modalities'|'clinicalDiagnosis'> | null;
export function combineExperimentalAssessment(face: unknown, vocal?: unknown): ExperimentalAssessment | null;
export function experimentalObservation(assessment: ExperimentalAssessment, note?: string, medicine?: string | null): { stateScore: number; emotionLabel: string; category: string; relatedMedicine: string | null; note: string; source: 'experimental-assessment'; reviewed: true; assessment: Record<string, unknown> };
export function analyzeAcousticSamples(input: Float32Array, sampleRate: number): { wellnessScore: number; stabilityScore: number; distressScore: number; features: Record<string, number>; analysisKind: 'acoustic-heuristic'; needsReview: boolean; measurementNotice: string; };
