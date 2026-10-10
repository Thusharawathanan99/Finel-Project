// Centralized HTTP client for the Express.js backend API
// Automatically attaches Firebase Auth token to all requests
import { getIdToken } from './firebaseAuthService';
import { auth } from '../firebase';
import type { FaceReport } from '../../../../shared/faceReport';
import type { FaceProviderStatus } from '../../../../shared/faceProviderStatus';

import { API_URL } from './apiConfig';

interface RequestOptions {
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

/**
 * Build headers with Firebase Auth token.
 */
async function buildHeaders(extraHeaders?: Record<string, string>): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...extraHeaders,
  };

  const token = await getIdToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  return headers;
}

/**
 * Handle API response — parse JSON or throw error.
 */
async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let errorMessage = `API Error: ${response.status} ${response.statusText}`;
    let errorCode: string | undefined;
    try {
      const errorBody = await response.json();
      errorMessage = errorBody.error || errorBody.message || errorMessage;
      errorCode = typeof errorBody.errorCode === 'string' ? errorBody.errorCode : undefined;
    } catch {
      // If response isn't JSON, use status text
    }
    throw Object.assign(new Error(errorMessage), { status: response.status, errorCode });
  }

  // Handle 204 No Content
  if (response.status === 204) {
    return undefined as T;
  }

  return response.json();
}

// ──────────────────────────────────────────────
// HTTP Methods
// ──────────────────────────────────────────────

async function apiRequest<T>(method: string, endpoint: string, data?: unknown, options?: RequestOptions): Promise<T> {
  const uid = auth.currentUser?.uid;
  const assertSession = () => {
    if (auth.currentUser?.uid !== uid) throw new Error('Your signed-in account changed. Please try again.');
  };
  const headers = await buildHeaders(options?.headers);
  assertSession();
  const response = await fetch(`${API_URL}${endpoint}`, {
    method,
    headers,
    body: data !== undefined ? JSON.stringify(data) : undefined,
    signal: options?.signal,
  });
  assertSession();
  try {
    return await handleResponse<T>(response);
  } finally {
    assertSession();
  }
}

export async function apiGet<T>(endpoint: string, options?: RequestOptions): Promise<T> {
  return apiRequest<T>('GET', endpoint, undefined, options);
}

export async function apiPost<T>(endpoint: string, data?: unknown, options?: RequestOptions): Promise<T> {
  return apiRequest<T>('POST', endpoint, data, options);
}

export async function apiPut<T>(endpoint: string, data?: unknown, options?: RequestOptions): Promise<T> {
  return apiRequest<T>('PUT', endpoint, data, options);
}

export async function apiDelete<T>(endpoint: string, data?: unknown, options?: RequestOptions): Promise<T> {
  return apiRequest<T>('DELETE', endpoint, data, options);
}

// ──────────────────────────────────────────────
// Domain-specific API calls
// ──────────────────────────────────────────────

// --- Users ---
export const usersApi = {
  getProfile: (uid: string) => apiGet<any>(`/users/${uid}`),
  createProfile: (data: { uid: string; name: string; email: string; role: string; residentId?: string }) =>
    apiPost<any>('/users', data),
  updateProfile: (uid: string, data: Partial<{ name: string; email: string; role: string; residentId: string }>) =>
    apiPut<any>(`/users/${uid}`, data),
};

// --- Residents ---
export const residentsApi = {
  getAll: () => apiGet<any[]>('/residents'),
  getById: (id: string) => apiGet<any>(`/residents/${id}`),
  create: (data: any) => apiPost<any>('/residents', data),
  update: (id: string, data: any) => apiPut<any>(`/residents/${id}`, data),
  delete: (id: string) => apiDelete(`/residents/${id}`),
  getCaretakers: (id: string) => apiGet<any[]>(`/residents/${id}/caretakers`),
};

// --- Prescriptions ---
export const prescriptionsApi = {
  getForResident: (residentId: string) => apiGet<any[]>(`/residents/${residentId}/prescriptions`),
  create: (data: {
    prescriptionId: string;
    residentId: string;
    dateIssued: string;
    doctorName: string;
    patientName?: string;
    rawText?: string;
    imageUrl?: string;
    medications: { drugName: string; dosage: string; frequency: string; duration?: string; instructions?: string; confidence?: number }[];
  }) => apiPost<any>('/prescriptions', data),
  delete: (prescriptionId: string) => apiDelete(`/prescriptions/${prescriptionId}`),
  finishMedication: (prescriptionId: string, data: { medicationId?: number; drugName?: string; dosage?: string; frequency?: string }) =>
    apiDelete<{ message: string; finishedMedication: {
      id: number;
      residentId: string;
      prescriptionId: string;
      drugName: string;
      dosage: string;
      frequency: string;
      finishedAt: string;
    } }>(`/prescriptions/${prescriptionId}/medications`, data),
};

// --- Caretakers ---
export const caretakersApi = {
  getAll: () => apiGet<any[]>('/caretakers'),
  getById: (id: string) => apiGet<any>(`/caretakers/${id}`),
  create: (data: any) => apiPost<any>('/caretakers', data),
  update: (id: string, data: any) => apiPut<any>(`/caretakers/${id}`, data),
  delete: (id: string) => apiDelete(`/caretakers/${id}`),
  assignResident: (caretakerId: string, residentId: string) =>
    apiPost<any>(`/caretakers/${caretakerId}/assign-resident`, { residentId }),
  getLeaveRequests: (id: string) => apiGet<any[]>(`/caretakers/${id}/leave-requests`),
  getAllLeaveRequests: () => apiGet<any[]>('/caretakers/all/leave-requests'),
  createLeaveRequest: (id: string, data: any) => apiPost<any>(`/caretakers/${id}/leave-requests`, data),
  updateLeaveRequest: (caretakerId: string, requestId: string, data: any) =>
    apiPut<any>(`/caretakers/${caretakerId}/leave-requests/${requestId}`, data),
  reassignResident: (data: { residentId: string; fromCaretakerId?: string; toCaretakerId: string | null }) =>
    apiPut<any>('/caretakers/reassign-resident', data),
};

