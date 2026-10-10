import { openSync, fstatSync, readSync, closeSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const MAX_CREDENTIAL_BYTES = 64_000;
const projectRoot = typeof import.meta?.url === 'string' ? resolve(dirname(fileURLToPath(import.meta.url)), '../../..') : resolve(process.cwd());
const object = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' && Boolean(value.trim());

// Inspect a bounded local file only. This never initializes OAuth, contacts
// Google, reads a patient image or reveals credential details to the client.
function readCredentialFile(filename) {
  const descriptor = openSync(filename, 'r');
  try {
    const metadata = fstatSync(descriptor);
    if (!metadata.isFile() || metadata.size < 1 || metadata.size > MAX_CREDENTIAL_BYTES) throw new Error('Invalid configuration');
    const buffer = Buffer.alloc(MAX_CREDENTIAL_BYTES + 1);
    let length = 0, received;
    while (length < buffer.length && (received = readSync(descriptor, buffer, length, buffer.length - length, null)) > 0) length += received;
    if (!length || length > MAX_CREDENTIAL_BYTES) throw new Error('Invalid configuration');
    return buffer.subarray(0, length).toString('utf8');
  } finally { closeSync(descriptor); }
}

function credentialShape(credentials, depth = 0) {
  if (!object(credentials) || depth > 2) return false;
  // "available" describes readable configuration, not a working private key,
  // enabled billing, IAM permissions, provider reachability or image accuracy.
  if (credentials.type === 'service_account') return text(credentials.client_email) && text(credentials.private_key);
  if (['authorized_user', 'external_account_authorized_user'].includes(credentials.type)) {
    return ['client_id', 'client_secret', 'refresh_token'].every(key => text(credentials[key]));
  }
  if (credentials.type === 'external_account') {
    return ['audience', 'subject_token_type', 'token_url'].every(key => text(credentials[key])) && object(credentials.credential_source);
  }
  if (credentials.type === 'impersonated_service_account') {
    return text(credentials.service_account_impersonation_url) && credentialShape(credentials.source_credentials, depth + 1);
  }
  return false;
}

export function faceVisionConfigurationState(env = process.env, readFile = readCredentialFile) {
  const credentials = env.FACE_VISION_CREDENTIALS || env.GOOGLE_APPLICATION_CREDENTIALS || env.FIREBASE_SERVICE_ACCOUNT_KEY;
  const project = env.FACE_VISION_PROJECT_ID || env.GOOGLE_CLOUD_PROJECT || '';
  if (!credentials) return 'missing';
  if (!text(credentials) || credentials.length > MAX_CREDENTIAL_BYTES ||
      project && (typeof project !== 'string' || !/^(?:[a-z][a-z0-9-]{4,28}[a-z0-9]|\d{1,30})$/.test(project))) return 'invalid';
  try {
    const json = credentials.trim().startsWith('{') ? credentials : readFile(resolve(projectRoot, credentials));
    if (typeof json !== 'string' || Buffer.byteLength(json, 'utf8') > MAX_CREDENTIAL_BYTES) return 'invalid';
    return credentialShape(JSON.parse(json)) ? 'available' : 'invalid';
  } catch { return 'invalid'; }
}

export function createFaceVisionStatusHandler({ env = process.env, readFile } = {}) {
  return (req, res) => {
    res.set?.('Cache-Control', 'private, no-store');
    if (!req.user?.uid) return res.status(401).json({ error: 'Authentication required' });
    if (!req.user.profile) return res.status(403).json({ error: 'A registered account is required' });
    return res.json({ provider: 'google-cloud-vision', configurationState: faceVisionConfigurationState(env, readFile), providerVerified: false });
  };
}
