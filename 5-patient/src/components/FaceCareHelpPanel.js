import React, { useState, useRef, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, ActivityIndicator, Linking, Share } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { uuid } from 'expo-modules-core';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '../firebase/config';
import { apiFetch, getResidentId } from '../apiHelper';
import { SRI_LANKA_AMBULANCE_TEL, getFaceCareCopy } from '../../../shared/faceCare.js';
import { PATIENT_SYMPTOMS, PATIENT_SYMPTOM_NOTE_MAX_LENGTH, getPatientSymptomsCopy,
  evaluatePatientSymptoms, buildPatientSymptomReport, buildPatientSymptomHelpMessage } from '../../../shared/patientSymptoms.js';

// Only the person's explicit button press can create an urgent request. Camera
// frames, expression scores and model quality never enter this component.
export default function FaceCareHelpPanel({ language, navigation, onChange }) {
  const copy = getFaceCareCopy(language);
  const symptomCopy = getPatientSymptomsCopy(language);
  const [symptoms, setSymptoms] = useState([]);
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  const [receipt, setReceipt] = useState(null);
  const [error, setError] = useState(null);
  const [expanded, setExpanded] = useState(false);
  const mountedRef = useRef(true);
  const busyRef = useRef(false);
  const generationRef = useRef(0);
  const controllerRef = useRef(null);
  const attemptRef = useRef(null);
  const accountRef = useRef(auth.currentUser?.uid || null);
  const reportedAtRef = useRef(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const evaluation = evaluatePatientSymptoms(symptoms, language);

  // A separate patient report: never receives a face score, camera frame or
  // medical severity. Local guidance does not wait for this callback or API.
  useEffect(() => {
    onChangeRef.current?.({ symptomKeys: [...symptoms], note, urgent: symptoms.length > 0,
      reportedAt: reportedAtRef.current, receipt: receipt ? { ...receipt } : null });
  }, [symptoms, note, receipt, sending, error]);

  const cancelPending = () => {
    generationRef.current += 1;
    controllerRef.current?.abort(); controllerRef.current = null;
    busyRef.current = false;
    if (mountedRef.current) { setSending(false); setError('failed'); }
    // Preserve this identity for a retry: cancellation cannot prove that a
    // request already accepted by the server was rolled back.
  };

  const resetSession = () => {
    generationRef.current += 1;
    controllerRef.current?.abort(); controllerRef.current = null;
    busyRef.current = false; attemptRef.current = null; reportedAtRef.current = null;
    if (mountedRef.current) { setSymptoms([]); setNote(''); setSending(false); setReceipt(null); setError(null); }
  };

  useEffect(() => {
    mountedRef.current = true;
    const unsubscribe = onAuthStateChanged(auth, user => {
      const uid = user?.uid || null;
      if (uid !== accountRef.current) { accountRef.current = uid; resetSession(); }
    });
    const unsubscribeBlur = navigation?.addListener?.('blur', resetSession);
    return () => {
      mountedRef.current = false; generationRef.current += 1;
      controllerRef.current?.abort(); busyRef.current = false; attemptRef.current = null;
      unsubscribe(); unsubscribeBlur?.();
    };
  }, [navigation]);

  const editSymptoms = key => {
    if (busyRef.current || receipt) return;
    reportedAtRef.current ||= new Date().toISOString();
    setSymptoms(current => current.includes(key) ? current.filter(item => item !== key) : [...current, key]);
    setError(null);
  };

  const sendUrgentHelp = async () => {
    if (busyRef.current || receipt) return;
    const uid = auth.currentUser?.uid;
    // Firebase's auth notification can arrive after currentUser has changed.
    // Never send another account's still-rendered symptom selection or note.
    if ((uid || null) !== accountRef.current) { accountRef.current = uid || null; resetSession(); return; }
    if (!uid) { setError('auth'); return; }
    const token = ++generationRef.current;
    const controller = new AbortController();
    controllerRef.current = controller; busyRef.current = true;
    setSending(true); setError(null);
    const current = () => mountedRef.current && token === generationRef.current && auth.currentUser?.uid === uid;
    const timeout = setTimeout(() => { if (current()) cancelPending(); }, 20000);
    try {
      const residentId = await getResidentId();
      if (!current()) return;
      if (!residentId) throw new Error('resident');
      reportedAtRef.current ||= new Date().toISOString();
      const message = buildPatientSymptomHelpMessage(symptoms, language, note);
      const signature = JSON.stringify({ uid, residentId, message });
      if (attemptRef.current?.signature !== signature) {
        attemptRef.current = { signature, body: { residentId, message, requestId: uuid.v4() } };
      }
      const response = await apiFetch('/sos-alerts', { method: 'POST', signal: controller.signal,
        body: JSON.stringify(attemptRef.current.body) });
      if (!current()) return;
      if (!response.ok) throw new Error(response.status === 401 ? 'auth' : 'failed');
      const confirmation = await response.json();
      if (!current()) return;
      if (confirmation?.saved !== true || !Number.isSafeInteger(confirmation.alertId) || confirmation.alertId <= 0) throw new Error('failed');
      setReceipt({ saved: true, alertId: confirmation.alertId, replayed: confirmation.replayed === true, isResolved: confirmation.isResolved === true });
    } catch (failure) {
      if (current()) setError(failure.message === 'auth' ? 'auth' : 'failed');
    } finally {
      clearTimeout(timeout);
      if (current()) { controllerRef.current = null; busyRef.current = false; setSending(false); }
    }
  };

  const callEmergency = async () => {
    const token = generationRef.current, uid = auth.currentUser?.uid;
    try { await Linking.openURL(SRI_LANKA_AMBULANCE_TEL); }
    catch { if (mountedRef.current && token === generationRef.current && uid === auth.currentUser?.uid) setError('call'); }
  };

  const shareReport = async () => {
    const token = generationRef.current, uid = auth.currentUser?.uid;
    if ((uid || null) !== accountRef.current) { accountRef.current = uid || null; resetSession(); return; }
    try {
      await Share.share({ message: buildPatientSymptomReport(symptoms, language, note, reportedAtRef.current, receipt) });
    } catch {
      if (mountedRef.current && token === generationRef.current && uid === auth.currentUser?.uid) setError('share');
    }
  };

  return <View style={styles.card}>
    <View style={styles.header}><View style={styles.icon}><MaterialCommunityIcons name="hand-heart-outline" size={26} color="#A64237" /></View><View style={styles.headerText}><Text style={styles.title}>{copy.title}</Text><Text style={styles.body}>{copy.description}</Text></View></View>
    <Text style={styles.note}>{symptomCopy.notDiagnosis}</Text>
    <View testID="patient-symptom-guidance" style={[styles.callout, evaluation.urgent && styles.urgentGuidance]} accessibilityRole={evaluation.urgent ? 'alert' : undefined}>
      <MaterialCommunityIcons name="phone-alert-outline" size={21} color="#9B4235" />
      <View style={{ flex: 1 }}>{evaluation.urgent && <Text style={styles.urgentTitle}>{symptomCopy.urgentTitle}</Text>}<Text style={styles.callHelp}>{evaluation.urgent ? evaluation.guidance : copy.callHelp}</Text></View>
    </View>
    <TouchableOpacity accessibilityRole="button" accessibilityLabel={copy.call1990} onPress={callEmergency} style={styles.callButton}><MaterialCommunityIcons name="phone-outline" color="#9B4235" size={21} /><Text style={styles.callText}>{copy.call1990}</Text></TouchableOpacity>
    <TouchableOpacity style={styles.expand} onPress={() => setExpanded(value => !value)} accessibilityRole="button" accessibilityState={{ expanded }}><Text style={[styles.field, { flex: 1 }]}>{copy.symptomHeading}</Text><MaterialCommunityIcons name={expanded ? 'chevron-up' : 'chevron-down'} size={23} color="#876D62" /></TouchableOpacity>
    {expanded && <><Text style={styles.body}>{copy.chooseSymptomsOptional}</Text>
    <View style={styles.symptoms}>{PATIENT_SYMPTOMS.map(({ key }) => <TouchableOpacity key={key} disabled={sending || Boolean(receipt)} onPress={() => editSymptoms(key)} accessibilityRole="checkbox" accessibilityState={{ checked: symptoms.includes(key), disabled: sending || Boolean(receipt) }} style={[styles.symptom, symptoms.includes(key) && styles.selected]}>
      <MaterialCommunityIcons name={symptoms.includes(key) ? 'checkbox-marked-circle' : 'checkbox-blank-circle-outline'} size={19} color={symptoms.includes(key) ? '#A64237' : '#938C86'} /><Text style={[styles.symptomText, symptoms.includes(key) && styles.selectedText]}>{symptomCopy.symptoms[key]}</Text>
    </TouchableOpacity>)}</View>
    <Text style={styles.field}>{copy.optionalNote}</Text>
    <TextInput value={note} onChangeText={value => { if (!busyRef.current && !receipt) { reportedAtRef.current ||= new Date().toISOString(); setNote(value); setError(null); } }} editable={!sending && !receipt} multiline maxLength={PATIENT_SYMPTOM_NOTE_MAX_LENGTH} accessibilityLabel={copy.optionalNote} placeholder={copy.notePlaceholder} placeholderTextColor="#91847E" style={styles.input} />
    </>}
    <Text style={styles.note}>{copy.privacy}</Text>
    {error && <View style={styles.error} accessibilityRole="alert"><Text style={styles.errorTitle}>{error === 'auth' ? copy.signInRequired : error === 'share' ? symptomCopy.shareFailed : copy.failedTitle}</Text><Text style={styles.errorText}>{error === 'call' ? copy.callFailed : error === 'share' ? symptomCopy.shareFailed : error === 'auth' ? copy.signInRequired : copy.failedMessage}</Text></View>}
    {receipt ? <View style={styles.saved} accessibilityRole="alert"><Text style={styles.savedTitle}>{receipt.isResolved ? copy.resolvedTitle : copy.savedTitle}</Text><Text style={styles.body}>{receipt.isResolved ? copy.resolvedMessage : copy.savedMessage}</Text>{receipt.replayed && <Text style={styles.note}>{symptomCopy.duplicate}</Text>}{receipt.isResolved && <Text style={styles.note}>{copy.alreadyResolved}</Text>}<TouchableOpacity style={styles.newRequest} onPress={resetSession}><Text style={styles.newRequestText}>{copy.newRequest}</Text></TouchableOpacity></View>
      : <TouchableOpacity style={[styles.send, sending && styles.disabled]} disabled={sending} accessibilityRole="button" onPress={sendUrgentHelp}>{sending ? <ActivityIndicator color="#FFF" /> : <MaterialCommunityIcons name="bell-ring-outline" color="#FFF" size={21} />}<Text style={styles.sendText}>{sending ? copy.sending : error === 'failed' ? copy.retry : copy.action}</Text></TouchableOpacity>}
    {sending && <TouchableOpacity onPress={cancelPending} accessibilityRole="button" style={styles.cancel}><Text style={styles.cancelText}>{copy.cancelPending}</Text></TouchableOpacity>}
    <View style={styles.reportActions}><TouchableOpacity onPress={shareReport} accessibilityRole="button" style={styles.reportAction}><MaterialCommunityIcons name="share-variant-outline" size={18} color="#624639" /><Text style={styles.reportActionText}>{symptomCopy.share}</Text></TouchableOpacity>
      {!sending && !receipt && <TouchableOpacity onPress={resetSession} accessibilityRole="button" style={styles.reportAction}><Text style={styles.reportActionText}>{symptomCopy.reset}</Text></TouchableOpacity>}</View>
  </View>;
}

const styles = StyleSheet.create({
  card: { backgroundColor: '#FFF9F4', borderRadius: 25, padding: 20, borderWidth: 1, borderColor: '#F0DCD0', gap: 12 },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 }, headerText: { flex: 1 },
  icon: { width: 46, height: 46, borderRadius: 15, backgroundColor: '#F9E5DA', justifyContent: 'center', alignItems: 'center' },
  title: { fontSize: 18, lineHeight: 29, fontWeight: '800', color: '#51362C' }, body: { fontSize: 12, lineHeight: 22, color: '#766158' },
  note: { fontSize: 11, lineHeight: 21, color: '#876D62' }, callout: { flexDirection: 'row', gap: 9, alignItems: 'flex-start', backgroundColor: '#FCEBE3', padding: 13, borderRadius: 14 },
  callHelp: { flex: 1, color: '#914335', fontSize: 12, lineHeight: 23, fontWeight: '700' },
  callButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, minHeight: 48, borderWidth: 1, borderColor: '#E9BBAB', borderRadius: 15 },
  callText: { color: '#9B4235', fontSize: 13, lineHeight: 23, fontWeight: '800', flexShrink: 1, textAlign: 'center' },
  field: { fontSize: 13, lineHeight: 23, fontWeight: '800', color: '#624639', marginTop: 3 }, symptoms: { gap: 8 },
  expand: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8 },
  symptom: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 47, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: '#FFFDFB', borderRadius: 13, borderWidth: 1, borderColor: '#EADDD4' },
  selected: { backgroundColor: '#FCE9DE', borderColor: '#D8977E' }, symptomText: { fontSize: 12, lineHeight: 23, color: '#735E54', flex: 1 }, selectedText: { color: '#963F32', fontWeight: '700' },
  input: { minHeight: 86, color: '#624639', fontSize: 12, lineHeight: 23, borderRadius: 15, borderWidth: 1, borderColor: '#EADDD4', padding: 13, backgroundColor: '#FFFDFB', textAlignVertical: 'top' },
  send: { minHeight: 54, borderRadius: 16, padding: 14, backgroundColor: '#A74737', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9 },
  sendText: { color: '#FFF', fontSize: 13, fontWeight: '800', lineHeight: 24, textAlign: 'center', flexShrink: 1 }, disabled: { opacity: .6 },
  error: { backgroundColor: '#FBE7DF', borderRadius: 14, padding: 13, gap: 5 }, errorTitle: { color: '#923C32', fontSize: 12, lineHeight: 23, fontWeight: '800' }, errorText: { color: '#923C32', fontSize: 12, lineHeight: 23 },
  saved: { backgroundColor: '#E6F3E9', padding: 15, borderRadius: 17, gap: 8 }, savedTitle: { fontSize: 14, lineHeight: 25, color: '#226B4F', fontWeight: '800' },
  newRequest: { minHeight: 44, paddingVertical: 10, alignItems: 'center' }, newRequestText: { fontSize: 12, lineHeight: 23, color: '#226B4F', fontWeight: '800' },
  cancel: { minHeight: 44, justifyContent: 'center', alignItems: 'center' }, cancelText: { color: '#936557', fontSize: 12, lineHeight: 23, fontWeight: '700' },
  urgentGuidance: { backgroundColor: '#FEE2E2', borderColor: '#FCA5A5', borderWidth: 1 }, urgentTitle: { color: '#991B1B', fontSize: 14, lineHeight: 24, fontWeight: '800', marginBottom: 5 },
  reportActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, reportAction: { minHeight: 44, maxWidth: '100%', flexShrink: 1, paddingHorizontal: 9, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 7 }, reportActionText: { fontSize: 12, lineHeight: 23, fontWeight: '700', color: '#624639', flexShrink: 1 },
});
