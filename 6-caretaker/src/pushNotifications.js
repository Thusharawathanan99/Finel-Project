import { useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as Crypto from 'expo-crypto';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from './firebase/config';
import { apiFetch, getApiBase } from './apiHelper';

const INSTALLATION_KEY = 'careconnect:push-installation:v1';
let installationPromise;
let deviceOperations = Promise.resolve();
let localDoseOwner = null, localRefresh = 0;
const credentials = new Map();
const serializeDeviceOperation = operation => {
  const result = deviceOperations.then(operation, operation);
  deviceOperations = result.catch(() => {});
  return result;
};
const currentUser = user => auth.currentUser?.uid === user?.uid;
async function installationIdentity() {
  if (!installationPromise) installationPromise = (async () => {
    const saved = await AsyncStorage.getItem(INSTALLATION_KEY);
    if (saved) {
      try { const identity = JSON.parse(saved); if (identity.installationId && /^[a-f\d]{64}$/.test(identity.installationKey)) return identity; } catch { /* Replace invalid local identity. */ }
    }
    const bytes = await Crypto.getRandomBytesAsync(32);
    const identity = { installationId: Crypto.randomUUID(), installationKey: [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('') };
    await AsyncStorage.setItem(INSTALLATION_KEY, JSON.stringify(identity));
    return identity;
  })().catch(error => { installationPromise = undefined; throw error; });
  return installationPromise;
}

async function deviceRequest(method, bearer, body, path = '/push-devices') {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try { return await fetch(getApiBase() + path, { method, signal: controller.signal, headers: { 'Content-Type': 'application/json', ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) }, body: JSON.stringify(body) }); }
  finally { clearTimeout(timer); }
}

async function revokeDevice(identity, bearer) {
  if (bearer) {
    try {
      const response = await deviceRequest('DELETE', bearer, identity);
      if (response.ok) return;
    } catch { /* A cleared or expired account token cannot block possession cleanup. */ }
  }
  const response = await deviceRequest('DELETE', null, identity, '/push-devices/revoke-installation');
  if (!response.ok) throw new Error('Notification cleanup will retry when CareConnect is opened again.');
}

async function cancelLocalDoses(reminderId, foreignToUid) {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  for (const item of scheduled) {
    const data = item.content?.data;
    if (data?.careconnectLocalDose && (reminderId === undefined || String(data.reminderId) === String(reminderId)) && (foreignToUid === undefined || data.ownerUid !== foreignToUid)) await Notifications.cancelScheduledNotificationAsync(item.identifier);
  }
}

export async function cancelLocalDoseReminder(reminderId) {
  if (Platform.OS === 'web') return;
  localRefresh += 1;
  return serializeDeviceOperation(() => cancelLocalDoses(reminderId));
}

// Local fallback uses approved server occurrences for the next 48 hours only.
// Server push and local dose delivery are mutually exclusive after registration.
export async function syncLocalDoseReminders(residentId) {
  const user = auth.currentUser;
  if (Platform.OS === 'web' || !user || localDoseOwner !== user.uid || !residentId) return;
  const run = ++localRefresh;
  const now = Date.now(), end = now + 48 * 60 * 60_000;
  const day = new Date(now + 330 * 60_000).toISOString().slice(0, 10);
  // Occurrences keep their original event day when a late dose is snoozed
  // past midnight. Include yesterday so those reminders are retained.
  const days = [-1, 0, 1, 2].map(offset => new Date(Date.parse(`${day}T00:00:00Z`) + offset * 86_400_000).toISOString().slice(0, 10));
  const groups = await Promise.all(days.map(async value => {
    const response = await apiFetch(`/residents/${encodeURIComponent(residentId)}/medication-reminders?day=${value}`);
    const rows = await response.json();
    if (!response.ok) throw new Error(rows.error || 'Local dose reminders could not refresh.');
    return rows;
  }));
  await serializeDeviceOperation(async () => {
    if (run !== localRefresh || !currentUser(user) || localDoseOwner !== user.uid) return;
    await cancelLocalDoses();
    const uniqueDoses = new Map(groups.flat().map(dose => [String(dose.reminder_id), dose]));
    const doses = [...uniqueDoses.values()].filter(dose => ['pending', 'snoozed'].includes(dose.status) && new Date(dose.presentation_at).getTime() > now && new Date(dose.presentation_at).getTime() <= end).sort((a, b) => new Date(a.presentation_at) - new Date(b.presentation_at)).slice(0, 60);
    for (const dose of doses) {
      if (run !== localRefresh || !currentUser(user) || localDoseOwner !== user.uid) { await cancelLocalDoses(); return; }
      await Notifications.scheduleNotificationAsync({
        identifier: `careconnect-dose:${dose.reminder_id}:${dose.delivery_round}`,
        content: { title: 'CareConnect reminder', body: 'A scheduled dose is due. Open CareConnect to review it.', sound: 'default', data: { careconnectLocalDose: true, ownerUid: user.uid, reminderId: String(dose.reminder_id), deliveryRound: dose.delivery_round } },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(dose.presentation_at), channelId: 'medication' },
      });
    }
  });
}

// Capture credentials while signed in, and serialize revocation behind any
// registration already in flight so an old response cannot reclaim the device.
export async function unregisterPushNotifications(user = auth.currentUser) {
  if (Platform.OS === 'web') return;
  localDoseOwner = null; localRefresh += 1;
  const bearer = user && (credentials.get(user.uid) || await user.getIdToken().catch(() => null));
  return serializeDeviceOperation(async () => {
    // Native cleanup and server revocation each proceed if the other fails.
    await cancelLocalDoses().catch(() => {});
    await Notifications.dismissAllNotificationsAsync().catch(() => {});
    const saved = await AsyncStorage.getItem(INSTALLATION_KEY);
    if (!saved) return;
    try { await revokeDevice(JSON.parse(saved), bearer); }
    finally { if (user) credentials.delete(user.uid); }
  });
}

