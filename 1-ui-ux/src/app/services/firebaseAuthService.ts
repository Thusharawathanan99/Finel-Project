// Firebase identities authenticate requests; the API owns all application roles.
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  getAuth,
  deleteUser,
  sendPasswordResetEmail,
  signOut as firebaseSignOut,
  onAuthStateChanged,
  updateProfile,
  type User as FirebaseUser,
} from 'firebase/auth';
import { initializeApp, deleteApp } from 'firebase/app';
import { auth } from '../firebase';
import { API_URL } from './apiConfig';

export type UserRole = 'patient' | 'caretaker' | 'admin';

export interface AppUser {
  uid: string;
  name: string;
  email: string;
  role: UserRole;
  residentId?: string;
}

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

export interface CreateResidentInput {
  name: string;
  email: string;
  password: string;
  residentId?: string;
  age?: number | string;
  roomNumber?: string;
  floorNumber?: string;
  address?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  emergencyContactRelation?: string;
  caretakerId?: string;
}

export interface CreatedResidentAccount {
  uid: string;
  residentId: string;
  name: string;
  email: string;
  role: 'patient';
}

export function getPasswordValidationError(password: string): string | null {
  if (password.length < 8) return 'Password must be at least 8 characters.';
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password)) {
    return 'Password must include uppercase, lowercase, and a number.';
  }
  return null;
}

export function getCaretakerPasswordValidationError(password: string): string | null {
  return password.length < 6 ? 'Temporary password must be at least 6 characters.' : null;
}

async function readResponse(response: Response): Promise<any> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw Object.assign(new Error(body.error || body.message || `Request failed (${response.status}). Please try again.`), { status: response.status });
  }
  return body;
}

