export type PatientSymptomKey = 'chestPain' | 'breathingDifficulty' | 'coldSweat' | 'dizziness' | 'fainting' | 'unusualWeakness' | 'radiatingPain' | 'severeDiscomfort' | 'faceDrooping' | 'armWeakness' | 'speechDifficulty' | 'visionChanges' | 'severeHeadache' | 'collapse';
export const PATIENT_SYMPTOM_KEYS: readonly PatientSymptomKey[];
export const PATIENT_SYMPTOMS: readonly Readonly<{ key: PatientSymptomKey; icon: string; labels: Readonly<{ en: string; ta: string; si: string }> }>[];
export const PATIENT_SYMPTOM_SOURCES: readonly string[];
export const PATIENT_SYMPTOM_NOTE_MAX_LENGTH: number;
export interface PatientSymptomReceipt { saved: true; alertId: number; replayed?: boolean; isResolved?: boolean; }
export interface PatientSymptomSnapshot { symptomKeys: PatientSymptomKey[]; note: string; urgent: boolean; reportedAt: string | null; receipt: PatientSymptomReceipt | null; }
export interface PatientSymptomCopy {
  readonly title: string; readonly subtitle: string; readonly description: string; readonly source: string; readonly notDiagnosis: string;
  readonly urgentTitle: string; readonly guidance: string; readonly noSelection: string;
  readonly action: string; readonly retry: string; readonly sending: string; readonly savedTitle: string; readonly savedMessage: string; readonly duplicate: string;
  readonly resolvedTitle: string; readonly resolvedMessage: string; readonly failedTitle: string; readonly failedMessage: string; readonly authRequired: string;
  readonly call: string; readonly callFailed: string; readonly note: string; readonly notePlaceholder: string; readonly share: string; readonly shareFailed: string;
  readonly reset: string; readonly newRequest: string; readonly cancelPending: string; readonly privacy: string;
  readonly reportTitle: string; readonly reportTime: string; readonly reportSymptoms: string; readonly reportNote: string; readonly reportGuidance: string;
  readonly status: string; readonly savedStatus: string; readonly notSentStatus: string;
  readonly symptoms: Readonly<Record<PatientSymptomKey, string>>;
}
export function getPatientSymptomsCopy(language?: string): Readonly<PatientSymptomCopy>;
export const getPatientSymptomCopy: typeof getPatientSymptomsCopy;
export function normalizePatientSymptoms(keys: readonly PatientSymptomKey[]): PatientSymptomKey[];
export function evaluatePatientSymptoms(keys: readonly PatientSymptomKey[], language?: string): { source: 'patient-reported'; symptomKeys: PatientSymptomKey[]; urgent: boolean; assistanceState: 'urgent-assistance' | 'no-symptoms-selected'; guidance: string; labels: string[] };
export function buildPatientSymptomReport(keys: readonly PatientSymptomKey[], language?: string, note?: string, reportedAt?: string | null, receipt?: PatientSymptomReceipt | null): string;
export function buildPatientSymptomHelpMessage(keys: readonly PatientSymptomKey[], language?: string, note?: string): string;
