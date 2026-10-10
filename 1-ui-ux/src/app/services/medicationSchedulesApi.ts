import { apiGet, apiPost, apiPut } from './apiService';
export interface MedicationSchedule {
  schedule_id: number; medication_id: number; times: string[]; weekdays: number[]; timezone: string;
  start_date: string; end_date?: string; food_instruction?: string; enabled: boolean;
  drug_name: string; dosage: string;
}
export interface DoseReminder {
  reminder_id: number; medication_id: number; drug_name: string; dosage: string; event_day: string;
  scheduled_at: string; presentation_at: string; food_instruction?: string;
  delivery_round: number;
  is_overdue?: boolean; escalation_minutes?: number;
  status: 'pending' | 'snoozed' | 'taken' | 'skipped' | 'cancelled';
}
const root = (residentId: string) => `/residents/${encodeURIComponent(residentId)}`;
export const medicationSchedulesApi = {
  schedules: (residentId: string, signal?: AbortSignal) => apiGet<MedicationSchedule[]>(`${root(residentId)}/medication-schedules`, { signal }),
  save: (residentId: string, medicationId: number, body: { times: string[]; weekdays: number[]; timezone: string; startDate: string; endDate: string | null; foodInstruction: string; enabled: boolean }) => apiPut(`${root(residentId)}/medication-schedules/${medicationId}`, body),
  reminders: (residentId: string, day: string, signal?: AbortSignal) => apiGet<DoseReminder[]>(`${root(residentId)}/medication-reminders?day=${encodeURIComponent(day)}`, { signal }),
  action: (residentId: string, reminderId: number, status: 'taken' | 'skipped' | 'snoozed', deliveryRound?: number) => apiPost(`${root(residentId)}/medication-reminders/${reminderId}/action`, { status, ...(status === 'snoozed' ? { minutes: 10, deliveryRound } : {}) }),
};