async function registerAccount(endpoint: string, payload: object, token: string): Promise<any> {
  const request = () => fetch(`${API_URL}/users/${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  }).then(readResponse);
  try { return await request(); } catch (error: any) {
    if (error.status) throw error; // A completed transaction reported a definitive failure.
    return request(); // Registration is idempotent by Firebase UID; retry a lost response once.
  }
}

export async function getIdToken(): Promise<string | null> {
  const identity = auth.currentUser;
  const token = identity ? await identity.getIdToken() : null;
  if (auth.currentUser?.uid !== identity?.uid) throw new Error('Your signed-in account changed. Please try again.');
  return token;
}

async function signOutIdentity(identity: FirebaseUser): Promise<void> {
  if (auth.currentUser?.uid === identity.uid) await firebaseSignOut(auth).catch(() => {});
}

/** Create the application records in one backend transaction. */
export async function signUp(
  email: string,
  password: string,
  name: string,
  caretakerId: string,
  residentId?: string
): Promise<AppUser> {
  const normalizedEmail = email.trim().toLowerCase();
  const normalizedName = name.trim();
  if (!normalizedName) throw new Error('Full name is required.');
  if (!caretakerId) throw new Error('Please select a caretaker.');
  const passwordError = getPasswordValidationError(password);
  if (passwordError) throw new Error(passwordError);

  // Validate the public caretaker choice before creating a Firebase account.
  const caretakers = await readResponse(await fetch(`${API_URL}/caretakers`));
  if (!Array.isArray(caretakers) || !caretakers.some(c => c.caretaker_id === caretakerId && c.is_active !== false && c.is_active !== 0)) {
    throw new Error('Selected caretaker is no longer available. Please select another caretaker.');
  }

  let createdIdentity = true;
  let credential;
  try {
    credential = await createUserWithEmailAndPassword(auth, normalizedEmail, password);
  } catch (error: any) {
    if (error.code !== 'auth/email-already-in-use') throw error;
    // Recover an earlier incomplete signup, only after proving the account password.
    credential = await signInWithEmailAndPassword(auth, normalizedEmail, password);
    const token = await credential.user.getIdToken();
    const response = await fetch(`${API_URL}/users/${credential.user.uid}`, { headers: { Authorization: `Bearer ${token}` } });
    if (response.status !== 404) {
      await readResponse(response);
      throw new Error('An account with this email already exists. Please sign in.');
    }
    createdIdentity = false;
  }
  const firebaseUser = credential.user;
  let registrationAttempted = false;
  try {
    await updateProfile(firebaseUser, { displayName: normalizedName });
    const token = await firebaseUser.getIdToken();
    registrationAttempted = true;
    const data = await registerAccount('register-patient', { name: normalizedName, email: normalizedEmail, caretakerId, residentId: residentId?.trim() || undefined }, token);
    if (!data.residentId) throw new Error('Patient registration response was incomplete.');
    return { uid: firebaseUser.uid, name: normalizedName, email: normalizedEmail, role: 'patient', residentId: data.residentId };
  } catch (error) {
    // A lost response may follow a committed registration. Check before deleting identity.
    try {
      const token = await firebaseUser.getIdToken();
      const response = await fetch(`${API_URL}/users/${firebaseUser.uid}`, { headers: { Authorization: `Bearer ${token}` } });
      if (response.ok) {
        const data = await response.json();
        if (data.role === 'patient' && data.resident_id) {
          return { uid: firebaseUser.uid, name: data.name, email: data.email, role: 'patient', residentId: data.resident_id };
        }
      }
    } catch {
      // The original registration error remains the actionable error.
    }
    if ((registrationAttempted && !(error as any)?.status) || !createdIdentity) {
      await signOutIdentity(firebaseUser);
      throw new Error('Registration could not be confirmed. Retry Patient Register with the same email and password to finish safely.');
    }
    try {
      await deleteUser(firebaseUser);
    } catch {
      await signOutIdentity(firebaseUser);
      throw new Error('Registration did not finish and account cleanup failed. Retry Patient Register with the same email and password.');
    }
    throw error;
  }
}

/** Register a Facility Administrator account in Firebase and the database. */
export async function signUpAdmin(
  email: string,
  password: string,
  name: string
): Promise<AppUser> {
  const normalizedEmail = email.trim().toLowerCase();
  const normalizedName = name.trim();
  if (!normalizedName) throw new Error('Full name is required.');
  const passwordError = getPasswordValidationError(password);
  if (passwordError) throw new Error(passwordError);

  let credential;
  try {
    credential = await createUserWithEmailAndPassword(auth, normalizedEmail, password);
  } catch (error: any) {
    if (error.code !== 'auth/email-already-in-use') throw error;
    credential = await signInWithEmailAndPassword(auth, normalizedEmail, password);
  }

  const firebaseUser = credential.user;
  try {
    await updateProfile(firebaseUser, { displayName: normalizedName });
    const token = await firebaseUser.getIdToken();
    const data = await registerAccount('register-admin', { name: normalizedName, email: normalizedEmail }, token);
    return { uid: firebaseUser.uid, name: normalizedName, email: normalizedEmail, role: 'admin' };
  } catch (error) {
    throw error;
  }
}

export async function signIn(email: string, password: string): Promise<AppUser> {
  const credential = await signInWithEmailAndPassword(auth, email.trim().toLowerCase(), password);
  try {
    return await fetchUserProfile(credential.user);
  } catch (error) {
    await signOutIdentity(credential.user);
    throw error;
  }
}

export async function requestPasswordReset(email: string): Promise<void> {
  const normalizedEmail = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    throw new Error('Enter a valid email address first.');
  }
  try {
    await sendPasswordResetEmail(auth, normalizedEmail);
  } catch (error: any) {
    // Do not reveal whether an email address has an account.
    if (error?.code !== 'auth/user-not-found') throw error;
  }
}

export function formatAuthErrorMessage(error: any): string {
  if (!error) return 'An unexpected error occurred. Please try again.';
  const code = error?.code || '';
  const rawMessage = typeof error === 'string' ? error : (error?.message || error?.error || '');

  if (
    code === 'auth/email-already-in-use' ||
    rawMessage.includes('auth/email-already-in-use') ||
    rawMessage.includes('email-already-in-use') ||
    rawMessage.toLowerCase().includes('email already exists') ||
    rawMessage.toLowerCase().includes('email is already in use')
  ) {
    return 'This email address is already in use by another account. Please use a different email address.';
  }

  if (
    code === 'auth/weak-password' ||
    rawMessage.includes('auth/weak-password') ||
    rawMessage.includes('weak-password')
  ) {
    return 'Password is too weak. Please use at least 6 characters.';
  }

  if (
    code === 'auth/invalid-email' ||
    rawMessage.includes('auth/invalid-email') ||
    rawMessage.includes('invalid-email')
  ) {
    return 'Please enter a valid email address.';
  }

  if (
    code === 'auth/invalid-credential' ||
    code === 'auth/wrong-password' ||
    code === 'auth/user-not-found' ||
    rawMessage.includes('auth/invalid-credential') ||
    rawMessage.includes('auth/wrong-password') ||
    rawMessage.includes('auth/user-not-found')
  ) {
    return 'Invalid email or password.';
  }

  if (
    code === 'auth/too-many-requests' ||
    rawMessage.includes('too-many-requests')
  ) {
    return 'Too many attempts. Please try again later.';
  }

  if (rawMessage.startsWith('Firebase:')) {
    const match = rawMessage.match(/\(([^)]+)\)/);
    if (match) {
      const authCode = match[1].replace('auth/', '').replace(/-/g, ' ');
      return `Authentication error: ${authCode}. Please try again.`;
    }
  }

  return rawMessage || 'An unexpected error occurred. Please try again.';
}

/** Provision identity separately, then create profile and caretaker atomically. */
export async function createCaretakerAccount(input: CreateCaretakerInput): Promise<CreatedCaretakerAccount> {
  const currentUser = auth.currentUser;
  if (!currentUser) throw new Error('Please sign in as admin first.');
  const profile = await fetchUserProfile(currentUser);
  if (profile.role !== 'admin') throw new Error('Only admin can add caretakers.');
  const name = input.name.trim();
  const email = input.email.trim().toLowerCase();
  if (!name || !email) throw new Error('Caretaker name and email are required.');
  const passwordError = getCaretakerPasswordValidationError(input.password);
  if (passwordError) throw new Error(passwordError);
  const token = await currentUser.getIdToken();
  const isolatedApp = initializeApp(firebaseConfig, `careconnect-provision-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  const isolatedAuth = getAuth(isolatedApp);
  let createdUser: FirebaseUser | undefined;
  let createdIdentity = true;
  let registrationAttempted = false;
  try {
    let credential;
    try {
      credential = await createUserWithEmailAndPassword(isolatedAuth, email, input.password);
      createdIdentity = true;
    } catch (authError: any) {
      if (
        authError?.code === 'auth/email-already-in-use' ||
        String(authError?.message).includes('auth/email-already-in-use')
      ) {
        try {
          credential = await signInWithEmailAndPassword(isolatedAuth, email, input.password);
          createdIdentity = false;
        } catch {
          throw new Error('This email address is already in use by another account. Please use a different email address.');
        }
      } else {
        throw new Error(formatAuthErrorMessage(authError));
      }
    }
    createdUser = credential.user;
    if (!createdIdentity) {
      try {
        const response = await fetch(`${API_URL}/users/${createdUser.uid}`, { headers: { Authorization: `Bearer ${token}` } });
        if (response.ok) {
          const existing = await response.json();
          if (existing.role === 'caretaker') {
            const caretakers = await readResponse(await fetch(`${API_URL}/caretakers`, { headers: { Authorization: `Bearer ${token}` } }));
            const caretaker = caretakers.find((c: any) => c.email?.toLowerCase() === email || c.user_id === createdUser?.uid);
            if (caretaker) return { uid: createdUser.uid, caretakerId: caretaker.caretaker_id, name: caretaker.name || name, email, role: 'caretaker' };
          }
          throw new Error('This email address is already in use by another account. Please use a different email address.');
        }
      } catch (err: any) {
        if (err.status && err.status !== 404) throw err;
      }
    }
    await updateProfile(createdUser, { displayName: name });
    registrationAttempted = true;
    const data = await registerAccount('register-caretaker', { uid: createdUser.uid, name, email, phone: input.phone?.trim() || '', specialization: input.specialization?.trim() || '' }, token);
    return { uid: createdUser.uid, caretakerId: data.caretakerId, name, email, role: 'caretaker' };
  } catch (error) {
    if (createdUser && createdIdentity) {
      // Preserve identity if the transaction committed but its response was lost.
      try {
        const response = await fetch(`${API_URL}/users/${createdUser.uid}`, { headers: { Authorization: `Bearer ${token}` } });
        if (response.ok) {
          const existing = await response.json();
          if (existing.role === 'caretaker') {
            const caretakers = await readResponse(await fetch(`${API_URL}/caretakers`, { headers: { Authorization: `Bearer ${token}` } }));
            const caretaker = caretakers.find((c: any) => c.email?.toLowerCase() === email);
            if (caretaker) return { uid: createdUser.uid, caretakerId: caretaker.caretaker_id, name, email, role: 'caretaker' };
          }
        }
      } catch {
        // Best effort confirmation; the provisioning error is shown below.
      }
      if (registrationAttempted && !(error as any)?.status) throw new Error('Caretaker creation could not be confirmed. Check the account before trying again.');
      try { await deleteUser(createdUser); } catch {
        throw new Error('Caretaker creation failed and identity cleanup failed. Check the account before trying again.');
      }
    }
    throw error instanceof Error ? error : new Error(formatAuthErrorMessage(error));
  } finally {
    await firebaseSignOut(isolatedAuth).catch(() => {});
    await deleteApp(isolatedApp);
  }
}

/** Provision resident identity separately, then create profile and resident atomically. */
export async function createResidentAccount(input: CreateResidentInput): Promise<CreatedResidentAccount> {
  const currentUser = auth.currentUser;
  if (!currentUser) throw new Error('Please sign in as admin first.');
  const profile = await fetchUserProfile(currentUser);
  if (profile.role !== 'admin') throw new Error('Only admin can add residents.');
  const name = input.name.trim();
  const email = input.email.trim().toLowerCase();
  if (!name || !email) throw new Error('Resident name and email are required.');
  const passwordError = getCaretakerPasswordValidationError(input.password);
  if (passwordError) throw new Error(passwordError);
  const token = await currentUser.getIdToken();
  const isolatedApp = initializeApp(firebaseConfig, `careconnect-resident-provision-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  const isolatedAuth = getAuth(isolatedApp);
  let createdUser: FirebaseUser | undefined;
  let createdIdentity = true;
  let registrationAttempted = false;
  try {
    let credential;
    try {
      credential = await createUserWithEmailAndPassword(isolatedAuth, email, input.password);
      createdIdentity = true;
    } catch (authError: any) {
      if (
        authError?.code === 'auth/email-already-in-use' ||
        String(authError?.message).includes('auth/email-already-in-use')
      ) {
        try {
          credential = await signInWithEmailAndPassword(isolatedAuth, email, input.password);
          createdIdentity = false;
        } catch {
          throw new Error('This email address is already in use by another account. Please use a different email address.');
        }
      } else {
        throw new Error(formatAuthErrorMessage(authError));
      }
    }
    createdUser = credential.user;
    if (!createdIdentity) {
      try {
        const response = await fetch(`${API_URL}/users/${createdUser.uid}`, { headers: { Authorization: `Bearer ${token}` } });
        if (response.ok) {
          const existing = await response.json();
          if (existing.role === 'patient' && existing.resident_id) {
            if (!input.residentId || input.residentId === existing.resident_id) {
              return { uid: createdUser.uid, residentId: existing.resident_id, name: existing.name || name, email, role: 'patient' };
            }
          }
          throw new Error('This email address is already in use by another account. Please use a different email address.');
        }
      } catch (err: any) {
        if (err.status && err.status !== 404) throw err;
      }
    }
    await updateProfile(createdUser, { displayName: name });
    registrationAttempted = true;
    const data = await registerAccount('register-resident', {
      uid: createdUser.uid,
      name,
      email,
      residentId: input.residentId?.trim() || undefined,
      age: input.age !== undefined && input.age !== '' ? Number(input.age) : undefined,
      roomNumber: input.roomNumber?.trim() || undefined,
      floorNumber: input.floorNumber?.trim() || undefined,
      address: input.address?.trim() || undefined,
      city: input.city?.trim() || undefined,
      state: input.state?.trim() || undefined,
      zipCode: input.zipCode?.trim() || undefined,
      emergencyContactName: input.emergencyContactName?.trim() || undefined,
      emergencyContactPhone: input.emergencyContactPhone?.trim() || undefined,
      emergencyContactRelation: input.emergencyContactRelation?.trim() || undefined,
      caretakerId: input.caretakerId?.trim() || undefined,
    }, token);
    return { uid: createdUser.uid, residentId: data.residentId, name, email, role: 'patient' };
  } catch (error) {
    if (createdUser && createdIdentity) {
      try {
        const response = await fetch(`${API_URL}/users/${createdUser.uid}`, { headers: { Authorization: `Bearer ${token}` } });
        if (response.ok) {
          const existing = await response.json();
          if (existing.role === 'patient' && existing.resident_id) {
            return { uid: createdUser.uid, residentId: existing.resident_id, name, email, role: 'patient' };
          }
        }
      } catch {
        // Best effort confirmation
      }
      if (registrationAttempted && !(error as any)?.status) {
        throw new Error('Resident account creation could not be confirmed. Check the account before trying again.');
      }
      try { await deleteUser(createdUser); } catch {
        throw new Error('Resident account creation failed and identity cleanup failed. Check the account before trying again.');
      }
    }
    throw error instanceof Error ? error : new Error(formatAuthErrorMessage(error));
  } finally {
    await firebaseSignOut(isolatedAuth).catch(() => {});
    await deleteApp(isolatedApp);
  }
}

export async function signOut(): Promise<void> {
  await firebaseSignOut(auth);
}

export function onAuthStateChange(callback: (user: FirebaseUser | null) => void): () => void {
  return onAuthStateChanged(auth, callback);
}

/** A missing/unreachable application profile is an error, never a guessed role. */
export async function fetchUserProfile(firebaseUser: FirebaseUser): Promise<AppUser> {
  const assertIdentity = () => {
    if (auth.currentUser?.uid !== firebaseUser.uid) throw new Error('Your signed-in account changed. Please sign in again.');
  };
  assertIdentity();
  const token = await firebaseUser.getIdToken();
  assertIdentity();
  const data = await readResponse(await fetch(`${API_URL}/users/${firebaseUser.uid}`, { headers: { Authorization: `Bearer ${token}` } }));
  assertIdentity();
  if (!['patient', 'caretaker', 'admin'].includes(data.role)) throw new Error('Account role is not configured. Please contact your administrator.');
  if (data.role === 'patient' && !data.resident_id) throw new Error('Patient profile is incomplete. Please contact your administrator.');
  return { uid: firebaseUser.uid, name: data.name || firebaseUser.displayName || '', email: data.email || firebaseUser.email || '', role: data.role, residentId: data.resident_id || undefined };
}
