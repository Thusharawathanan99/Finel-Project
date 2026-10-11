import { auth } from './firebase/config';

const configuredApiUrl = typeof process !== 'undefined' ? process.env.EXPO_PUBLIC_API_URL?.trim() : '';
export const API_BASE = configuredApiUrl ? configuredApiUrl.replace(/\/+$/, '') : '';

export function getApiBase() {
  // React Native defines window, but has no browser location.
  const hostname = typeof window !== 'undefined' && window.location ? window.location.hostname : undefined;
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    return 'http://localhost:3001/api';
  }
  if (!API_BASE) throw new Error('The mobile API URL is not configured. Set EXPO_PUBLIC_API_URL in the app .env file.');
  return API_BASE;
}

export async function apiFetch(path, options = {}) {
  const user = auth.currentUser;
  if (!user) throw new Error('Not authenticated');
  const apiBase = getApiBase();
  const token = await user.getIdToken();
  if (auth.currentUser?.uid !== user.uid) throw new Error('Your session changed. Please try again.');
  const response = await fetch(apiBase + path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
      Authorization: `Bearer ${token}`,
    },
  });
  if (auth.currentUser?.uid !== user.uid) throw new Error('Your session changed. Please try again.');
  const readJson = response.json.bind(response);
  response.json = async () => {
    if (auth.currentUser?.uid !== user.uid) throw new Error('Your session changed. Please try again.');
    const data = await readJson();
    if (auth.currentUser?.uid !== user.uid) throw new Error('Your session changed. Please try again.');
    return data;
  };
  return response;
}
