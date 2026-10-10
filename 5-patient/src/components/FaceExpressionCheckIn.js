import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useAudioPlayer } from 'expo-audio';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { createExpressionCheckInMonitor, getExpressionCheckInCopy } from '../../../shared/expressionCheckIn.js';

export default function FaceExpressionCheckIn({ frame, monitoring, language }) {
  const [enabled, setEnabled] = useState(false), [event, setEvent] = useState(null), [unavailable, setUnavailable] = useState(false);
  const player = useAudioPlayer(require('../../assets/expression-check-in.wav'));
  const monitor = useRef(null), generation = useRef(0), current = useRef({ monitoring, enabled });
  current.current = { monitoring, enabled };
  if (!monitor.current) monitor.current = createExpressionCheckInMonitor();
  const copy = getExpressionCheckInCopy(language);
  async function playSound(test = false) {
    const token = generation.current;
    try {
      await player.seekTo(0);
      if (token !== generation.current || !current.current.monitoring || (!test && !current.current.enabled)) return;
      player.play(); setUnavailable(false);
    } catch { if (token === generation.current) setUnavailable(true); }
  }
  useEffect(() => {
    if (!enabled || !monitoring) {
      generation.current += 1; monitor.current.reset();
      try { player.pause(); } catch {}
      setEvent(null); return;
    }
    const observation = monitor.current.update(frame);
    if (observation) { setEvent(observation); void playSound(); }
  }, [frame, enabled, monitoring]);
  useEffect(() => () => { generation.current += 1; monitor.current.reset(); }, []);
  return <View style={styles.card}>
    <View style={styles.heading}><MaterialCommunityIcons name="bell-outline" color="#A45523" size={22} /><Text style={styles.title}>{copy.title}</Text></View>
    <Text style={styles.notice}>{copy.notice}</Text>
    <View style={styles.buttons}>
      <TouchableOpacity onPress={() => setEnabled(value => !value)} accessibilityRole="switch" accessibilityState={{ checked: enabled }} style={[styles.button, enabled && styles.enabled]}>
        <Text style={[styles.label, enabled && styles.enabledLabel]}>{enabled ? copy.disable : copy.enable}</Text>
      </TouchableOpacity>
      <TouchableOpacity disabled={!monitoring} onPress={() => void playSound(true)} accessibilityRole="button" style={[styles.button, !monitoring && styles.disabled]}><Text style={styles.label}>{copy.test}</Text></TouchableOpacity>
    </View>
    {event && <View style={styles.prompt}><Text style={styles.title}>{copy.prompted}</Text><Text style={styles.notice}>{copy.explanation}</Text></View>}
    {unavailable && <Text accessibilityRole="alert" style={styles.notice}>{copy.unavailable}</Text>}
  </View>;
}
const styles = StyleSheet.create({
  card: { backgroundColor: '#FFFAF2', borderColor: '#EBDAC4', borderWidth: 1, padding: 18, borderRadius: 22, marginTop: 16 },
  heading: { flexDirection: 'row', alignItems: 'center', gap: 8 }, title: { color: '#6F401F', fontSize: 17, fontWeight: '800', flexShrink: 1 },
  notice: { color: '#755E49', lineHeight: 21, fontSize: 13, marginTop: 9 }, buttons: { flexDirection: 'row', flexWrap: 'wrap', gap: 9, marginTop: 14 },
  button: { minHeight: 44, paddingHorizontal: 14, paddingVertical: 11, backgroundColor: '#F4E6D3', borderRadius: 13, justifyContent: 'center' },
  enabled: { backgroundColor: '#85512B' }, label: { color: '#694122', fontWeight: '700', fontSize: 13 }, enabledLabel: { color: '#FFF' },
  disabled: { opacity: 0.45 }, prompt: { marginTop: 14, padding: 14, borderRadius: 14, backgroundColor: '#F6E8D2' },
});
