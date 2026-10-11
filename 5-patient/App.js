import { StatusBar } from 'expo-status-bar';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { auth } from './src/firebase/config';
import { apiFetch, clearCache } from './src/apiHelper';
import { resolveInitialSession } from './src/sessionBootstrap';
import AppNavigator from './src/navigation/AppNavigator';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { unregisterPushNotifications, usePushNotifications } from './src/pushNotifications';
import { ProfessionalAlertProvider } from './src/components/ProfessionalAlert';

export default function App() {
  const notifications = usePushNotifications('patient');
  const previousUid = useRef(undefined);
  const bootstrapRun = useRef(0);
  const [sessionEpoch, setSessionEpoch] = useState(0);
  const [bootstrap, setBootstrap] = useState({ status: 'loading', route: 'Login', message: '' });

  const verifySavedSession = useCallback(async (user) => {
    const run = ++bootstrapRun.current;
    setBootstrap({ status: 'loading', route: 'Login', message: '' });
    try {
      const result = await resolveInitialSession({
        auth,
        user,
        apiFetch,
        expectedRole: 'patient',
        requireResident: true,
      });
      if (run !== bootstrapRun.current) return;
      if (result.invalidate && user && auth.currentUser?.uid === user.uid) {
        await unregisterPushNotifications(user).catch(() => {});
        await signOut(auth).catch(() => {});
        return;
      }
      setBootstrap({ status: 'ready', route: result.route, message: '' });
    } catch (error) {
      if (run === bootstrapRun.current) {
        setBootstrap({
          status: 'error',
          route: 'Login',
          message: error?.message || 'CareConnect could not verify your saved session.',
        });
      }
    }
  }, []);

  useEffect(() => onAuthStateChanged(auth, user => {
    clearCache();
    const uid = user?.uid || null;
    const priorUid = previousUid.current;
    previousUid.current = uid;

    if (priorUid === undefined) {
      if (user) {
        signOut(auth).catch(() => {});
      }
      setBootstrap({ status: 'ready', route: 'Login', message: '' });
      return;
    }

    bootstrapRun.current += 1;
    if (!user) {
      if (priorUid) setSessionEpoch(epoch => epoch + 1);
      setBootstrap({ status: 'ready', route: 'Login', message: '' });
    } else if (priorUid && priorUid !== uid) {
      setSessionEpoch(epoch => epoch + 1);
      void verifySavedSession(user);
    }
  }), [verifySavedSession]);

  const leaveSavedSession = async () => {
    bootstrapRun.current += 1;
    await unregisterPushNotifications().catch(() => {});
    await signOut(auth).catch(() => {});
    clearCache();
    setBootstrap({ status: 'ready', route: 'Login', message: '' });
  };

  if (bootstrap.status !== 'ready') {
    return (
      <SafeAreaProvider style={{ flex: 1 }}>
        <ProfessionalAlertProvider>
          <View style={styles.sessionScreen}>
            <View style={styles.sessionMark}><Text style={styles.sessionMarkText}>+</Text></View>
            <Text style={styles.sessionTitle}>CareConnect</Text>
            {bootstrap.status === 'loading' ? (
              <>
                <ActivityIndicator size="large" color="#6D38FF" />
                <Text style={styles.sessionMessage}>Checking your saved patient session...</Text>
              </>
            ) : (
              <>
                <Text accessibilityRole="alert" style={styles.sessionMessage}>{bootstrap.message}</Text>
                <TouchableOpacity style={styles.primaryButton} onPress={() => verifySavedSession(auth.currentUser)}>
                  <Text style={styles.primaryButtonText}>Try Again</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.secondaryButton} onPress={leaveSavedSession}>
                  <Text style={styles.secondaryButtonText}>Sign In With Another Account</Text>
                </TouchableOpacity>
              </>
            )}
            <StatusBar style="auto" />
          </View>
        </ProfessionalAlertProvider>
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider style={{ flex: 1 }}>
      <ProfessionalAlertProvider>
        {notifications.message ? <TouchableOpacity accessibilityRole="button" onPress={notifications.retry} style={styles.notificationNotice}><Text style={styles.notificationNoticeText}>{notifications.message}</Text></TouchableOpacity> : null}
        <AppNavigator key={`${sessionEpoch}-${bootstrap.route}`} initialRouteName={bootstrap.route} />
        <StatusBar style="auto" />
      </ProfessionalAlertProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  notificationNotice: { backgroundColor: '#FFF5DB', paddingHorizontal: 16, paddingTop: 32, paddingBottom: 10 },
  notificationNoticeText: { color: '#684A13', fontSize: 12, lineHeight: 18 },
  sessionScreen: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F6F5FF', padding: 28 },
  sessionMark: { width: 58, height: 58, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: '#6D38FF', marginBottom: 14 },
  sessionMarkText: { color: '#FFFFFF', fontSize: 34, lineHeight: 38, fontWeight: '800' },
  sessionTitle: { color: '#171459', fontSize: 25, fontWeight: '800', marginBottom: 20 },
  sessionMessage: { maxWidth: 360, color: '#615C87', fontSize: 14, lineHeight: 21, textAlign: 'center', marginTop: 16, marginBottom: 18 },
  primaryButton: { minWidth: 220, borderRadius: 17, backgroundColor: '#6D38FF', paddingHorizontal: 22, paddingVertical: 15, alignItems: 'center' },
  primaryButtonText: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' },
  secondaryButton: { minWidth: 220, paddingHorizontal: 18, paddingVertical: 14, alignItems: 'center' },
  secondaryButtonText: { color: '#6D38FF', fontSize: 13, fontWeight: '700' },
});
