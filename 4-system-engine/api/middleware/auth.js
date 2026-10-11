// Verify identity before resolving privileges from the server-managed user profile.
import admin from 'firebase-admin';
import pool from '../db.js';
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { effectiveResidentIds } from '../careScope.js';

const directory = dirname(fileURLToPath(import.meta.url));
let authenticationReady = admin.apps.length > 0;
let hasServiceAccount = false;

try {
  const configuredKey = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  const defaultPath = resolve(directory, '../../serviceAccountKey.json');
  let serviceAccount;
  if (configuredKey) {
    serviceAccount = JSON.parse(existsSync(configuredKey)
      ? readFileSync(configuredKey, 'utf8') : configuredKey);
  } else if (existsSync(defaultPath)) {
    serviceAccount = JSON.parse(readFileSync(defaultPath, 'utf8'));
  }
  if (!authenticationReady && serviceAccount) {
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    authenticationReady = true;
    hasServiceAccount = true;
  } else if (!authenticationReady && process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    admin.initializeApp({ credential: admin.credential.applicationDefault() });
    authenticationReady = true;
    hasServiceAccount = true;
  } else if (!authenticationReady && (process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID)) {
    admin.initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID });
    authenticationReady = true;
  }
} catch (error) {
  console.error('[Auth] Firebase configuration is invalid:', error.message);
}
if (!authenticationReady) {
  console.error('[Auth] Firebase credentials are missing. Protected requests will be rejected.');
}

export async function authMiddleware(req, res, next) {
  // The signup selector exposes only a limited public caretaker directory.
  const publicDirectory = req.method === 'GET' && /^\/caretakers\/?$/.test(req.path);
  const isPublic = publicDirectory;
  const authorization = req.headers.authorization;
  if (!authorization) {
    if (isPublic) return next();
    return res.status(401).json({ error: 'No authorization token provided' });
  }
  const token = /^Bearer\s+(\S+)$/i.exec(authorization)?.[1];
  if (!token) {
    if (isPublic) return next();
    return res.status(401).json({ error: 'Invalid authorization header' });
  }

  let identity = null;
  if (authenticationReady) {
    try {
      identity = await admin.auth().verifyIdToken(token, hasServiceAccount);
    } catch {
      // Verification failed
    }
  }

  if (!identity) {
    if (isPublic) return next();
    if (!authenticationReady) {
      return res.status(503).json({ error: 'Server authentication is not configured. Protected requests cannot be verified.' });
    }
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  try {
    const [profiles] = await pool.execute('SELECT * FROM users WHERE id = ? LIMIT 1', [identity.uid]);
    const profile = profiles[0] || null;
    // Firebase UIDs are case-sensitive, while an existing MySQL schema may use
    // a case-insensitive collation. A similar-looking UID is a different account.
    if (profile && profile.id !== identity.uid) {
      return res.status(403).json({ error: 'The account profile does not match your authenticated identity' });
    }
    if (profile && !['patient', 'caretaker', 'admin'].includes(profile.role)) {
      return res.status(403).json({ error: 'The account has no valid server role' });
    }
    // Privilege requires both an active SQL profile and a verified Firebase claim when service account is active.
    if (hasServiceAccount && (profile?.role === 'admin' || identity.role === 'admin') &&
        !(profile?.role === 'admin' && identity.role === 'admin')) {
      return res.status(403).json({ error: 'Account privileges changed. Sign in again or contact your administrator.' });
    }
    const role = profile?.role || 'unregistered';
    req.user = {
      uid: identity.uid, email: identity.email || '', role, profile,
      // An admin custom claim is issued by Firebase Admin, never by a client.
      adminClaim: identity.role === 'admin', caretakerIds: [],
      tokenExpiresAt: Number.isFinite(identity.exp) ? identity.exp * 1000 : null,
    };
    req.residentScope = role === 'admin' ? null : [];
    if (role === 'patient' && profile?.resident_id) req.residentScope = [profile.resident_id];
    if (role === 'caretaker') {
      const [caretakers] = await pool.execute(
        'SELECT caretaker_id FROM caretakers WHERE LOWER(email) = LOWER(?) AND is_active = TRUE',
        [identity.email || '']
      );
      req.user.caretakerIds = caretakers.map(row => row.caretaker_id);
      if (req.user.caretakerIds.length) {
        req.residentScope = await effectiveResidentIds(pool,req.user.caretakerIds);
      }
    }
    return next();
  } catch (error) {
    console.error('[Auth] Profile lookup failed:', error.message);
    return res.status(503).json({ error: 'Account permissions could not be verified. Please retry.' });
  }
}

export function isAuthenticationReady() { return authenticationReady; }

export default admin;
