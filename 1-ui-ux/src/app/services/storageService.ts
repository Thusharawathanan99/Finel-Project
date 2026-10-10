// Firebase Storage service for CareConnect
// Handles: prescription image uploads, download URLs
import {
  ref,
  uploadBytesResumable,
  getDownloadURL,
  deleteObject,
  type UploadMetadata,
  type StorageReference,
} from 'firebase/storage';
import { storage, auth } from '../firebase';
import {apiPost} from './apiService';

const STORAGE_REQUEST_TIMEOUT_MS = import.meta.env.DEV ? 8000 : 15000;
const DISABLE_STORAGE_UPLOAD_IN_DEV =
  import.meta.env.DEV && import.meta.env.VITE_DISABLE_FIREBASE_STORAGE_UPLOAD !== 'false';

function shouldSkipStorageUpload(): boolean {
  if (!DISABLE_STORAGE_UPLOAD_IN_DEV) {
    return false;
  }

  if (typeof window === 'undefined') {
    return true;
  }

  const host = window.location.hostname;
  return host === 'localhost' || host === '127.0.0.1';
}

function buildSkipError(): Error {
  return new Error(
    '[Storage] Upload skipped in local dev to avoid Firebase CORS failures. Set VITE_DISABLE_FIREBASE_STORAGE_UPLOAD=false to force uploads.'
  );
}

function uploadWithTimeout(
  storageRef: StorageReference,
  data: Blob | Uint8Array | ArrayBuffer,
  metadata: UploadMetadata,
  label: string
) {
  return new Promise<import('firebase/storage').UploadTaskSnapshot>((resolve, reject) => {
    const task = uploadBytesResumable(storageRef, data, metadata);

    const timeoutId = setTimeout(() => {
      task.cancel();
      reject(new Error(`[Storage] ${label} timed out after ${STORAGE_REQUEST_TIMEOUT_MS}ms`));
    }, STORAGE_REQUEST_TIMEOUT_MS);

    task.on(
      'state_changed',
      undefined,
      (error) => {
        clearTimeout(timeoutId);
        reject(error);
      },
      () => {
        clearTimeout(timeoutId);
        resolve(task.snapshot);
      }
    );
  });
}

async function withTimeout<T>(operation: Promise<T>, label: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`[Storage] ${label} timed out after ${STORAGE_REQUEST_TIMEOUT_MS}ms`));
    }, STORAGE_REQUEST_TIMEOUT_MS);
  });

  try {
    return await Promise.race([operation, timeoutPromise]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

/**
 * Upload a prescription image to Firebase Storage.
 * Path: prescriptions/{residentId}/{timestamp}_{filename}
 * Returns the download URL.
 */
export async function uploadPrescriptionImage(
  file: File,
  residentId: string
): Promise<{ url: string; path: string }> {
  if (shouldSkipStorageUpload()) {
    throw buildSkipError();
  }

  const timestamp = Date.now();
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const storagePath = `prescriptions/${residentId}/${timestamp}_${safeName}`;
  const access=await apiPost<{uid:string}>(`/storage/prescriptions/${encodeURIComponent(residentId)}/access`,{});
  if(access.uid!==auth.currentUser?.uid)throw new Error('Account changed during image upload. Please try again.');

  const storageRef = ref(storage, storagePath);

  // Upload the file
  const snapshot = await uploadWithTimeout(
    storageRef,
    file,
    {
      contentType: file.type,
      customMetadata: {
        residentId,
        uploadedByUid:access.uid,
        uploadedAt: new Date().toISOString(),
      },
    },
    'upload'
  );

  // Get download URL
  const url = await withTimeout(getDownloadURL(snapshot.ref), 'getDownloadURL');

  console.log(`[Storage] Uploaded prescription image: ${storagePath}`);
  return { url, path: storagePath };
}

/**
 * Upload a base64 image (from camera capture) to Firebase Storage.
 */
export async function uploadBase64Image(
  base64Data: string,
  residentId: string,
  filename: string = 'camera_capture.jpg'
): Promise<{ url: string; path: string }> {
  if (shouldSkipStorageUpload()) {
    throw buildSkipError();
  }

  // Extract base64 content
  const base64Content = base64Data.includes(',')
    ? base64Data.split(',')[1]
    : base64Data;

  // Convert to blob
  const byteCharacters = atob(base64Content);
  const byteArray = new Uint8Array(byteCharacters.length);
  for (let i = 0; i < byteCharacters.length; i++) {
    byteArray[i] = byteCharacters.charCodeAt(i);
  }
  const blob = new Blob([byteArray], { type: 'image/jpeg' });

  const timestamp = Date.now();
  const storagePath = `prescriptions/${residentId}/${timestamp}_${filename.replace(/[^a-zA-Z0-9._-]/g,'_')}`;
  const access=await apiPost<{uid:string}>(`/storage/prescriptions/${encodeURIComponent(residentId)}/access`,{});
  if(access.uid!==auth.currentUser?.uid)throw new Error('Account changed during image upload. Please try again.');
  const storageRef = ref(storage, storagePath);

  const snapshot = await uploadWithTimeout(
    storageRef,
    blob,
    {
      contentType: 'image/jpeg',
      customMetadata: {
        residentId,
        uploadedByUid:access.uid,
        uploadedAt: new Date().toISOString(),
        source: 'camera',
      },
    },
    'upload'
  );

  const url = await withTimeout(getDownloadURL(snapshot.ref), 'getDownloadURL');
  console.log(`[Storage] Uploaded camera image: ${storagePath}`);
  return { url, path: storagePath };
}

/**
 * Get the download URL for a storage path.
 */
export async function getImageUrl(storagePath: string): Promise<string> {
  const storageRef = ref(storage, storagePath);
  return getDownloadURL(storageRef);
}

/**
 * Delete an image from Firebase Storage.
 */
export async function deletePrescriptionImage(storagePath: string): Promise<void> {
  const storageRef = ref(storage, storagePath);
  await deleteObject(storageRef);
  console.log(`[Storage] Deleted: ${storagePath}`);
}