// --- Appointments ---
export const appointmentsApi = {
  getAll: () => apiGet<any[]>('/appointments'),
  getForResident: (residentId: string) => apiGet<any[]>(`/residents/${residentId}/appointments`),
  create: (data: any) => apiPost<any>('/appointments', data),
  update: (id: string, data: any) => apiPut<any>(`/appointments/${id}`, data),
  delete: (id: string) => apiDelete(`/appointments/${id}`),
};

// --- Emotional States ---
export const emotionsApi = {
  faceStatus: (options?: RequestOptions) => apiGet<FaceProviderStatus>('/emotions/face-status', options),
  getWellnessAlerts: (caretakerId?: string, options?: RequestOptions) => apiGet<any[]>(caretakerId ? `/emotions/wellness-alerts/${encodeURIComponent(caretakerId)}` : '/emotions/wellness-alerts', options),
  acknowledgeWellness: (id: number, options?:RequestOptions) => apiPut<any>(`/emotions/wellness-alerts/${id}/acknowledge`, {}, options),
  getForResident: (residentId: string) => apiGet<any[]>(`/residents/${residentId}/emotions`),
  record: (data: {
    residentId: string;
    stateScore: number;
    emotionLabel?: string;
    category?: string;
    relatedMedicine?: string | null;
    note?: string | null;
    observationId?: string;
  }) => apiPost<any>('/emotions', data),
  analyzeImage: (base64Image: string, options?: RequestOptions) => apiPost<FaceReport>('/emotions/analyze-image', { image: base64Image }, options),
  createWellnessAlert: (data: {
    residentId: string;
    emotionLabel: string;
    stateScore: number;
    category: string;
    note: string;
  }) => apiPost<any>('/emotions/wellness-alert', data),
};

export const medicationEventsApi = {
  get: (residentId: string, day: string) => apiGet<any[]>(`/residents/${encodeURIComponent(residentId)}/medication-events?day=${encodeURIComponent(day)}`),
  save: (residentId: string, medicationId: number, day: string, status: 'taken' | 'skipped') => apiPost<any>(`/residents/${encodeURIComponent(residentId)}/medication-events`, {medicationId,day,status}),
};

// --- System Components ---
export const systemApi = {
  getComponents: () => apiGet<any[]>('/system/components'),
  createComponent: (data: { componentId: string; name: string; version: string; description: string; status: string }) => apiPost<any>('/system/components', data),
  deleteComponent: (id: string) => apiDelete(`/system/components/${id}`),
  updateComponent: (id: string, data: any) => apiPut<any>(`/system/components/${id}`, data),
};

// --- Meal Plans ---
export const mealPlansApi = {
  getForResident: (residentId: string) =>
    apiGet<{ plan: any | null; medicationCount?: number; generatedAt?: string }>(`/residents/${residentId}/meal-plan`),
  save: (residentId: string, plan: any, medicationCount: number) =>
    apiPost<any>(`/residents/${residentId}/meal-plan`, { plan, medicationCount }),
  delete: (residentId: string) =>
    apiDelete(`/residents/${residentId}/meal-plan`),
};

// --- Doctors ---
export const doctorsApi = {
  getAll: () => apiGet<any[]>('/doctors'),
  get: (id: number) => apiGet<any>(`/doctors/${id}`),
  create: (data: { name: string; specialization?: string; phone?: string; email?: string; hospital?: string }) =>
    apiPost<any>('/doctors', data),
  update: (id: number, data: any) => apiPut<any>(`/doctors/${id}`, data),
  delete: (id: number) => apiDelete(`/doctors/${id}`),
};

// --- SOS Alerts ---
export const sosApi = {
  create: (data: { residentId: string; residentName?: string; message: string; requestId?:string }, options?:RequestOptions) => apiPost<{ alertId: number; cooldown?: boolean; saved?:boolean; replayed?:boolean; isResolved?:boolean }>('/sos-alerts', data, options),
  getActive: (options?:RequestOptions) => apiGet<any[]>('/sos-alerts', options),
  getAll: () => apiGet<any[]>('/sos-alerts?all=true'),
  resolve: (id: number, resolvedBy?: string, options?:RequestOptions) =>
    apiPut<any>(`/sos-alerts/${id}/resolve`, { resolvedBy: resolvedBy || 'Admin' }, options),
};

// --- Complaints ---
export const complaintsApi = {
  getAll: (status?: string) => apiGet<any[]>(status ? `/complaints?status=${status}` : '/complaints'),
  getForResident: (residentId: string) => apiGet<any[]>(`/residents/${residentId}/complaints`),
  create: (data: { residentId: string; residentName?: string; subject: string; message: string }) =>
    apiPost<any>('/complaints', data),
  respond: (id: number, data: { status?: string; adminResponse?: string; respondedBy?: string }) =>
    apiPut<any>(`/complaints/${id}`, data),
};
