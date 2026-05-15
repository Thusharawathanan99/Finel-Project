import React, { useState, useRef, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Animated } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { apiFetch, getResidentId } from '../apiHelper';

// ─── On-device Gemini AI (no server round-trip for image analysis) ───
const GEMINI_API_KEY = 'AIzaSyAGm9zZm2D7fwXGkr9ktXW8EU1AVmb2MLg';
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

const CAPTURE_INTERVAL_MS = 8000;
const ALERT_COOLDOWN_MS = 120000;

const ANALYSIS_PROMPT = `You are an AI assistant for a health monitoring system. 
Analyze this patient's facial expression and provide a wellness assessment. Look for signs of distress, fatigue, pain, or well-being.
Return ONLY a raw JSON object (no markdown, no backticks) with the following structure:
{
  "emotionLabel": "string (e.g., Stable, Fatigued, Distressed, Content, Anxious)",
  "stateScore": number (0-100, where 100 is perfectly well/positive and 0 is severe distress/pain),
  "category": "string (either 'positive', 'neutral', 'negative', or 'side-effect')",
  "note": "A short clinical observation sentence (e.g., 'Patient appears rested and calm.')"
}`;

const LiveEmotionScreen = ({ navigation }) => {
  const [permission, requestPermission] = useCameraPermissions();
  const [isLive, setIsLive] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [currentResult, setCurrentResult] = useState(null);
  const [recentReadings, setRecentReadings] = useState([]);
  const [alertSentAt, setAlertSentAt] = useState(0);
  const [alertStatus, setAlertStatus] = useState(null);
  const [sessionCount, setSessionCount] = useState(0);
  const [processingTime, setProcessingTime] = useState(null);
  const [lastError, setLastError] = useState(null);
  
  const [cameraReady, setCameraReady] = useState(false);
  
  const cameraRef = useRef(null);
  const intervalRef = useRef(null);
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const isLiveRef = useRef(false);
  const isAnalyzingRef = useRef(false);

  // Pulse animation for LIVE indicator
  useEffect(() => {
    if (isLive) {
      const pulse = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 0.3, duration: 800, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
        ])
      );
      pulse.start();
      return () => pulse.stop();
    }
  }, [isLive]);

  useEffect(() => { isLiveRef.current = isLive; }, [isLive]);
  useEffect(() => { return () => { if (intervalRef.current) clearInterval(intervalRef.current); }; }, []);

  const getSeverityColor = (score) => {
    if (score <= 30) return '#DC2626';
    if (score <= 50) return '#F59E0B';
    if (score <= 70) return '#3B82F6';
    return '#10B981';
  };

  const getSeverityLabel = (score) => {
    if (score <= 30) return 'Critical';
    if (score <= 50) return 'Warning';
    if (score <= 70) return 'Fair';
    return 'Good';
  };

  const getSeverityIcon = (score) => {
    if (score <= 30) return 'alert-octagon';
    if (score <= 50) return 'alert-circle';
    if (score <= 70) return 'information';
    return 'check-circle';
  };

  // ─── CORE: On-device Gemini analysis (no server for image) ───
  const analyzeOnDevice = useCallback(async (base64Image) => {
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

    const parts = [
      { text: ANALYSIS_PROMPT },
      { inlineData: { mimeType: 'image/jpeg', data: base64Image } }
    ];

    // Add timeout to prevent hanging forever
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('AI analysis timed out (30s). Please try again.')), 30000)
    );

    const result = await Promise.race([
      model.generateContent(parts),
      timeoutPromise
    ]);
    const text = result.response.text();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    
    if (!jsonMatch) throw new Error('AI returned an invalid response. Please try again.');
    return JSON.parse(jsonMatch[0]);
  }, []);

  const analyzeAndAlert = useCallback(async () => {
    // Guard: need camera ref + camera must be ready + not already analyzing
    if (!cameraRef.current || !cameraReady) return;
    if (isAnalyzingRef.current) return; // Prevent overlapping calls
    
    try {
      setIsAnalyzing(true);
      isAnalyzingRef.current = true;
      setLastError(null);
      const startTime = Date.now();
      
      // 1. Capture photo
      const photo = await cameraRef.current.takePictureAsync({ 
        base64: true, 
        quality: 0.2,
      });

      if (!photo.base64) {
        console.warn('[LiveEmotion] Camera returned no base64 data');
        return;
      }

      // 2. Analyze directly on phone via Gemini API (no server round-trip for image!)
      const data = await analyzeOnDevice(photo.base64);
      
      const elapsed = Date.now() - startTime;
      setProcessingTime(elapsed);
      console.log(`[LiveEmotion] ✅ Analysis in ${elapsed}ms: ${data.emotionLabel} (${data.stateScore}/100)`);

      setCurrentResult(data);
      setSessionCount(prev => prev + 1);

      // Add to recent readings (keep last 5)
      setRecentReadings(prev => {
        const next = [{ ...data, timestamp: Date.now() }, ...prev];
        return next.slice(0, 5);
      });

      // 3. Only send lightweight results to backend (no image!) if distress detected
      if (data.stateScore <= 50) {
        const now = Date.now();
        if (now - alertSentAt < ALERT_COOLDOWN_MS) {
          setAlertStatus('cooldown');
        } else {
          const residentId = await getResidentId();
          // Only send the small JSON result — NOT the image
          const alertRes = await apiFetch('/emotions/wellness-alert', {
            method: 'POST',
            body: JSON.stringify({
              residentId,
              emotionLabel: data.emotionLabel,
              stateScore: data.stateScore,
              category: data.category,
              note: data.note
            })
          });

          if (alertRes.ok) {
            const alertData = await alertRes.json();
            if (alertData.cooldown) {
              setAlertStatus('cooldown');
            } else {
              setAlertSentAt(now);
              setAlertStatus('sent');
              setTimeout(() => setAlertStatus(null), 5000);
            }
          }
        }
      } else {
        // Also save stable readings to emotional_states history
        try {
          const residentId = await getResidentId();
          await apiFetch('/emotions', {
            method: 'POST',
            body: JSON.stringify({
              residentId,
              stateScore: data.stateScore,
              emotionLabel: data.emotionLabel,
              category: data.category,
              note: data.note
            })
          });
        } catch (e) {
          // Non-critical — just log
          console.warn('[LiveEmotion] Could not save history:', e.message);
        }
        setAlertStatus('stable');
        setTimeout(() => setAlertStatus(null), 3000);
      }

    } catch (error) {
      console.error('Live analysis error:', error);
      setLastError(error.message || 'Analysis failed. Check your internet connection.');
    } finally {
      setIsAnalyzing(false);
      isAnalyzingRef.current = false;
    }
  }, [alertSentAt, analyzeOnDevice, cameraReady]);

  const startLiveMode = () => {
    setIsLive(true);
    setRecentReadings([]);
    setSessionCount(0);
    setCurrentResult(null);
    setAlertStatus(null);
    setProcessingTime(null);
    
    setTimeout(() => analyzeAndAlert(), 500);
    intervalRef.current = setInterval(() => {
      analyzeAndAlert();
    }, CAPTURE_INTERVAL_MS);
  };

  const stopLiveMode = () => {
    setIsLive(false);
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  };

  if (!permission) return <View style={styles.container} />;

  if (!permission.granted) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.permissionContainer}>
          <MaterialCommunityIcons name="camera-off" size={64} color="#CBD5E1" />
          <Text style={styles.permissionText}>Camera permission is required for live wellness monitoring</Text>
          <TouchableOpacity style={styles.btnPrimary} onPress={requestPermission}>
            <Text style={styles.btnPrimaryText}>Grant Permission</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.btnSecondary} onPress={() => navigation.goBack()}>
            <Text style={styles.btnSecondaryText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => { stopLiveMode(); navigation.goBack(); }} style={styles.backBtn}>
          <MaterialCommunityIcons name="arrow-left" size={24} color="#F8FAFC" />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>Live Wellness</Text>
          {isLive && (
            <View style={styles.liveIndicator}>
              <Animated.View style={[styles.liveDot, { opacity: pulseAnim }]} />
              <Text style={styles.liveText}>LIVE</Text>
            </View>
          )}
        </View>
        {processingTime && isLive ? (
          <View style={styles.timeBadge}>
            <Text style={styles.timeText}>{(processingTime / 1000).toFixed(1)}s</Text>
          </View>
        ) : <View style={{ width: 40 }} />}
      </View>

      {/* Camera */}
      <View style={styles.cameraContainer}>
        <CameraView style={styles.camera} facing="front" ref={cameraRef} onCameraReady={() => setCameraReady(true)} />

        {isAnalyzing && (
          <View style={styles.analyzingOverlay}>
            <ActivityIndicator size="large" color="#FFFFFF" />
            <Text style={styles.analyzingText}>Analyzing on device...</Text>
            <Text style={{ color: '#94A3B8', fontSize: 11, marginTop: 4 }}>This may take 5-15 seconds</Text>
          </View>
        )}

        {/* Error Display */}
        {lastError && !isAnalyzing && (
          <View style={[styles.analyzingOverlay, { backgroundColor: 'rgba(220,38,38,0.85)' }]}>
            <MaterialCommunityIcons name="alert-circle" size={36} color="#FFF" />
            <Text style={{ color: '#FFF', fontSize: 14, fontWeight: '700', marginTop: 8, textAlign: 'center', paddingHorizontal: 20 }}>{lastError}</Text>
            <TouchableOpacity onPress={() => { setLastError(null); analyzeAndAlert(); }} style={{ marginTop: 12, backgroundColor: '#FFF', paddingHorizontal: 20, paddingVertical: 10, borderRadius: 12 }}>
              <Text style={{ color: '#DC2626', fontWeight: '800', fontSize: 13 }}>Retry Now</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Live Score Overlay */}
        {currentResult && isLive && (
          <View style={styles.scoreOverlay}>
            <View style={[styles.scoreBadge, { backgroundColor: getSeverityColor(currentResult.stateScore) }]}>
              <Text style={styles.scoreValue}>{currentResult.stateScore}</Text>
              <Text style={styles.scoreLabel}>/100</Text>
            </View>
            <View style={[styles.emotionChip, { backgroundColor: getSeverityColor(currentResult.stateScore) + '30' }]}>
              <Text style={[styles.emotionText, { color: getSeverityColor(currentResult.stateScore) }]}>
                {currentResult.emotionLabel}
              </Text>
            </View>
          </View>
        )}

        {/* Alert Toast */}
        {alertStatus === 'sent' && (
          <View style={styles.alertToast}>
            <MaterialCommunityIcons name="alert-circle-check" size={20} color="#FFF" />
            <Text style={styles.alertToastText}>⚠️ Alert sent to caretaker!</Text>
          </View>
        )}
        {alertStatus === 'cooldown' && (
          <View style={[styles.alertToast, { backgroundColor: '#F59E0B' }]}>
            <MaterialCommunityIcons name="clock-outline" size={20} color="#FFF" />
            <Text style={styles.alertToastText}>Alert cooldown active</Text>
          </View>
        )}
        {alertStatus === 'stable' && (
          <View style={[styles.alertToast, { backgroundColor: '#10B981' }]}>
            <MaterialCommunityIcons name="check-circle" size={20} color="#FFF" />
            <Text style={styles.alertToastText}>Patient looks well ✓</Text>
          </View>
        )}
      </View>

      {/* Bottom Panel */}
      <View style={styles.bottomPanel}>
        
        {/* On-device badge */}
        <View style={styles.onDeviceBanner}>
          <MaterialCommunityIcons name="cellphone" size={16} color="#8B5CF6" />
          <Text style={styles.onDeviceText}>On-device AI • Images never leave your phone</Text>
        </View>

        {/* Recent Readings */}
        {recentReadings.length > 0 && (
          <View style={styles.readingsRow}>
            {recentReadings.map((r, i) => (
              <View key={i} style={[styles.readingDot, { backgroundColor: getSeverityColor(r.stateScore) }]}>
                <Text style={styles.readingDotText}>{r.stateScore}</Text>
              </View>
            ))}
            <Text style={styles.readingsLabel}>{sessionCount} scans</Text>
          </View>
        )}

        {/* Clinical Note */}
        {currentResult && (
          <View style={styles.noteCard}>
            <View style={styles.noteHeader}>
              <MaterialCommunityIcons 
                name={getSeverityIcon(currentResult.stateScore)} 
                size={20} 
                color={getSeverityColor(currentResult.stateScore)} 
              />
              <Text style={[styles.noteStatus, { color: getSeverityColor(currentResult.stateScore) }]}>
                {getSeverityLabel(currentResult.stateScore)} — {currentResult.emotionLabel}
              </Text>
            </View>
            <Text style={styles.noteText}>{currentResult.note}</Text>
          </View>
        )}

        {/* Controls */}
        <View style={styles.controls}>
          {!isLive ? (
            <View style={{ gap: 10, width: '100%' }}>
              <TouchableOpacity style={styles.startBtn} onPress={startLiveMode}>
                <MaterialCommunityIcons name="camera-front-variant" size={24} color="#FFF" />
                <Text style={styles.startBtnText}>Start Live Monitoring</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={[styles.startBtn, { backgroundColor: '#6366F1' }]} 
                onPress={() => { if (!isAnalyzing) analyzeAndAlert(); }}
                disabled={isAnalyzing}
              >
                <MaterialCommunityIcons name="camera" size={24} color="#FFF" />
                <Text style={styles.startBtnText}>{isAnalyzing ? 'Analyzing...' : 'Single Capture & Analyze'}</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity style={styles.stopBtn} onPress={stopLiveMode}>
              <MaterialCommunityIcons name="stop-circle" size={24} color="#FFF" />
              <Text style={styles.stopBtnText}>Stop Monitoring</Text>
            </TouchableOpacity>
          )}
        </View>

        {!isLive && !currentResult && (
          <Text style={styles.helpText}>
            AI runs directly on your phone via Gemini.{'\n'}
            Try "Single Capture" first to test.{'\n'}
            Only analysis results are sent — never the images.
          </Text>
        )}
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0F172A' },
  
  header: { 
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', 
    paddingHorizontal: 16, paddingVertical: 12, backgroundColor: '#1E293B'
  },
  backBtn: { padding: 8 },
  headerCenter: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  headerTitle: { fontSize: 17, fontWeight: '700', color: '#F8FAFC' },
  liveIndicator: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(220,38,38,0.2)', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#DC2626', marginRight: 6 },
  liveText: { color: '#DC2626', fontSize: 12, fontWeight: '800', letterSpacing: 1 },
  timeBadge: { backgroundColor: '#334155', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  timeText: { color: '#94A3B8', fontSize: 12, fontWeight: '700' },
  
  permissionContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
  permissionText: { fontSize: 16, textAlign: 'center', color: '#94A3B8', marginVertical: 24, lineHeight: 24 },
  
  cameraContainer: { flex: 1, position: 'relative' },
  camera: { flex: 1 },
  
  analyzingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center', alignItems: 'center',
  },
  analyzingText: { color: '#FFF', fontSize: 14, fontWeight: '600', marginTop: 12 },
  
  scoreOverlay: { position: 'absolute', top: 16, right: 16, alignItems: 'center' },
  scoreBadge: {
    width: 64, height: 64, borderRadius: 32, justifyContent: 'center', alignItems: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 8, elevation: 8,
  },
  scoreValue: { color: '#FFF', fontSize: 22, fontWeight: '900' },
  scoreLabel: { color: 'rgba(255,255,255,0.7)', fontSize: 10, fontWeight: '600', marginTop: -4 },
  emotionChip: { 
    marginTop: 6, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10,
  },
  emotionText: { fontSize: 12, fontWeight: '800' },

  alertToast: {
    position: 'absolute', top: 16, left: 16, right: 90,
    backgroundColor: '#DC2626', flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12, gap: 8,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 8,
  },
  alertToastText: { color: '#FFF', fontSize: 13, fontWeight: '700', flex: 1 },

  bottomPanel: {
    backgroundColor: '#1E293B', paddingHorizontal: 20, paddingVertical: 16, paddingBottom: 24,
    borderTopLeftRadius: 24, borderTopRightRadius: 24, marginTop: -20,
  },

  onDeviceBanner: { 
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, 
    marginBottom: 12, backgroundColor: '#8B5CF620', paddingVertical: 6, borderRadius: 10 
  },
  onDeviceText: { color: '#A78BFA', fontSize: 11, fontWeight: '600' },

  readingsRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 12, gap: 8 },
  readingDot: { width: 36, height: 36, borderRadius: 18, justifyContent: 'center', alignItems: 'center' },
  readingDotText: { color: '#FFF', fontSize: 11, fontWeight: '800' },
  readingsLabel: { color: '#64748B', fontSize: 12, fontWeight: '600', marginLeft: 'auto' },

  noteCard: { backgroundColor: '#334155', borderRadius: 16, padding: 14, marginBottom: 16 },
  noteHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  noteStatus: { fontSize: 14, fontWeight: '700' },
  noteText: { color: '#CBD5E1', fontSize: 13, lineHeight: 20 },

  controls: { marginBottom: 8 },
  startBtn: {
    backgroundColor: '#8B5CF6', flexDirection: 'row', justifyContent: 'center', alignItems: 'center',
    paddingVertical: 16, borderRadius: 16, gap: 10,
    shadowColor: '#8B5CF6', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 6,
  },
  startBtnText: { color: '#FFF', fontSize: 17, fontWeight: '700' },
  stopBtn: {
    backgroundColor: '#DC2626', flexDirection: 'row', justifyContent: 'center', alignItems: 'center',
    paddingVertical: 16, borderRadius: 16, gap: 10,
    shadowColor: '#DC2626', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 6,
  },
  stopBtnText: { color: '#FFF', fontSize: 17, fontWeight: '700' },

  btnPrimary: {
    backgroundColor: '#8B5CF6', paddingVertical: 14, paddingHorizontal: 32, borderRadius: 12, marginBottom: 12,
  },
  btnPrimaryText: { color: '#FFF', fontSize: 16, fontWeight: '600' },
  btnSecondary: {
    backgroundColor: '#334155', paddingVertical: 14, paddingHorizontal: 32, borderRadius: 12,
  },
  btnSecondaryText: { color: '#94A3B8', fontSize: 16, fontWeight: '600' },
  
  helpText: { color: '#64748B', fontSize: 13, textAlign: 'center', lineHeight: 20, marginTop: 4 },
});

export default LiveEmotionScreen;
