// Centralized HTTP client for the Express.js backend API
// Automatically attaches Firebase Auth token to all requests
import { getIdToken } from './firebaseAuthService';

// Auto-detect: if served from Cloudflare tunnel, use the tunneled API;
// otherwise use the local dev server.
const isTunnel = typeof window !== 'undefined' && window.location.hostname.endsWith('.careconnect.website');
const API_URL = isTunnel
  ? 'https://api.careconnect.website/api'
  : (import.meta.env.VITE_API_URL || 'http://localhost:3001/api');

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
    try {
      const errorBody = await response.json();
      errorMessage = errorBody.error || errorBody.message || errorMessage;
    } catch {
      // If response isn't JSON, use status text
    }
    throw new Error(errorMessage);
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

export async function apiGet<T>(endpoint: string, options?: RequestOptions): Promise<T> {
  const headers = await buildHeaders(options?.headers);
  const response = await fetch(`${API_URL}${endpoint}`, {
    method: 'GET',
    headers,
    signal: options?.signal,
  });
  return handleResponse<T>(response);
}

export async function apiPost<T>(endpoint: string, data?: unknown, options?: RequestOptions): Promise<T> {
  const headers = await buildHeaders(options?.headers);
  const response = await fetch(`${API_URL}${endpoint}`, {
    method: 'POST',
    headers,
    body: data ? JSON.stringify(data) : undefined,
    signal: options?.signal,
  });
  return handleResponse<T>(response);
}

export async function apiPut<T>(endpoint: string, data?: unknown, options?: RequestOptions): Promise<T> {
  const headers = await buildHeaders(options?.headers);
  const response = await fetch(`${API_URL}${endpoint}`, {
    method: 'PUT',
    headers,
    body: data ? JSON.stringify(data) : undefined,
    signal: options?.signal,
  });
  return handleResponse<T>(response);
}

export async function apiDelete<T>(endpoint: string, data?: unknown, options?: RequestOptions): Promise<T> {
  const headers = await buildHeaders(options?.headers);
  const response = await fetch(`${API_URL}${endpoint}`, {
    method: 'DELETE',
    headers,
    body: data ? JSON.stringify(data) : undefined,
    signal: options?.signal,
  });
  return handleResponse<T>(response);
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
    imageUrl?: string;
    medications: { drugName: string; dosage: string; frequency: string }[];
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
  assignResident: (caretakerId: string, residentId: string) =>
    apiPost<any>(`/caretakers/${caretakerId}/assign-resident`, { residentId }),
  getLeaveRequests: (id: string) => apiGet<any[]>(`/caretakers/${id}/leave-requests`),
  getAllLeaveRequests: () => apiGet<any[]>('/caretakers/all/leave-requests'),
  createLeaveRequest: (id: string, data: any) => apiPost<any>(`/caretakers/${id}/leave-requests`, data),
  updateLeaveRequest: (caretakerId: string, requestId: string, data: any) =>
    apiPut<any>(`/caretakers/${caretakerId}/leave-requests/${requestId}`, data),
  reassignResident: (data: { residentId: string; fromCaretakerId?: string; toCaretakerId: string }) =>
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
  getForResident: (residentId: string) => apiGet<any[]>(`/residents/${residentId}/emotions`),
  record: (data: {
    residentId: string;
    stateScore: number;
    emotionLabel?: string;
    category?: string;
    relatedMedicine?: string | null;
    note?: string | null;
  }) => apiPost<any>('/emotions', data),
  analyzeImage: (base64Image: string) => apiPost<{
    emotionLabel: string;
    stateScore: number;
    category: string;
    note: string;
  }>('/emotions/analyze-image', { image: base64Image }),
  createWellnessAlert: (data: {
    residentId: string;
    emotionLabel: string;
    stateScore: number;
    category: string;
    note: string;
  }) => apiPost<any>('/emotions/wellness-alert', data),
};

// --- System Components ---
export const systemApi = {
  getComponents: () => apiGet<any[]>('/system/components'),
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
  getActive: () => apiGet<any[]>('/sos-alerts'),
  getAll: () => apiGet<any[]>('/sos-alerts?all=true'),
  resolve: (id: number, resolvedBy?: string) =>
    apiPut<any>(`/sos-alerts/${id}/resolve`, { resolvedBy: resolvedBy || 'Admin' }),
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
