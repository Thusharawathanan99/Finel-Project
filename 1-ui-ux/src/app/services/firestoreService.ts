// Firestore real-time service for CareConnect
// Handles: real-time alerts, notifications, live emotional state updates
import {
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  where,
  orderBy,
  limit,
  serverTimestamp,
  type Unsubscribe,
  Timestamp,
} from 'firebase/firestore';
import { db } from '../firebase';

/** Server-written per-user change signals; authoritative clinical data stays in SQL. */
export function subscribeToCareUpdates(userId: string, callback: () => void): Unsubscribe {
  let previous: string | null = null;
  return onSnapshot(doc(db, 'users', userId, 'care_updates', 'latest'), snapshot => {
    if (!snapshot.exists()) return;
    const data = snapshot.data();
    const revision = JSON.stringify(data);
    if (previous !== null && revision !== previous) callback();
    previous = revision;
  }, error => { console.warn('[Firestore] Care updates unavailable:', error.code); });
}

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

export interface RealtimeAlert {
  id?: string;
  type: 'wellness' | 'medication' | 'emergency' | 'system';
  severity: 'low' | 'medium' | 'high' | 'critical';
  message: string;
  residentId?: string;
  residentName?: string;
  targetRoles: ('patient' | 'caretaker' | 'admin')[];
  acknowledged: boolean;
  acknowledgedBy?: string;
  createdAt: Timestamp | null;
}

export interface Notification {
  id?: string;
  targetUserId: string;
  title: string;
  message: string;
  type: 'info' | 'warning' | 'success' | 'error';
  read: boolean;
  createdAt: Timestamp | null;
}

export interface LiveEmotionUpdate {
  id?: string;
  residentId: string;
  residentName: string;
  stateScore: number;
  emotionalLevel: string;
  timestamp: Timestamp | null;
}

// ──────────────────────────────────────────────
// Alerts — Real-time subscriptions
// ──────────────────────────────────────────────

/**
 * Subscribe to real-time alerts filtered by user role.
 * Returns unsubscribe function.
 */
export function subscribeToAlerts(
  role: 'patient' | 'caretaker' | 'admin',
  callback: (alerts: RealtimeAlert[]) => void
): Unsubscribe {
  const alertsRef = collection(db, 'alerts');
  const q = query(
    alertsRef,
    where('targetRoles', 'array-contains', role),
    orderBy('createdAt', 'desc'),
    limit(50)
  );

  try {
    return onSnapshot(q, (snapshot) => {
      const alerts: RealtimeAlert[] = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      } as RealtimeAlert));
      callback(alerts);
    }, (error) => {
      console.warn('[Firestore] Alert subscription with composite index failed, falling back to in-memory sort:', error.message);
      // Fallback: single filter without composite index order, sorted in-memory
      const fallbackQ = query(alertsRef, where('targetRoles', 'array-contains', role), limit(50));
      return onSnapshot(fallbackQ, (snapshot) => {
        const alerts: RealtimeAlert[] = snapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        } as RealtimeAlert));
        alerts.sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
        callback(alerts);
      }, (fallbackError) => {
        console.error('[Firestore] Fallback alert subscription failed:', fallbackError);
      });
    });
  } catch (err) {
    console.error('[Firestore] subscribeToAlerts error:', err);
    return () => {};
  }
}

/**
 * Push a new real-time alert.
 */
export async function pushAlert(alert: Omit<RealtimeAlert, 'id' | 'createdAt'>): Promise<string> {
  const alertsRef = collection(db, 'alerts');
  const docRef = await addDoc(alertsRef, {
    ...alert,
    createdAt: serverTimestamp(),
  });
  return docRef.id;
}

/**
 * Acknowledge a real-time alert.
 */
export async function acknowledgeAlert(alertId: string, userId: string): Promise<void> {
  const alertRef = doc(db, 'alerts', alertId);
  await updateDoc(alertRef, {
    acknowledged: true,
    acknowledgedBy: userId,
  });
}

/**
 * Delete a real-time alert.
 */
export async function deleteAlert(alertId: string): Promise<void> {
  const alertRef = doc(db, 'alerts', alertId);
  await deleteDoc(alertRef);
}

// ──────────────────────────────────────────────
// Notifications — Per-user
// ──────────────────────────────────────────────

/**
 * Subscribe to notifications for a specific user.
 */
export function subscribeToNotifications(
  userId: string,
  callback: (notifications: Notification[]) => void
): Unsubscribe {
  const notifRef = collection(db, 'notifications');
  const q = query(
    notifRef,
    where('targetUserId', '==', userId),
    orderBy('createdAt', 'desc'),
    limit(20)
  );

  return onSnapshot(q, (snapshot) => {
    const notifications: Notification[] = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    } as Notification));
    callback(notifications);
  }, (error) => {
    console.error('[Firestore] Notification subscription error:', error);
  });
}

/**
 * Push a notification to a specific user.
 */
export async function pushNotification(
  targetUserId: string,
  title: string,
  message: string,
  type: 'info' | 'warning' | 'success' | 'error' = 'info'
): Promise<string> {
  const notifRef = collection(db, 'notifications');
  const docRef = await addDoc(notifRef, {
    targetUserId,
    title,
    message,
    type,
    read: false,
    createdAt: serverTimestamp(),
  });
  return docRef.id;
}

/**
 * Mark a notification as read.
 */
export async function markNotificationRead(notificationId: string): Promise<void> {
  const notifRef = doc(db, 'notifications', notificationId);
  await updateDoc(notifRef, { read: true });
}

// ──────────────────────────────────────────────
// Live Emotion Updates — Real-time dashboard
// ──────────────────────────────────────────────

/**
 * Subscribe to live emotional state updates (for caretaker/admin dashboards).
 */
export function subscribeToEmotionUpdates(
  callback: (updates: LiveEmotionUpdate[]) => void
): Unsubscribe {
  const emotionRef = collection(db, 'live_emotions');
  const q = query(
    emotionRef,
    orderBy('timestamp', 'desc'),
    limit(20)
  );

  return onSnapshot(q, (snapshot) => {
    const updates: LiveEmotionUpdate[] = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    } as LiveEmotionUpdate));
    callback(updates);
  }, (error) => {
    console.error('[Firestore] Emotion subscription error:', error);
  });
}

/**
 * Push a live emotion update (called after emotion analysis completes).
 */
export async function pushEmotionUpdate(update: Omit<LiveEmotionUpdate, 'id' | 'timestamp'>): Promise<string> {
  const emotionRef = collection(db, 'live_emotions');
  const docRef = await addDoc(emotionRef, {
    ...update,
    timestamp: serverTimestamp(),
  });
  return docRef.id;
}
