import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { analyzeAcousticSamples } from '../../../shared/experimentalWellness.js';
export default function VocalAssessment({ disabled, onResult }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const mounted = useRef(true), cancel = useRef(null), current = useRef(onResult); current.current = onResult;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; cancel.current?.(); }; }, []);
  useEffect(() => { if (disabled) cancel.current?.(); }, [disabled]);
  const record = async () => {
    if (disabled || busy) return;
    setBusy(true); setError(''); let stream, context, recorder, timer, cancelled = false;
    const stop = () => { cancelled = true; clearTimeout(timer); if (recorder?.state === 'recording') recorder.stop(); stream?.getTracks().forEach(track => track.stop()); void context?.close().catch(() => {}); };
    cancel.current = stop;
    try {
      stream = await window.navigator.mediaDevices.getUserMedia({ audio: true });
      if (cancelled || !mounted.current) return;
      context = new (window.AudioContext || window.webkitAudioContext)(); recorder = new window.MediaRecorder(stream);
      const chunks = [];
      const blob = await new Promise((resolve, reject) => { recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); }; recorder.onerror = reject;
        recorder.onstop = () => resolve(new window.Blob(chunks, { type: recorder.mimeType })); recorder.start(); timer = setTimeout(() => recorder.stop(), 5000); });
      stream.getTracks().forEach(track => track.stop());
      if (cancelled || !mounted.current) return;
      const buffer = await context.decodeAudioData(await blob.arrayBuffer());
      const result = analyzeAcousticSamples(buffer.getChannelData(0), buffer.sampleRate);
      if (!cancelled && mounted.current) current.current(result);
    } catch (failure) { if (mounted.current && !cancelled) setError(failure?.message || 'Voice recording unavailable.'); }
    finally { stop(); cancel.current = null; if (mounted.current) setBusy(false); }
  };
  return <View><TouchableOpacity accessibilityRole="button" disabled={disabled || busy} onPress={record} style={{ padding: 12, borderWidth: 1, borderColor: '#99B6AA', borderRadius: 12, opacity: disabled ? 0.5 : 1 }}><Text>{busy ? 'Recording for 5 seconds…' : 'Add optional voice recording'}</Text></TouchableOpacity>{error ? <Text accessibilityRole="alert">{error}</Text> : null}</View>;
}
