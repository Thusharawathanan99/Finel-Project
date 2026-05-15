/**
 * Shared API helper for the Patient app.
 * Centralizes auth-token fetching, resident ID lookup, and base URL.
 */
import { auth } from './firebase/config';

export const API_BASE = 'https://api.careconnect.website/api';

/**
 * Make an authenticated fetch request to the backend.
 */
export async function apiFetch(path, options = {}) {
  const user = auth.currentUser;
  if (!user) throw new Error('Not authenticated');

  const token = await user.getIdToken();
  const url = path.startsWith('http') ? path : `${API_BASE}${path}`;

  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      ...(options.headers || {}),
    },
  });

  return res;
}

/**
 * Get the current user's resident_id from the backend users table.
 * Falls back to generating one from the Firebase UID.
 */
let _cachedResidentId = null;

export async function getResidentId() {
  if (_cachedResidentId) return _cachedResidentId;

  const user = auth.currentUser;
  if (!user) throw new Error('Not authenticated');

  try {
    const res = await apiFetch(`/users/${user.uid}`);
    if (res.ok) {
      const data = await res.json();
      if (data.resident_id) {
        _cachedResidentId = data.resident_id;
        return _cachedResidentId;
      }
    }
  } catch (e) {
    console.warn('[apiHelper] Could not fetch user profile:', e.message);
  }

  // Fallback
  _cachedResidentId = `R-${user.uid.slice(0, 8).toUpperCase()}`;
  return _cachedResidentId;
}

/**
 * Clear cached resident ID (e.g. on logout).
 */
export function clearCache() {
  _cachedResidentId = null;
}