export function usePushNotifications(expectedRole) {
  const [state, setState] = useState({ status: 'idle', message: '' });
  const activeUser = useRef(null);
  const generation = useRef(0);
  const registerRef = useRef(null);
  useEffect(() => {
    if (Platform.OS === 'web') return;
    let active = true, inFlightUid = null;
    Notifications.setNotificationHandler({ handleNotification: async notification => {
      const owner = notification.request?.content?.data?.ownerUid;
      const show = Boolean(auth.currentUser) && owner === auth.currentUser.uid;
      return { shouldShowBanner: show, shouldShowList: show, shouldPlaySound: show, shouldSetBadge: false };
    } });
    const register = async (user, mayPrompt = true) => {
      if (!user || inFlightUid === user.uid) return;
      const run = generation.current;
      const current = () => active && run === generation.current && auth.currentUser?.uid === user.uid;
      inFlightUid = user.uid;
      try {
        const bearer = await user.getIdToken();
        if (!current()) return;
        credentials.set(user.uid, bearer);
        const profileResponse = await apiFetch(`/users/${encodeURIComponent(user.uid)}`);
        if (!profileResponse.ok || !current()) return;
        const profile = await profileResponse.json();
        if (!current() || profile.role !== expectedRole || expectedRole === 'patient' && !profile.resident_id) return;
        if (!Device.isDevice || Platform.OS === 'android' && Constants.executionEnvironment === 'storeClient') {
          if (current()) setState({ status: 'unsupported', message: 'Remote notifications require an installed CareConnect build on a physical device.' }); return;
        }
        if (Platform.OS === 'android') {
          await Notifications.setNotificationChannelAsync('medication', { name: 'Medication reminders', importance: Notifications.AndroidImportance.HIGH });
          await Notifications.setNotificationChannelAsync('care-alerts', { name: 'Care alerts', importance: Notifications.AndroidImportance.MAX, vibrationPattern: [0, 250, 250, 250] });
        }
        let permission = await Notifications.getPermissionsAsync();
        if (permission.status === 'undetermined' && mayPrompt && current()) permission = await Notifications.requestPermissionsAsync();
        if (!current()) return;
        if (!permission.granted && permission.ios?.status !== Notifications.IosAuthorizationStatus.PROVISIONAL) {
          await unregisterPushNotifications(user).catch(() => {});
          if (!current()) return;
          setState({ status: 'denied', message: 'Enable notifications in device settings. Care records remain available in the app.' }); return;
        }
        const projectId = Constants.expoConfig?.extra?.eas?.projectId || Constants.easConfig?.projectId;
        if (!projectId) throw new Error('The mobile build has no notification project ID.');
        const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
        const identity = await installationIdentity();
        if (!current()) return;
        const result = await serializeDeviceOperation(async () => {
          if (!current()) return null;
          const response = await deviceRequest('POST', bearer, { ...identity, token, projectId, platform: Platform.OS });
          const saved = await response.json();
          if (!current()) {
            await revokeDevice(identity, bearer).catch(() => {});
            return null;
          }
          if (!response.ok) throw new Error(saved.error || 'Notification registration failed.');
          localDoseOwner = expectedRole === 'patient' && !saved.sendingEnabled ? user.uid : null;
          if (saved.sendingEnabled || expectedRole !== 'patient') { localRefresh += 1; await cancelLocalDoses(); }
          return saved;
        });
        if (!current()) return;
        if (!result) return;
        if (localDoseOwner === user.uid) await syncLocalDoseReminders(profile.resident_id);
        if (!current()) return;
        setState(result.sendingEnabled ? { status: 'registered', message: '' } : { status: 'disabled', message: expectedRole === 'patient' ? 'Local dose reminders cover the next 48 hours. Open CareConnect daily to refresh them. Remote alerts await server activation.' : 'This device is registered. Remote notification delivery is awaiting server activation.' });
      } catch (error) { if (current()) setState({ status: 'error', message: error?.message || 'Notifications could not connect. Tap to retry.' }); }
      finally { if (inFlightUid === user.uid) inFlightUid = null; }
    };
    registerRef.current = register;
    const unsubscribe = onAuthStateChanged(auth, user => {
      const previous = activeUser.current;
      activeUser.current = user;
      generation.current += 1;
      setState({ status: 'idle', message: '' });
      if (previous && previous.uid !== user?.uid) void unregisterPushNotifications(previous).catch(() => {});
      else if (!user) void unregisterPushNotifications(null).catch(() => {});
      else void serializeDeviceOperation(() => cancelLocalDoses(undefined, user.uid)).catch(() => {});
      if (user) void register(user);
    });
    const appState = AppState.addEventListener('change', next => {
      if (next !== 'active') return;
      if (auth.currentUser) void register(auth.currentUser, false);
      else void unregisterPushNotifications(null).catch(() => {});
    });
    const tokenListener = Notifications.addPushTokenListener(() => { if (auth.currentUser) void register(auth.currentUser, false); });
    return () => { active = false; generation.current += 1; unsubscribe(); appState.remove(); tokenListener.remove(); registerRef.current = null; };
  }, [expectedRole]);
  return { ...state, retry: () => { if (auth.currentUser) void registerRef.current?.(auth.currentUser); } };
}
