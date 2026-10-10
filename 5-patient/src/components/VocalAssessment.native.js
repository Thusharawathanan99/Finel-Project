import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { WebView } from 'react-native-webview';
import { useAudioRecorder, RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync } from 'expo-audio';
import * as FileSystem from 'expo-file-system/legacy';
import { AUDIO_ANALYSIS_HTML } from '../generated/audioRuntime';
const SOURCE = { html: AUDIO_ANALYSIS_HTML };
export default function VocalAssessment({ disabled, onResult }) {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [ready, setReady] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const view = useRef(null), request = useRef(null), generation = useRef(0), alive = useRef(true), sleep = useRef(null), callback = useRef(onResult); callback.current = onResult;
  const cancel = () => { ++generation.current; if (sleep.current) { clearTimeout(sleep.current.timer); sleep.current.resolve(); sleep.current = null; } if (request.current) { clearTimeout(request.current.timer); request.current.reject(new Error('Recording cancelled.')); request.current = null; } void recorder.stop().catch(() => {}); };
  useEffect(() => { alive.current = true; return () => { alive.current = false; cancel(); }; }, []);
  useEffect(() => { if (disabled) cancel(); }, [disabled]);
  const record = async () => {
    if (disabled || busy || !ready) return;
    const id = ++generation.current; setBusy(true); setError(''); let uri;
    try {
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) throw new Error('Microphone permission is required for optional voice recording.');
      if (!alive.current || id !== generation.current) return;
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      if (!alive.current || id !== generation.current) return;
      recorder.record();
      await new Promise(resolve => { sleep.current = { resolve, timer: setTimeout(() => { sleep.current = null; resolve(); }, 5000) }; });
      await recorder.stop(); uri = recorder.uri;
      if (!alive.current || id !== generation.current || !uri) return;
      const info = await FileSystem.getInfoAsync(uri);
      if (!info.exists || info.size > 2800000) throw new Error('Recording is too large. Record again.');
      const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
      if (!alive.current || id !== generation.current) return;
      const result = await new Promise((resolve, reject) => { request.current = { id, resolve, reject, timer: setTimeout(() => { request.current = null; reject(new Error('Voice analysis timed out.')); }, 20000) };
        view.current.injectJavaScript('window.analyzeCareAudio(' + JSON.stringify({ id, base64 }) + ');true;'); });
      if (alive.current && id === generation.current) callback.current(result);
    } catch (failure) { if (alive.current && id === generation.current) setError(failure?.message || 'Voice analysis unavailable.'); }
    finally { if (uri || recorder.uri) await FileSystem.deleteAsync(uri || recorder.uri, { idempotent: true }).catch(() => {}); await setAudioModeAsync({ allowsRecording: false }).catch(() => {}); if (alive.current) setBusy(false); }
  };
  const receive = event => { try { const message = JSON.parse(event.nativeEvent.data); if (message.ready) { setReady(true); return; }
    const pending = request.current; if (!pending || message.id !== pending.id) return; clearTimeout(pending.timer); request.current = null;
    if (message.error) pending.reject(new Error(message.error)); else pending.resolve(message.result);
  } catch {} };
  return <View><TouchableOpacity accessibilityRole="button" disabled={disabled || busy || !ready} onPress={record} style={{ padding: 12, borderWidth: 1, borderColor: '#99B6AA', borderRadius: 12, opacity: disabled ? 0.5 : 1 }}><Text>{busy ? 'Recording and analyzing voice…' : 'Add optional 5-second voice recording'}</Text></TouchableOpacity>{error ? <Text accessibilityRole="alert">{error}</Text> : null}
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" pointerEvents="none" style={{ position: 'absolute', width: 1, height: 1, opacity: 0.01 }}><WebView ref={view} source={SOURCE} javaScriptEnabled onMessage={receive} originWhitelist={['*']} onShouldStartLoadWithRequest={value => value.url.startsWith('about:blank') || value.url.startsWith('data:text/html')} style={{ width: 1, height: 1 }} /></View>
  </View>;
}
