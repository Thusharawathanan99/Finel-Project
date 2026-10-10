export type ModelSource = 'donut' | 'regex' | 'gemini';
export interface PrescriptionCandidate {
  drugName: string;
  dosage?: string;
  frequency?: string;
  duration?: string;
  instructions?: string;
  route?: string;
  rawMatch?: string;
  confidence: number;
  needsReview?: boolean;
  source: ModelSource;
  extra?: Record<string, unknown>;
}
export interface CandidateEvidence {
  drugName: string; dosage: string; frequency: string; duration: string;
  instructions: string; route: string; confidence: number; needsReview: boolean; rawMatch: string;
}
export interface CandidateSourceEvidence {
  confidence: number;
  candidates: CandidateEvidence[];
  drugClass?: string;
  warnings?: string[];
}
export interface ReconciledMedication {
  drugName: string; dosage: string; frequency: string; duration: string;
  instructions: string; route: string; confidence: number; needsReview: boolean;
  reviewReasons: string[]; conflictingFields: string[]; sources: ModelSource[];
  sourceDetails: Partial<Record<ModelSource, CandidateSourceEvidence>>;
}
export function cleanPrescriptionField(value: unknown): string;
export function parseRegimenTail(raw: string, abbreviations?: Record<string, string>): { frequency: string; duration: string; instructions: string; needsReview: boolean; reviewReasons: string[] };
export function reconcileCandidates(candidates: PrescriptionCandidate[], canonicalDrugName?: (name: string) => string): ReconciledMedication[];
