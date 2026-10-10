import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Share } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { createFacialObservationSession, getFacialObservationCopy, buildFacialObservationReport } from '../../../shared/facialObservations.js';

// Only the parent's fresh live frame is accepted. Photos, identities and
// calibration references are never stored outside this mounted session.
export default function FacialObservationPanel({ frame, language, active, ownerUid, onChange }) {
  const sessionRef = useRef(null);
  if (!sessionRef.current) sessionRef.current = createFacialObservationSession();
  const [snapshot, setSnapshot] = useState(() => sessionRef.current.reset());
  const [expanded, setExpanded] = useState(false);
  const [exportError, setExportError] = useState(false);
  const ownerRef = useRef(ownerUid);
  const mountedRef = useRef(true);
  const generationRef = useRef(0);
  const changeRef = useRef(onChange);
  changeRef.current = onChange;
  const copy = getFacialObservationCopy(language);
  const publish = next => { setSnapshot(next); setExportError(false); changeRef.current?.(next); };

  useEffect(() => {
    generationRef.current += 1;
    if (ownerRef.current !== ownerUid) { ownerRef.current = ownerUid; sessionRef.current.reset(); }
    const ownerMatches = !frame?.ownerUid || frame.ownerUid === ownerUid;
    publish(active && ownerMatches ? sessionRef.current.update(frame) : sessionRef.current.reset());
  }, [frame, active, ownerUid]);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; generationRef.current += 1; sessionRef.current.reset(); }; }, []);

  const share = async () => {
    if (!mountedRef.current || !active || !frame || (frame.ownerUid && frame.ownerUid !== ownerUid)) return;
    const generation = generationRef.current;
    try { await Share.share({ title: copy.report, message: buildFacialObservationReport(snapshot, language) }); }
    catch { if (mountedRef.current && generation === generationRef.current) setExportError(true); }
  };
  const changed = snapshot.state === 'repeated-change';
  const canCalibrate = Boolean(active && frame && (!frame.ownerUid || frame.ownerUid === ownerUid) && frame.sampledAnalysis !== true && frame.faces?.[0]?.evidenceMode !== 'single-frame' && snapshot.state !== 'unavailable');
  const reasons = snapshot.qualityReasons.filter(reason => copy.reasons[reason]);
  return <View style={styles.card} testID="facial-observation-panel">
    <TouchableOpacity style={styles.heading} onPress={() => setExpanded(value => !value)} accessibilityRole="button" accessibilityState={{ expanded }}>
      <View style={styles.icon}><MaterialCommunityIcons name="vector-polyline" size={23} color="#74D7C8" /></View>
      <View style={{ flex: 1 }}><Text style={styles.title}>{copy.title}</Text><Text style={[styles.state, changed && styles.warning]}>{copy.states[snapshot.state]}</Text></View>
      <MaterialCommunityIcons name={expanded ? 'chevron-up' : 'chevron-down'} size={22} color="#9AB8BE" />
    </TouchableOpacity>
    {changed && <Text style={styles.warning}>{copy.checkInSuggested}</Text>}
    {reasons.length > 0 && <Text style={styles.body}>{reasons.map(reason => copy.reasons[reason]).join(' · ')}</Text>}
    <Text style={styles.small}>{snapshot.temporalContinuity === 'sparse' ? copy.sparseNotice : copy.sampledNotice}</Text>
    {expanded && <>
      <View style={styles.metrics}>{Object.keys(copy.metrics).map(key => {
        const value = snapshot.metrics?.[key];
        return <View key={key} style={styles.metric}><Text style={styles.metricLabel}>{copy.metrics[key]}</Text><Text style={styles.value}>{typeof value === 'number' && Number.isFinite(value) ? value.toFixed(3) + ' ' + (key === 'eyeLineRollDegrees' ? copy.degreesUnit : copy.ratioUnit) : '—'}</Text></View>;
      })}</View>
      <Text style={styles.body}>{copy.baselineStatuses[snapshot.baseline.status]} · {copy.baselineProgress}: {snapshot.baseline.sampleCount}</Text>
      {snapshot.baseline.reason && <Text style={styles.warning}>{snapshot.baseline.reason === 'tracking-reset' ? copy.baselineResetReason : copy.baselineUnstable}</Text>}
      <Text style={styles.small}>{copy.baselineConsent}</Text>
      <View style={styles.actions}>
        <TouchableOpacity accessibilityRole="button" disabled={!canCalibrate || snapshot.baseline.status === 'collecting'} style={[styles.button, (!canCalibrate || snapshot.baseline.status === 'collecting') && styles.disabled]} onPress={() => { if (canCalibrate) publish(sessionRef.current.startBaseline({ consent: true })); }}><Text style={styles.buttonText}>{copy.baselineStart}</Text></TouchableOpacity>
        <TouchableOpacity accessibilityRole="button" style={styles.button} onPress={() => publish(sessionRef.current.resetBaseline())}><Text style={styles.buttonText}>{copy.baselineReset}</Text></TouchableOpacity>
      </View>
      <Text style={styles.body}>{copy.timeline}</Text>
      {snapshot.history.slice(-5).reverse().map(entry => <View key={entry.capturedAt} style={styles.timeline}><View style={styles.dot} /><View style={{ flex: 1 }}><Text style={styles.body}>{copy.states[entry.state]}</Text><Text style={styles.small}>{new Date(entry.capturedAt).toISOString()}</Text></View></View>)}
      <Text style={styles.small}>{copy.notice}</Text><Text style={styles.small}>{copy.notHealth}</Text><Text style={styles.small}>{copy.privacy}</Text>
      <View style={styles.actions}><TouchableOpacity accessibilityRole="button" style={styles.button} onPress={share}><MaterialCommunityIcons name="share-variant-outline" size={18} color="#B2E6DB" /><Text style={styles.buttonText}>{copy.share}</Text></TouchableOpacity><TouchableOpacity accessibilityRole="button" style={styles.button} onPress={() => publish(sessionRef.current.reset())}><Text style={styles.buttonText}>{copy.clearSession}</Text></TouchableOpacity></View>
      {exportError && <Text style={styles.warning} accessibilityRole="alert">{copy.downloadFailed}</Text>}
    </>}
  </View>;
}
const styles = StyleSheet.create({
  card: { backgroundColor: '#122B36', borderRadius: 24, borderWidth: 1, borderColor: '#294955', padding: 18, gap: 12 },
  heading: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 48 }, icon: { width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: '#203F48' },
  title: { color: '#F0FAF8', fontSize: 16, lineHeight: 27, fontWeight: '800' }, state: { color: '#A4DBC8', fontSize: 12, lineHeight: 22 },
  body: { color: '#C1D5D9', fontSize: 12, lineHeight: 23 }, small: { color: '#9BB7C0', fontSize: 11, lineHeight: 21 }, warning: { color: '#F1CE91', fontSize: 12, lineHeight: 23 },
  metrics: { gap: 1, borderRadius: 14, overflow: 'hidden' }, metric: { padding: 12, backgroundColor: '#1B3541', gap: 3 }, metricLabel: { color: '#A9C2CB', fontSize: 11, lineHeight: 21 }, value: { color: '#E7FAF4', fontSize: 15, lineHeight: 24, fontWeight: '700' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, button: { flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', minHeight: 46, padding: 12, backgroundColor: '#20414B', borderRadius: 13, borderWidth: 1, borderColor: '#3D6269', flexGrow: 1 }, buttonText: { color: '#B2E6DB', fontSize: 12, lineHeight: 23, fontWeight: '700', textAlign: 'center', flexShrink: 1 }, disabled: { opacity: .4 },
  timeline: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', paddingVertical: 4 }, dot: { width: 7, height: 7, marginTop: 8, borderRadius: 4, backgroundColor: '#74D7C8' },
});
