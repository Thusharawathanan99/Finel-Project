// Authentication and domain requests must use the same API origin.
const isTunnel = typeof window !== 'undefined' && window.location.hostname.endsWith('.careconnect.website');
const configuredApiUrl = import.meta.env.VITE_API_URL?.trim();
const developmentApiUrl = import.meta.env.DEV ? 'http://localhost:3001/api' : '';
const tunnelApiUrl = isTunnel ? 'https://api.careconnect.website/api' : '';
export const API_URL = (configuredApiUrl || developmentApiUrl || tunnelApiUrl || '').replace(/\/+$/, '');
if (!API_URL) throw new Error('VITE_API_URL must be configured for this web build.');
