// Firebase Authentication service for CareConnect
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  getAuth,
  signOut as firebaseSignOut,
  onAuthStateChanged,
  updateProfile,
  type User as FirebaseUser,
} from 'firebase/auth';
import { initializeApp, deleteApp } from 'firebase/app';
import { auth } from '../firebase';

export type UserRole = 'patient' | 'caretaker' | 'admin';

export interface AppUser {
  uid: string;
  name: string;
  email: string;
  role: UserRole;
  residentId?: string;
}

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';
const DEFAULT_ADMIN_EMAIL = 'admin@careconnect.com';
const DEFAULT_ADMIN_PASSWORD = 'admin123';
const DEFAULT_ADMIN_NAME = 'System Administrator';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
};

export interface CreateCaretakerInput {
  name: string;
  email: string;
  password: string;
  phone?: string;
  specialization?: string;
}

export interface CreatedCaretakerAccount {
  uid: string;
  caretakerId: string;
  name: string;
  email: string;
  role: 'caretaker';
}

interface UserProfilePayload {
  uid: string;
  name: string;
  email: string;
  role: UserRole;
  residentId?: string;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function isDefaultAdminEmail(email: string): boolean {
  return normalizeEmail(email) === DEFAULT_ADMIN_EMAIL;
}

function isDefaultAdminCredential(email: string, password: string): boolean {
  return isDefaultAdminEmail(email) && password === DEFAULT_ADMIN_PASSWORD;
}

async function upsertUserProfile(payload: UserProfilePayload, token?: string): Promise<void> {
  const authToken = token ?? (await getIdToken());
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (authToken) {
    headers.Authorization = `Bearer ${authToken}`;
  }

  const response = await fetch(`${API_URL}/users`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(error || 'Failed to create user profile in database.');
  }
}

async function assignResidentToCaretaker(token: string, caretakerId: string, residentId: string): Promise<void> {
  const response = await fetch(`${API_URL}/caretakers/${encodeURIComponent(caretakerId)}/assign-resident`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({ residentId }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(error || 'Failed to assign resident to caretaker.');
  }
}

async function createIsolatedAuthUser(email: string, password: string, name: string): Promise<{ uid: string }> {
  const appName = `careconnect-provision-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const isolatedApp = initializeApp(firebaseConfig, appName);
  const isolatedAuth = getAuth(isolatedApp);

  try {
    const credential = await createUserWithEmailAndPassword(isolatedAuth, email, password);
    await updateProfile(credential.user, { displayName: name });
    return { uid: credential.user.uid };
  } finally {
    try {
      await firebaseSignOut(isolatedAuth);
    } catch {
      // No-op: isolated auth may already be signed out.
    }
    await deleteApp(isolatedApp);
  }
}

async function bootstrapDefaultAdminAccount(email: string, password: string): Promise<FirebaseUser> {
  const normalizedEmail = normalizeEmail(email);

  const credential = await createUserWithEmailAndPassword(auth, normalizedEmail, password);
  const firebaseUser = credential.user;

  await updateProfile(firebaseUser, { displayName: DEFAULT_ADMIN_NAME });
  const token = await firebaseUser.getIdToken();

  await upsertUserProfile(
    {
      uid: firebaseUser.uid,
      name: DEFAULT_ADMIN_NAME,
      email: normalizedEmail,
      role: 'admin',
    },
    token
  );

  return firebaseUser;
}

async function isCurrentUserAdmin(token: string): Promise<boolean> {
  const currentUser = auth.currentUser;
  if (!currentUser) {
    return false;
  }

  if (isDefaultAdminEmail(currentUser.email || '')) {
    return true;
  }

  try {
    const response = await fetch(`${API_URL}/users/${currentUser.uid}`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });

    if (!response.ok) {
      return false;
    }

    const userData = await response.json();
    return userData.role === 'admin';
  } catch {
    return false;
  }
}

/**
 * Get the current Firebase user's ID token for API authentication.
 */
export async function getIdToken(): Promise<string | null> {
  const user = auth.currentUser;
  if (!user) return null;
  return user.getIdToken();
}

/**
 * Sign up a new patient and link them to a caretaker.
 */
export async function signUp(
  email: string,
  password: string,
  name: string,
  caretakerId: string,
  residentId?: string
): Promise<AppUser> {
  const normalizedEmail = normalizeEmail(email);
  const credential = await createUserWithEmailAndPassword(auth, normalizedEmail, password);
  const firebaseUser = credential.user;
  const token = await firebaseUser.getIdToken();

  // Ensure patient accounts are always linked to a resident profile.
  let linkedResidentId = residentId?.trim() || undefined;

  if (linkedResidentId) {
    const residentCheck = await fetch(`${API_URL}/residents/${encodeURIComponent(linkedResidentId)}`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });

    if (!residentCheck.ok) {
      throw new Error('Resident ID not found. Please check the ID or leave it empty to auto-create a profile.');
    }
  } else {
    linkedResidentId = `R-${firebaseUser.uid.slice(0, 8).toUpperCase()}`;

    const createResidentRes = await fetch(`${API_URL}/residents`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        residentId: linkedResidentId,
        name,
      }),
    });

    if (!createResidentRes.ok) {
      const errText = await createResidentRes.text();
      throw new Error(errText || 'Failed to auto-create resident profile for patient signup.');
    }
  }

  if (!caretakerId) {
    throw new Error('Please select a caretaker to complete registration.');
  }

  // 2. Set display name
  await updateProfile(firebaseUser, { displayName: name });

  // 3. Create user record in MySQL via API
  await upsertUserProfile(
    {
      uid: firebaseUser.uid,
      name,
      email: normalizedEmail,
      role: 'patient',
      residentId: linkedResidentId,
    },
    token
  );

  if (!linkedResidentId) {
    throw new Error('Resident profile was not created successfully.');
  }

  // 4. Assign this patient resident to the selected caretaker.
  await assignResidentToCaretaker(token, caretakerId, linkedResidentId);

  return {
    uid: firebaseUser.uid,
    name,
    email: normalizedEmail,
    role: 'patient',
    residentId: linkedResidentId,
  };
}

/**
 * Sign in an existing user with Firebase Auth and fetch their MySQL profile.
 */
export async function signIn(email: string, password: string): Promise<AppUser> {
  const normalizedEmail = normalizeEmail(email);

  if (isDefaultAdminEmail(normalizedEmail) && password !== DEFAULT_ADMIN_PASSWORD) {
    throw new Error('Invalid admin credentials. Use admin123 as the password.');
  }

  let firebaseUser: FirebaseUser;

  try {
    const credential = await signInWithEmailAndPassword(auth, normalizedEmail, password);
    firebaseUser = credential.user;
  } catch (error: any) {
    const code = error?.code || '';
    const shouldBootstrapAdmin =
      isDefaultAdminCredential(normalizedEmail, password) &&
      (code === 'auth/user-not-found' || code === 'auth/invalid-credential');

    if (!shouldBootstrapAdmin) {
      throw error;
    }

    try {
      firebaseUser = await bootstrapDefaultAdminAccount(normalizedEmail, password);
    } catch (bootstrapError: any) {
      if (bootstrapError?.code === 'auth/email-already-in-use') {
        const retryCredential = await signInWithEmailAndPassword(auth, normalizedEmail, password);
        firebaseUser = retryCredential.user;
      } else {
        throw bootstrapError;
      }
    }
  }

  // Fetch full user profile from MySQL
  const token = await firebaseUser.getIdToken();
  const response = await fetch(`${API_URL}/users/${firebaseUser.uid}`, {
    headers: { 'Authorization': `Bearer ${token}` },
  });

  if (response.ok) {
    const userData = await response.json();

    const resolvedRole: UserRole = isDefaultAdminEmail(userData.email || normalizedEmail)
      ? 'admin'
      : (userData.role || 'patient');

    return {
      uid: firebaseUser.uid,
      name: userData.name || firebaseUser.displayName || '',
      email: userData.email || firebaseUser.email || '',
      role: resolvedRole,
      residentId: userData.resident_id,
    };
  }

  if (response.status === 404 && isDefaultAdminCredential(normalizedEmail, password)) {
    await upsertUserProfile(
      {
        uid: firebaseUser.uid,
        name: firebaseUser.displayName || DEFAULT_ADMIN_NAME,
        email: normalizedEmail,
        role: 'admin',
      },
      token
    );

    return {
      uid: firebaseUser.uid,
      name: firebaseUser.displayName || DEFAULT_ADMIN_NAME,
      email: firebaseUser.email || normalizedEmail,
      role: 'admin',
    };
  }

  if (response.status === 404) {
    throw new Error('Your account profile was not found. It may have been removed by admin.');
  }

  throw new Error(`Unable to load user profile (${response.status}). Please try again.`);
}

/**
 * Admin-only caretaker account creation.
 * Creates Firebase Auth user in an isolated auth instance so admin stays logged in.
 */
export async function createCaretakerAccount(input: CreateCaretakerInput): Promise<CreatedCaretakerAccount> {
  const currentUser = auth.currentUser;
  if (!currentUser) {
    throw new Error('Please sign in as admin first.');
  }

  const name = input.name.trim();
  const email = normalizeEmail(input.email);
  const password = input.password;

  if (!name) {
    throw new Error('Caretaker name is required.');
  }
  if (!email) {
    throw new Error('Caretaker email is required.');
  }
  if (!password || password.length < 6) {
    throw new Error('Caretaker password must be at least 6 characters.');
  }

  const token = await currentUser.getIdToken(true);
  const adminAllowed = await isCurrentUserAdmin(token);
  if (!adminAllowed) {
    throw new Error('Only admin can add caretakers.');
  }

  const createdAuthUser = await createIsolatedAuthUser(email, password, name);

  await upsertUserProfile(
    {
      uid: createdAuthUser.uid,
      name,
      email,
      role: 'caretaker',
    },
    token
  );

  const caretakerResponse = await fetch(`${API_URL}/caretakers`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({
      name,
      email,
      phone: input.phone?.trim() || '',
      specialization: input.specialization?.trim() || '',
    }),
  });

  if (!caretakerResponse.ok) {
    const error = await caretakerResponse.text();
    throw new Error(error || 'Failed to create caretaker profile.');
  }

  const caretakerData = await caretakerResponse.json();

  return {
    uid: createdAuthUser.uid,
    caretakerId: caretakerData.caretakerId,
    name,
    email,
    role: 'caretaker',
  };
}

/**
 * Sign out the current user.
 */
export async function signOut(): Promise<void> {
  await firebaseSignOut(auth);
}

/**
 * Listen for auth state changes. Returns an unsubscribe function.
 */
export function onAuthStateChange(
  callback: (user: FirebaseUser | null) => void
): () => void {
  return onAuthStateChanged(auth, callback);
}

/**
 * Fetch the full AppUser profile for a Firebase user.
 */
export async function fetchUserProfile(firebaseUser: FirebaseUser): Promise<AppUser> {
  const normalizedEmail = normalizeEmail(firebaseUser.email || '');

  try {
    const token = await firebaseUser.getIdToken();
    const response = await fetch(`${API_URL}/users/${firebaseUser.uid}`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });

    if (response.ok) {
      const userData = await response.json();

      const resolvedRole: UserRole = isDefaultAdminEmail(userData.email || normalizedEmail)
        ? 'admin'
        : (userData.role || 'patient');

      return {
        uid: firebaseUser.uid,
        name: userData.name || firebaseUser.displayName || '',
        email: userData.email || firebaseUser.email || '',
        role: resolvedRole,
        residentId: userData.resident_id,
      };
    }

    if (response.status === 404 && isDefaultAdminEmail(normalizedEmail)) {
      await upsertUserProfile(
        {
          uid: firebaseUser.uid,
          name: firebaseUser.displayName || DEFAULT_ADMIN_NAME,
          email: normalizedEmail,
          role: 'admin',
        },
        token
      );

      return {
        uid: firebaseUser.uid,
        name: firebaseUser.displayName || DEFAULT_ADMIN_NAME,
        email: firebaseUser.email || normalizedEmail,
        role: 'admin',
      };
    }

    if (response.status === 404) {
      throw new Error('User profile not found. Please sign in again or contact admin.');
    }

    throw new Error(`Unable to load profile (${response.status}).`);
  } catch (err) {
    console.warn('[Auth] Could not fetch user profile from API:', err);
    throw err;
  }
}
