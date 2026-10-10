export type AssistanceWorkflow = 'normal' | 'possible' | 'attention' | 'urgent' | 'unavailable';
export function getFaceGuideCopy(language?: string): Record<string, string>;
export function getAssistanceWorkflow(observation: {state?:string} | null | undefined, symptoms: {urgent?:boolean;receipt?:{saved?:boolean;isResolved?:boolean}} | null | undefined): AssistanceWorkflow;
