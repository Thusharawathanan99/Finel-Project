export type UrgentSymptomKey = 'chestPain' | 'breathingDifficulty' | 'faceDrooping' | 'armOrSpeechDifficulty' | 'collapse';
export const URGENT_SYMPTOM_KEYS: readonly UrgentSymptomKey[];
export const URGENT_HELP_NOTE_MAX_LENGTH: 1000;
export const URGENT_HELP_MESSAGE_MAX_LENGTH: 4999;
export const SRI_LANKA_AMBULANCE_NUMBER: '1990';
export const SRI_LANKA_AMBULANCE_TEL: 'tel:1990';
export const FACE_CARE_SOURCES: readonly Readonly<{ title: string; url: string }>[];
export interface FaceCareCopy {
  readonly title: string; readonly description: string; readonly notDiagnosis: string;
  readonly symptomHeading: string; readonly symptoms: Readonly<Record<UrgentSymptomKey, string>>;
  readonly optionalNote: string; readonly notePlaceholder: string; readonly action: string;
  readonly confirmationTitle: string; readonly confirmationMessage: string;
  readonly confirmSend: string; readonly cancel: string; readonly cancelPending: string;
  readonly call1990: string; readonly callHelp: string; readonly callFailed: string;
  readonly sending: string; readonly savedTitle: string; readonly savedMessage: string;
  readonly alreadyResolved: string; readonly newRequest: string;
  readonly resolvedTitle: string; readonly resolvedMessage: string;
  readonly failedTitle: string; readonly failedMessage: string; readonly retry: string;
  readonly signInRequired: string; readonly chooseSymptomsOptional: string;
  readonly privacy: string; readonly sourcesLabel: string; readonly reportSource: string;
  readonly sourceTitles: readonly [string, string, string];
  readonly reportedSymptoms: string; readonly noSymptomsSelected: string; readonly reportNote: string;
}
export function getFaceCareCopy(language?: string): Readonly<FaceCareCopy>;
/** Pure text builder. Empty symptoms still represent an explicit request for help. */
export function buildUrgentHelpMessage(symptomKeys: readonly UrgentSymptomKey[], language?: string, note?: string): string;
