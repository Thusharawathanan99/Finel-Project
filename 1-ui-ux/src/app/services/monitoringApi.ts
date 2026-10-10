import { apiGet, apiPost, apiPut } from './apiService';

export type ConsentScope = 'camera' | 'activity' | 'emotion' | 'research';
export type ConsentLanguage = 'en' | 'ta' | 'si';
export type IncidentAction = 'acknowledged' | 'emergency_contacted' | 'false_alarm' | 'resolved' | 'resident_corrected' | 'note';
export interface CareIncidentAction { action_id: number; action: string; notes?: string; created_at: string; actor_name?: string }
export interface MonitoringDevice {
  device_id: string; name: string; device_type: string; location?: string; room_number?: string;
  enabled: boolean | number; status: string; camera_state?: 'running' | 'paused' | 'stopped';
  last_seen_at?: string; last_health?: Record<string, unknown>; settings?: Record<string, unknown>;
  resident_ids: string[];
}
export interface MonitoringConsent {
  consent_id: number; scope: ConsentScope; status: 'granted' | 'withdrawn'; active: boolean;
  language: ConsentLanguage; subject_role: string; effective_at: string; notes?: string;
}
export interface MonitoringIncident {
  incident_id: number; resident_id?: string; corrected_resident_id?: string; resident_name?: string;
  device_id: string; device_name?: string; location?: string; incident_type: string;
  severity: string; status: string; reason: string; recommended_action: string; confidence?: number;
  detected_at: string; acknowledged_at?: string; resolved_at?: string; emergency_contacted_at?: string;
  response_time_seconds?: number | null; resolution_notes?: string;
  acknowledged_by_name?: string;
  actions?: CareIncidentAction[];
}
export interface ActivityObservation {
  event_id: string; activity: string; confidence: number; observed_at: string;
  review_status: string; model_version?: string; incident_id?: number | null;
}
export interface MonitoringZone { zone_id: number; name: string; zone_type: string; polygon: number[][]; enabled: boolean | number }
const part = (value: string | number) => encodeURIComponent(String(value));
export const monitoringApi = {
  devices: (signal?: AbortSignal) => apiGet<MonitoringDevice[]>('/monitoring/devices', { signal }),
  createDevice: (body: { name: string; deviceType: string; location: string; roomNumber: string }) => apiPost<{ deviceId: string; token: string; device?: MonitoringDevice }>('/monitoring/devices', body),
  updateDevice: (id: string, body: unknown) => apiPut<MonitoringDevice>(`/monitoring/devices/${part(id)}`, body),
  assignResidents: (id: string, residentIds: string[]) => apiPut(`/monitoring/devices/${part(id)}/residents`, { residentIds }),
  rotateToken: (id: string) => apiPost<{ token: string }>(`/monitoring/devices/${part(id)}/rotate-token`, {}),
  consents: (id: string, signal?: AbortSignal) => apiGet<MonitoringConsent[]>(`/monitoring/residents/${part(id)}/consents`, { signal }),
  saveConsent: (id: string, body: { scope: ConsentScope; status: 'granted' | 'withdrawn'; language: ConsentLanguage; subjectRole: 'resident' | 'guardian' | 'administrator'; guardianName?: string; notes?: string; confirmed?: boolean }) => apiPost<MonitoringConsent>(`/monitoring/residents/${part(id)}/consents`, body),
  incidents: (all: boolean, signal?: AbortSignal) => apiGet<MonitoringIncident[]>(`/monitoring/incidents${all ? '?all=true' : ''}`, { signal }),
  incidentAction: (id: number, action: IncidentAction, notes: string, residentId?: string) => apiPost<MonitoringIncident>(`/monitoring/incidents/${part(id)}/actions`, { action, notes, residentId }),
  incidentActions: (id: number, signal?: AbortSignal) => apiGet<CareIncidentAction[]>(`/monitoring/incidents/${part(id)}/actions`, { signal }),
  zones: (id: string, signal?: AbortSignal) => apiGet<MonitoringZone[]>(`/monitoring/devices/${part(id)}/zones`, { signal }),
  createZone: (id: string, body: { name: string; zoneType: string; polygon: number[][] }) => apiPost<MonitoringZone>(`/monitoring/devices/${part(id)}/zones`, body),
  observations: (id: string, signal?: AbortSignal) => apiGet<ActivityObservation[]>(`/monitoring/residents/${part(id)}/events`, { signal }),
  reviewObservation: (id: string, eventId: string, status: 'confirmed' | 'false_positive', notes: string) => apiPost(`/monitoring/residents/${part(id)}/events/${part(eventId)}/review`, { status, notes }),
};
