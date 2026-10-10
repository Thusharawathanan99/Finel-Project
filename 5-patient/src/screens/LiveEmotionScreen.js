import React, { useState, useRef, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, ScrollView, Image, TextInput, Share, AppState, Platform, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system/legacy';
import { onAuthStateChanged } from 'firebase/auth';
import { apiFetch, getResidentId } from '../apiHelper';
import { auth } from '../firebase/config';
import { getMobileFaceCopy, containedFaceBox, livePreviewFaceBox, livePreviewPoint } from '../faceUi';
import { FACE_LANGUAGES, validateFaceReport, buildFaceReportText } from '../faceReport';
import { createLiveFaceTracker, getExpressionDisplay, getLiveExpressionSummary, expressionEmoji, LIVE_EXPRESSIONS, buildLiveReportText } from '../../../shared/liveFace.js';
import { getLiveMobileCopy } from '../liveMobileCopy';
import { createLiveFrameLoop, createCloudFrameSampler, captureLiveCameraImage, isLiveFrameFresh, getLiveFramePresentation } from '../liveFaceSession';
import LiveFaceBridge from '../components/LiveFaceBridge';
import FaceCareHelpPanel from '../components/FaceCareHelpPanel';
import FaceExpressionCheckIn from '../components/FaceExpressionCheckIn';
import EmotionCheckInPicker from '../components/EmotionCheckInPicker';
import { getEmotionCheckInCopy, getEmotionCheckInState, buildEmotionCheckInReport } from '../../../shared/emotionCheckInCatalog.js';
import { summarizeLiveFaceQuality, getLiveFaceQualityCopy } from '../../../shared/liveFaceQuality.js';
import { getFaceProviderStatusCopy, validateFaceProviderStatus } from '../../../shared/faceProviderStatus.js';
import appConfig from '../../app.json';
import FacialObservationPanel from '../components/FacialObservationPanel';
import FaceMonitoringGuide from '../components/FaceMonitoringGuide';
import VocalToneModal from '../components/VocalToneModal';
import { buildFacialObservationReport } from '../../../shared/facialObservations.js';
import { buildPatientSymptomReport } from '../../../shared/patientSymptoms.js';
import { getFaceGuideCopy, getAssistanceWorkflow } from '../../../shared/faceGuide.js';

const MAX_IMAGE_DIMENSION = 1600;
const MAX_SOURCE_BYTES = 16 * 1024 * 1024;
const MAX_ENCODED_LENGTH = 8 * 1024 * 1024;

// The front preview is mirrored by Expo; mirror={false} applies to captured
// photos, not its live preview. Exact-photo thumbnails remain unmirrored.
const FRONT_PREVIEW_TRANSFORM = Object.freeze({ mirrored: true });

const LiveEmotionScreen = ({ navigation }) => {
  const [permission, requestPermission] = useCameraPermissions();
  const [language, setLanguage] = useState('en');
  const [photo, setPhoto] = useState(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [busy, setBusy] = useState(null);
  const [errorCode, setErrorCode] = useState(null);
  const [report, setReport] = useState(null);
  const [frame, setFrame] = useState({ width: 0, height: 0 });
  const [selfOpen, setSelfOpen] = useState(false);
  const [feeling, setFeeling] = useState(null);
  const [scoreText, setScoreText] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [movementSnapshot, setMovementSnapshot] = useState(null);
  const [symptomSnapshot, setSymptomSnapshot] = useState(null);
  const movementSnapshotRef = useRef(null);
  const symptomSnapshotRef = useRef(null);
  const handleMovementChange = useCallback(value => { if (mountedRef.current && accountRef.current === (auth.currentUser?.uid || null)) { movementSnapshotRef.current = value; setMovementSnapshot(value); } }, []);
  const handleSymptomChange = useCallback(value => { if (mountedRef.current && accountRef.current === (auth.currentUser?.uid || null)) { symptomSnapshotRef.current = value; setSymptomSnapshot(value); } }, []);
  const [saved, setSaved] = useState(null);

  const cameraRef = useRef(null);
  const mountedRef = useRef(true);
  const workIdRef = useRef(0);
  const workBusyRef = useRef(false);
  const controllerRef = useRef(null);
  const photoRef = useRef(photo);
  const saveIdRef = useRef(0);
  const savingRef = useRef(false);
  const saveControllerRef = useRef(null);
  const observationRef = useRef(null);
  const accountRef = useRef(auth.currentUser?.uid || null);
  const copy = getMobileFaceCopy(language);
  const [modelReady, setModelReady] = useState(false);
  const [localFrame, setLocalFrame] = useState(null);
  const [localStatus, setLocalStatus] = useState('loading');
  const [cloudOn, setCloudOn] = useState(false);
  const [cloudResult, setCloudResult] = useState(null);
  const [cloudError, setCloudError] = useState(null);
  const [paused, setPaused] = useState(false);
  const [bridgeKey, setBridgeKey] = useState(0);
  const [landmarksVisible, setLandmarksVisible] = useState(true);
  const [photoLocalFrame, setPhotoLocalFrame] = useState(null);
  const [photoLocalStatus, setPhotoLocalStatus] = useState(null);
  const [heartbeatAt, setHeartbeatAt] = useState(Date.now);
  const [modelBackend, setModelBackend] = useState(null);
  const [cloudStatus, setCloudStatus] = useState({ configurationState: 'checking' });
  const [detectorMode, setDetectorMode] = useState('auto');
  const [vocalModalOpen, setVocalModalOpen] = useState(false);
  const bridgeRef = useRef(null);
  const loopRef = useRef(null);
  const cloudSamplerRef = useRef(null);
  const trackerRef = useRef(null);
  const localFrameRef = useRef(null);
  const cameraCaptureRef = useRef(null);
  const photoLocalRef = useRef(null);
  const photoAnalysisIdRef = useRef(0);
  const activeCameraRef = useRef(cameraOpen && !photo);
  const statusControllerRef = useRef(null);
  const statusRequestIdRef = useRef(0);
  const detectorModeRef = useRef(detectorMode);
  const modelBackendRef = useRef(modelBackend);
  detectorModeRef.current = detectorMode;
  modelBackendRef.current = modelBackend;
  activeCameraRef.current = cameraOpen && !photo;
  const liveCopy = getLiveMobileCopy(language);

  const stopLive = useCallback((clear = true) => {
    movementSnapshotRef.current = null; setMovementSnapshot(null);
    loopRef.current?.stop();
    cloudSamplerRef.current?.disable();
    trackerRef.current?.reset();
    setCloudOn(false);
    if (clear) {
      localFrameRef.current = null;
      setLocalFrame(null);
      setCloudResult(null);
      setCloudError(null);
    }
  }, []);

  const discardPhoto = useCallback(() => {
    stopLive();
    statusRequestIdRef.current += 1;
    statusControllerRef.current?.abort();
    statusControllerRef.current = null;
    photoAnalysisIdRef.current += 1;
    photoLocalRef.current = null; setPhotoLocalFrame(null); setPhotoLocalStatus(null);
    setModelReady(false);
    setModelBackend(null);
    setLocalStatus('loading');
    setPaused(false);
    workIdRef.current += 1;
    controllerRef.current?.abort();
    controllerRef.current = null;
    workBusyRef.current = false;
    photoRef.current = null;
    setPhoto(null);
    setReport(null);
    setBusy(null);
    setCameraReady(false);
    setCameraOpen(false);
    setErrorCode(null);
  }, [stopLive]);

  const cancelSession = useCallback(() => {
    movementSnapshotRef.current = null; symptomSnapshotRef.current = null;
    setMovementSnapshot(null); setSymptomSnapshot(null);
    discardPhoto();
    saveIdRef.current += 1;
    saveControllerRef.current?.abort();
    savingRef.current = false;
    observationRef.current = null;
    setSaving(false);
    setSaved(null);
    setSelfOpen(false);
    setFeeling(null);
    setScoreText('');
    setNote('');
  }, [discardPhoto]);

  useEffect(() => {
    mountedRef.current = true;
    const unsubscribe = onAuthStateChanged(auth, user => {
      if (accountRef.current !== (user?.uid || null)) {
        accountRef.current = user?.uid || null;
        if (mountedRef.current) cancelSession();
      }
    });
    const unsubscribeBlur = navigation?.addListener?.('blur', cancelSession);
    return () => {
      mountedRef.current = false;
      workIdRef.current += 1;
      saveIdRef.current += 1;
      controllerRef.current?.abort();
      saveControllerRef.current?.abort();
      statusRequestIdRef.current += 1;
      statusControllerRef.current?.abort();
      photoRef.current = null;
      loopRef.current?.stop();
      cloudSamplerRef.current?.disable();
      unsubscribe();
      unsubscribeBlur?.();
    };
  }, [navigation, cancelSession]);

  const beginPhotoWork = () => {
    if (workBusyRef.current) return null;
    const user = auth.currentUser;
    if (!user) { setErrorCode('auth'); return null; }
    const id = ++workIdRef.current;
    workBusyRef.current = true;
    setErrorCode(null);
    return { id, uid: user.uid, current: () => mountedRef.current && id === workIdRef.current && auth.currentUser?.uid === user.uid };
  };

  const preparePhoto = async (asset, work) => {
    if (!asset?.uri || !Number.isFinite(asset.width) || !Number.isFinite(asset.height) || asset.width < 1 || asset.height < 1 ||
        asset.type === 'video' || asset.mimeType && !asset.mimeType.startsWith('image/')) throw new Error('image');
    if (asset.fileSize > MAX_SOURCE_BYTES || asset.width * asset.height > 40000000) throw new Error('large');
    // Decode and re-encode so orientation, preview and provider coordinates use the same JPEG pixels.
    const context = ImageManipulator.manipulate(asset.uri);
    if (Math.max(asset.width, asset.height) > MAX_IMAGE_DIMENSION) {
      context.resize(asset.width >= asset.height ? { width: MAX_IMAGE_DIMENSION } : { height: MAX_IMAGE_DIMENSION });
    }
    let rendered;
    try {
      rendered = await context.renderAsync();
      const encoded = await rendered.saveAsync({ base64: true, compress: 0.88, format: SaveFormat.JPEG });
      if (!encoded.base64 || !Number.isInteger(encoded.width) || !Number.isInteger(encoded.height)) throw new Error('image');
      if (encoded.base64.length > MAX_ENCODED_LENGTH) throw new Error('large');
      if (!work.current()) return;
      const next = { id: work.id, ownerUid: work.uid, dataUri: 'data:image/jpeg;base64,' + encoded.base64, width: encoded.width, height: encoded.height, capturedAt: new Date().toISOString() };
      photoRef.current = next;
      setPhoto(next);
      setReport(null);
      setCameraOpen(false);
      setCameraReady(false);
    } finally {
      rendered?.release?.();
      context.release?.();
    }
  };

  const openCamera = async () => {
    const work = beginPhotoWork();
    if (!work) return;
    setBusy('preparing');
    try {
      const granted = permission?.granted ? permission : await requestPermission();
      if (!work.current()) return;
      if (!granted.granted) { setErrorCode('camera'); return; }
      discardPhoto();
      setCameraOpen(true);
    } catch { if (work.current()) setErrorCode('camera'); }
    finally { if (work.current()) { workBusyRef.current = false; setBusy(null); } }
  };

  const capturePhoto = async () => {
    if (!cameraReady || !cameraRef.current) return;
    const work = beginPhotoWork();
    if (!work) return;
    const frozenLocal = !paused && localStatus === 'running' && isLiveFrameFresh(localFrameRef.current) ? localFrameRef.current : null;
    const liveImage = frozenLocal?.image;
    if (liveImage && frozenLocal.ownerUid !== work.uid) { discardPhoto(); setErrorCode('auth'); return; }
    stopLive();
    if (liveImage) {
      const frozen = { id: work.id, ownerUid: work.uid, ...liveImage };
      photoRef.current = frozen;
      const singleImageResult = { ...createLiveFaceTracker({ stableFrames: 1 }).update(frozenLocal), ownerUid: work.uid, image: liveImage, fps: null };
      photoLocalRef.current = singleImageResult; setPhotoLocalFrame(singleImageResult); setPhotoLocalStatus('ready');
      setPhoto(frozen); setReport(null); setCameraOpen(false); setCameraReady(false);
      workBusyRef.current = false;
      return;
    }
    setBusy('preparing');
    try {
      await cameraCaptureRef.current?.catch(() => {});
      if (!work.current()) return;
      const asset = await cameraRef.current.takePictureAsync({ quality: 0.95, skipProcessing: false, shutterSound: false });
      if (work.current()) await preparePhoto(asset, work);
    } catch (error) {
      if (work.current()) setErrorCode(['image', 'large'].includes(error.message) ? error.message : 'camera');
    } finally {
      if (work.current()) { workBusyRef.current = false; setBusy(null); }
    }
  };

  const choosePhoto = async () => {
    const work = beginPhotoWork();
    if (!work) return;
    stopLive(); setPaused(true);
    setBusy('preparing');
    try {
      const selected = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: false, quality: 1 });
      if (!work.current() || selected.canceled) return;
      await preparePhoto(selected.assets?.[0], work);
    } catch (error) {
      if (work.current()) setErrorCode(error.message === 'large' ? 'large' : 'image');
    } finally {
      if (work.current()) { workBusyRef.current = false; setBusy(null); }
    }
  };

  const analyzePhoto = async () => {
    const captured = photoRef.current;
    if (!captured) return;
    if (captured.ownerUid && captured.ownerUid !== auth.currentUser?.uid) { discardPhoto(); setErrorCode('auth'); return; }
    const work = beginPhotoWork();
    if (!work) return;
    const controller = new AbortController();
    controllerRef.current = controller;
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, 30000);
    setBusy('analyzing');
    setReport(null);
    try {
      const response = await apiFetch('/emotions/analyze-image', {
        method: 'POST', signal: controller.signal, body: JSON.stringify({ image: captured.dataUri }),
      });
      if (!work.current() || photoRef.current?.id !== captured.id) return;
      if (!response.ok) {
        const failure = await response.json().catch(() => ({}));
        if (!work.current()) return;
        throw new Error(failure.errorCode === 'FACE_NOT_CONFIGURED' ? 'notConfigured' : failure.errorCode === 'INVALID_IMAGE' ? 'image'
          : response.status === 503 ? 'unavailable' : response.status === 429 ? 'rateLimit' : response.status === 401 ? 'auth' : 'analysis');
      }
      const candidate = await response.json();
      if (!work.current() || photoRef.current?.id !== captured.id) return;
      let validated;
      try { validated = validateFaceReport(candidate); } catch { throw new Error('report'); }
      if (validated.image.width !== captured.width || validated.image.height !== captured.height) throw new Error('report');
      setReport(validated);
    } catch (error) {
      if (work.current() && timedOut) setErrorCode('timeout');
      else if (work.current() && error.name !== 'AbortError') setErrorCode(['report', 'unavailable', 'notConfigured', 'image', 'auth', 'rateLimit'].includes(error.message) ? error.message : 'analysis');
    } finally {
      clearTimeout(timeout);
      if (work.current()) { workBusyRef.current = false; controllerRef.current = null; setBusy(null); }
    }
  };

  const shareReport = async () => {
    if (!report || !photoRef.current || report.image.width !== photoRef.current.width || report.image.height !== photoRef.current.height) return;
    if (photoRef.current.ownerUid && photoRef.current.ownerUid !== auth.currentUser?.uid) { discardPhoto(); setErrorCode('auth'); return; }
    try { await Share.share({ title: copy.report, message: buildFaceReportText(report, language) }); }
    catch { if (mountedRef.current) setErrorCode('share'); }
  };

  const editCheckIn = (setter, value) => {
    setter(value);
    observationRef.current = null;
    setSaved(null);
  };

  const saveCheckIn = async () => {
    if (savingRef.current || saved) return;
    const user = auth.currentUser;
    if (!user) { setErrorCode('auth'); return; }
    const score = Number(scoreText);
    const reportedState = getEmotionCheckInState(feeling, language);
    if (!reportedState || !/^\d{1,3}$/.test(scoreText) || !Number.isInteger(score) || score < 0 || score > 100) {
      setErrorCode('score'); return;
    }
    const id = ++saveIdRef.current;
    const current = () => mountedRef.current && id === saveIdRef.current && auth.currentUser?.uid === user.uid;
    const controller = new AbortController();
    saveControllerRef.current = controller;
    const timeout = setTimeout(() => controller.abort(), 30000);
    savingRef.current = true;
    setSaving(true);
    setErrorCode(null);
    // This optional observation contains the person's own answers, never a score inferred from a face.
    const body = {
      stateScore: score, emotionLabel: 'Self-reported', category: score > 50 ? 'positive' : score === 50 ? 'neutral' : 'negative',
      note: '[Self-reported] Feeling: ' + reportedState.labels.en + ' (' + reportedState.id + '). ' + note.trim(),
    };
    const signature = JSON.stringify(body);
    if (!observationRef.current || observationRef.current.signature !== signature) {
      observationRef.current = { signature, id: 'OBS-' + Date.now() + '-' + Math.random().toString(36).slice(2, 12) };
    }
    try {
      const residentId = await getResidentId();
      if (!current()) return;
      const response = await apiFetch('/emotions', { method: 'POST', signal: controller.signal,
        body: JSON.stringify({ ...body, residentId, observationId: observationRef.current.id }) });
      if (!current()) return;
      if (!response.ok) throw new Error('save');
      const confirmation = await response.json();
      if (!current()) return;
      if (!confirmation?.id) throw new Error('save');
      setSaved({ alert: confirmation.alertCreated ? 'alertCreated' : confirmation.escalated ? 'alertUpdated' : confirmation.alertId ? 'alertExisting' : null,
        ownerUid: user.uid, report: { stateId: reportedState.id, wellnessScore: score, note: note.trim(), recordedAt: new Date().toISOString() } });
    } catch (error) {
      if (current()) setErrorCode('save');
    } finally {
      clearTimeout(timeout);
      if (current()) { savingRef.current = false; saveControllerRef.current = null; setSaving(false); }
    }
  };

  const shareCheckInReport = async () => {
    if (!saved?.report || saved.ownerUid !== auth.currentUser?.uid || !mountedRef.current) return;
    try {
      await Share.share({ title: getEmotionCheckInCopy(language).title,
        message: buildEmotionCheckInReport({ ...saved.report, language }) });
    } catch { if (mountedRef.current) setErrorCode('share'); }
  };

  const captureLiveFrame = async () => {
    if (!cameraRef.current || workBusyRef.current) throw new Error('camera_busy');
    const capture = captureLiveCameraImage({ camera: cameraRef.current, platform: Platform.OS,
      ImageManipulator, SaveFormat, deleteFile: FileSystem.deleteAsync,
      maxDimension: detectorModeRef.current === 'ssd' || detectorModeRef.current === 'auto' && ['webgl', 'webgl2'].includes(modelBackendRef.current) ? 960 : 640 });
    cameraCaptureRef.current = capture;
    try { return await capture; } finally { if (cameraCaptureRef.current === capture) cameraCaptureRef.current = null; }
  };

  const analyzeLiveCloudFrame = async (image, signal) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    const aborted = () => controller.abort();
    signal.addEventListener('abort', aborted, { once: true });
    if (signal.aborted) controller.abort();
    try {
      const response = await apiFetch('/emotions/analyze-image', { method: 'POST', signal: controller.signal, body: JSON.stringify({ image: image.dataUri }) });
      if (!response.ok) {
        const failure = await response.json().catch(() => ({}));
        throw new Error(failure.errorCode === 'FACE_NOT_CONFIGURED' ? 'notConfigured' : response.status === 429 ? 'rateLimit' : response.status === 401 ? 'auth' : 'unavailable');
      }
      const report = validateFaceReport(await response.json());
      if (report.image.width !== image.width || report.image.height !== image.height) throw new Error('report');
      return report;
    } finally { clearTimeout(timeout); signal.removeEventListener('abort', aborted); }
  };

  const toggleLivePause = () => {
    if (paused) { trackerRef.current?.reset(); setLocalFrame(null); localFrameRef.current = null; setLocalStatus('running'); setPaused(false); }
    else { stopLive(false); setPaused(true); setLocalStatus('paused'); }
  };
  const retryLocalModel = () => { stopLive(); setModelReady(false); setModelBackend(null); setLocalStatus('loading'); setPaused(false); setBridgeKey(key => key + 1); };
  const selectDetectorMode = next => {
    if (next === detectorMode || !['auto', 'tiny', 'ssd'].includes(next)) return;
    loopRef.current?.stop(); trackerRef.current?.reset();
    localFrameRef.current = null; setLocalFrame(null); setPaused(false);
    setLocalStatus(modelReady ? 'running' : 'loading');
    detectorModeRef.current = next; setDetectorMode(next);
  };
  const toggleCloudAssist = () => {
    if (localFrameRef.current && localFrameRef.current.ownerUid !== auth.currentUser?.uid) { discardPhoto(); setErrorCode('auth'); return; }
    if (cloudOn) { cloudSamplerRef.current?.disable(); setCloudOn(false); }
    else if (['checking', 'missing', 'invalid'].includes(cloudStatus.configurationState)) return;
    else { setCloudError(null); cloudSamplerRef.current?.enable(); setCloudOn(true); if (localFrameRef.current?.image) cloudSamplerRef.current?.sample(localFrameRef.current.image); }
  };
  const shareLiveReport = async () => {
    const current = localFrameRef.current || photoLocalRef.current;
    if (!current) return;
    if (activeCameraRef.current && (paused || !['running', 'recovering'].includes(localStatus) || !getLiveFramePresentation(current, Date.now()).resultFresh)) return;
    if (current.ownerUid && current.ownerUid !== auth.currentUser?.uid) { discardPhoto(); setErrorCode('auth'); return; }
    const sections = [buildLiveReportText(current, language)];
    if (activeCameraRef.current && movementSnapshotRef.current) sections.push(buildFacialObservationReport(movementSnapshotRef.current, language));
    if (symptomSnapshotRef.current) { const symptoms = symptomSnapshotRef.current; sections.push(buildPatientSymptomReport(symptoms.symptomKeys, language, symptoms.note, symptoms.reportedAt, symptoms.receipt)); }
    try { await Share.share({ title: liveCopy.report, message: sections.join('\n\n') }); }
    catch { if (mountedRef.current) setErrorCode('share'); }
  };

  useEffect(() => {
    trackerRef.current = createLiveFaceTracker();
    cloudSamplerRef.current = createCloudFrameSampler({ getUid: () => auth.currentUser?.uid,
      analyze: analyzeLiveCloudFrame,
      onReport: result => { if (mountedRef.current && activeCameraRef.current) { setCloudResult(result); setCloudError(null); } },
      onError: error => { if (mountedRef.current && activeCameraRef.current) { setCloudError(['notConfigured', 'auth', 'rateLimit', 'report'].includes(error.message) ? error.message : 'unavailable'); if (!cloudSamplerRef.current.enabled()) setCloudOn(false); } },
    });
    loopRef.current = createLiveFrameLoop({ getUid: () => auth.currentUser?.uid, capture: captureLiveFrame,
      detect: async packet => ({ ...(await bridgeRef.current.analyze(packet.image, { detector: detectorModeRef.current })), id: packet.id }),
      onFrame: sample => {
        if (!mountedRef.current || !activeCameraRef.current) return;
        const completedMs = Date.parse(sample.sampledAt), capturedMs = Date.parse(sample.capturedAt);
        const sampleGap = localFrameRef.current ? capturedMs - Date.parse(localFrameRef.current.capturedAt) : 0;
        const sampledAnalysis = completedMs - capturedMs > 1500 || sampleGap > 1500;
        // Slow samples can support a single-image estimate, never continuity or
        // the identity of a face seen seconds ago. Fast frames retain 3-frame evidence.
        if (sampledAnalysis) trackerRef.current.reset();
        const tracked = sampledAnalysis ? createLiveFaceTracker({ stableFrames: 1 }).update(sample) : trackerRef.current.update(sample);
        const gap = localFrameRef.current ? Date.parse(sample.sampledAt) - Date.parse(localFrameRef.current.completedAt) : 0;
        const current = { ...tracked, ownerUid: auth.currentUser?.uid, image: sample.image, completedAt: sample.sampledAt, sampledAnalysis, fps: gap > 0 ? 1000 / gap : null };
        localFrameRef.current = current; setLocalFrame(current); setLocalStatus('running');
        cloudSamplerRef.current.sample(sample.image);
      },
      onRecoverDetector: async () => {
        if (!mountedRef.current || !activeCameraRef.current || !bridgeRef.current?.restart) throw new Error('detector_unavailable');
        await bridgeRef.current.restart();
      },
      onRecovering: () => { if (mountedRef.current && activeCameraRef.current) { trackerRef.current?.reset(); setLocalStatus('recovering'); } },
      onError: () => { if (mountedRef.current) { setLocalStatus('error'); setLocalFrame(null); localFrameRef.current = null; setPaused(true); } },
    });
    const subscription = AppState.addEventListener('change', status => {
      if (status !== 'active') { stopLive(false); setPaused(true); setLocalStatus('paused'); }
    });
    return () => { loopRef.current?.stop(); cloudSamplerRef.current?.disable(); trackerRef.current?.reset(); subscription.remove(); };
  }, []);

  useEffect(() => {
    if (cameraOpen && cameraReady && modelReady && !photo && !paused) loopRef.current?.start();
    else loopRef.current?.stop();
    return () => loopRef.current?.stop();
  }, [cameraOpen, cameraReady, modelReady, photo, paused, detectorMode]);

  useEffect(() => {
    if (!cameraOpen || photo || paused) return;
    setHeartbeatAt(Date.now());
    const heartbeat = setInterval(() => { if (mountedRef.current) setHeartbeatAt(Date.now()); }, 250);
    return () => clearInterval(heartbeat);
  }, [cameraOpen, photo, paused]);

  useEffect(() => {
    if (!cameraOpen && !photo) return;
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    const id = ++statusRequestIdRef.current;
    const controller = new AbortController();
    statusControllerRef.current = controller;
    const current = () => mountedRef.current && id === statusRequestIdRef.current && auth.currentUser?.uid === uid;
    const timeout = setTimeout(() => controller.abort(), 8000);
    setCloudStatus({ configurationState: 'checking' });
    (async () => {
      try {
        const response = await apiFetch('/emotions/face-status', { signal: controller.signal });
        if (!response.ok) throw new Error('cloud_status');
        const next = validateFaceProviderStatus(await response.json());
        if (current()) setCloudStatus(next);
      } catch { if (current()) setCloudStatus({ configurationState: 'unavailable' }); }
      finally { clearTimeout(timeout); if (current()) statusControllerRef.current = null; }
    })();
    return () => { statusRequestIdRef.current += 1; controller.abort(); clearTimeout(timeout); };
  }, [cameraOpen, photo?.id, bridgeKey]);

  useEffect(() => {
    if (!photo || !modelReady) return;
    const existing = photoLocalRef.current;
    const sameImage = existing?.image?.dataUri === photo.dataUri || existing?.sourceDataUri === photo.dataUri;
    if (sameImage && existing.localDetector === 'ssd' && existing.ownerUid === photo.ownerUid) return;
    const selected = photo, uid = auth.currentUser?.uid, id = ++photoAnalysisIdRef.current;
    if (!uid || selected.ownerUid !== uid) return;
    const current = () => mountedRef.current && photoAnalysisIdRef.current === id && auth.currentUser?.uid === uid && photoRef.current?.id === selected.id && photoRef.current?.dataUri === selected.dataUri;
    setPhotoLocalStatus('processing');
    // Keep the immediate exact-photo estimate visible while the stronger local model refines it.
    if (!sameImage || existing.ownerUid !== uid) { setPhotoLocalFrame(null); photoLocalRef.current = null; }
    (async () => {
      try {
        const capturedAt = selected.capturedAt || new Date().toISOString();
        let image = { dataUri: selected.dataUri, width: selected.width, height: selected.height, capturedAt };
        // Preserve the original normalized photo for cloud analysis; local models use a separate smaller copy.
        if (Math.max(selected.width, selected.height) > 960) {
          const context = ImageManipulator.manipulate(selected.dataUri);
          let rendered, encoded;
          try {
            context.resize(selected.width >= selected.height ? { width: 960 } : { height: 960 });
            rendered = await context.renderAsync();
            encoded = await rendered.saveAsync({ base64: true, compress: 0.88, format: SaveFormat.JPEG });
            if (!encoded.base64 || !encoded.width || !encoded.height) throw new Error('image');
            image = { dataUri: 'data:image/jpeg;base64,' + encoded.base64, width: encoded.width, height: encoded.height, capturedAt };
          } finally {
            rendered?.release?.(); context.release?.();
            // Cache cleanup must not discard valid normalized pixels or suppress inference.
            if (typeof encoded?.uri === 'string' && encoded.uri.startsWith('file://')) await Promise.resolve().then(() => FileSystem.deleteAsync(encoded.uri, { idempotent: true })).catch(() => {});
          }
        }
        await bridgeRef.current.waitForIdle();
        if (!current()) return;
        const raw = await bridgeRef.current.analyze(image, { detector: 'ssd' });
        if (!current()) return;
        const tracker = createLiveFaceTracker({ stableFrames: 1 });
        const result = { ...tracker.update(raw), image, ownerUid: uid, sourceDataUri: selected.dataUri, localDetector: 'ssd', fps: null };
        photoLocalRef.current = result; setPhotoLocalFrame(result); setPhotoLocalStatus('ready');
      } catch { if (current()) setPhotoLocalStatus('error'); }
    })();
    return () => { photoAnalysisIdRef.current += 1; };
  }, [photo?.id, modelReady]);

  const displayLocalFrame = cameraOpen ? localFrame : photoLocalFrame;
  const presentation = getLiveFramePresentation(localFrame, Math.max(heartbeatAt, Date.now()));
  const freshLocalFrame = cameraOpen && !paused && ['running', 'recovering'].includes(localStatus) && presentation.resultFresh ? localFrame : null;
  const overlayFrame = freshLocalFrame && localStatus === 'running' && presentation.overlayFresh ? freshLocalFrame : null;
  const sampledAnalysis = Boolean(freshLocalFrame && (presentation.sampled || freshLocalFrame.sampledAnalysis));
  const sampledPresentation = Boolean(freshLocalFrame && (sampledAnalysis || !presentation.overlayFresh));
  const expressionFrame = cameraOpen ? freshLocalFrame : photoLocalFrame;
  const liveIndicator = paused ? liveCopy.paused : !modelReady ? liveCopy.modelLoading : localStatus === 'recovering' ? liveCopy.recovering
    : freshLocalFrame ? sampledPresentation ? liveCopy.sampledAnalysis : liveCopy.sampled : localFrame ? liveCopy.staleFrame : liveCopy.waitingFrame;
  const cloudStatusText = getFaceProviderStatusCopy(language).states[cloudStatus.configurationState];
  const qualityCopy = getLiveFaceQualityCopy(language);
  const guideCopy = getFaceGuideCopy(language);
  const workflowState = getAssistanceWorkflow(movementSnapshot, symptomSnapshot);
  const quality = summarizeLiveFaceQuality(displayLocalFrame, {
    mode: cameraOpen ? 'live' : 'photo', backend: modelBackend,
    completedRateHz: cameraOpen && Number.isFinite(displayLocalFrame?.fps) ? displayLocalFrame.fps : undefined,
    frameAgeMs: cameraOpen && displayLocalFrame ? Math.max(0, Math.max(heartbeatAt, Date.now()) - Date.parse(displayLocalFrame.capturedAt)) : undefined,
  });

  return (
    <SafeAreaView style={styles.container}>
      {(cameraOpen || photo) && <LiveFaceBridge key={bridgeKey} ref={bridgeRef}
        onReady={backend => { if (mountedRef.current && (activeCameraRef.current || photoRef.current)) { setModelBackend(['cpu', 'wasm', 'webgl', 'webgl2'].includes(backend) ? backend : null); setModelReady(true); setLocalStatus('running'); } }}
        onError={() => {
          if (!mountedRef.current || !(activeCameraRef.current || photoRef.current)) return;
          // A failed in-flight analysis is rejected by the bridge and recovered
          // by the loop. Do not cancel that recovery through the readiness effect.
          if (activeCameraRef.current && loopRef.current?.busy()) { trackerRef.current?.reset(); setLocalStatus('recovering'); return; }
          stopLive(); setModelReady(false); setLocalStatus('modelError'); setPhotoLocalStatus('error');
        }} />}
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <TouchableOpacity accessibilityLabel={copy.back} style={styles.back} onPress={() => { cancelSession(); if (navigation?.canGoBack?.()) navigation.goBack(); else navigation?.navigate?.('Dashboard'); }}>
            <MaterialCommunityIcons name="arrow-left" color="#FFF" size={24} />
          </TouchableOpacity>
          <View style={styles.headerCopy}>
            <Text style={styles.eyebrow}>CARECONNECT · LIVE</Text>
            <Text style={styles.title}>{liveCopy.studio}</Text>
            <Text style={styles.subtitle}>{liveCopy.subtitle}</Text>
            <Text style={styles.subtitle}>{liveCopy.appVersion}: {appConfig.expo.version}</Text>
          </View>
        </View>
        <View style={styles.languages}>
          {FACE_LANGUAGES.map(item => (
            <TouchableOpacity key={item.code} onPress={() => setLanguage(item.code)}
              accessibilityRole="button" accessibilityState={{ selected: language === item.code }}
              style={[styles.language, language === item.code && styles.languageSelected]}>
              <Text style={[styles.languageText, language === item.code && styles.languageTextSelected]}>{item.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {!photo && <View>
          <Text style={styles.detectorLabel}>{liveCopy.detectorMode}</Text>
          <View style={styles.languages}>{['auto', 'tiny', 'ssd'].map(mode => <TouchableOpacity key={mode} onPress={() => selectDetectorMode(mode)}
            accessibilityRole="button" accessibilityState={{ selected: detectorMode === mode }} style={[styles.language, detectorMode === mode && styles.languageSelected]}>
            <Text style={[styles.languageText, detectorMode === mode && styles.languageTextSelected]}>{liveCopy.detectorModes[mode]}</Text>
          </TouchableOpacity>)}</View>
          <Text style={styles.detectorHint}>{liveCopy.detectorHint}</Text>
        </View>}

        <View style={styles.photoCard}>
          <View style={styles.studioHeader}><View style={styles.studioTitleRow}><MaterialCommunityIcons name="face-recognition" size={20} color="#A5E6D0" /><Text style={styles.studioTitle}>{photo ? liveCopy.photoResults : liveCopy.liveResults}</Text></View><View style={styles.studioPill}><View style={[styles.statusDot, !freshLocalFrame && { backgroundColor: '#8DABA6' }]} /><Text style={styles.studioPillText}>{cameraOpen ? liveIndicator : photo ? liveCopy.singleImage : copy.preview}</Text></View></View>
          <View style={styles.photoStage} onLayout={event => setFrame(event.nativeEvent.layout)}>
            {photo ? (
              <>
                <Image source={{ uri: photo.dataUri }} style={StyleSheet.absoluteFillObject} resizeMode="contain" fadeDuration={0} accessibilityLabel={copy.preview} />
                {!photoLocalFrame && report?.faces.map((face, index) => {
                  const box = containedFaceBox(face.box, photo, frame);
                  return box ? <View key={index} style={[styles.faceBox, box]} pointerEvents="none"><Text style={styles.faceTag}>{index + 1}</Text></View> : null;
                })}
                {(photoLocalFrame?.image.dataUri === photo.dataUri || photoLocalFrame?.sourceDataUri === photo.dataUri) && photoLocalFrame.faces.map((face, index) => {
                  const box = containedFaceBox(face.box, photo, frame);
                  const fullImage = containedFaceBox({ x: 0, y: 0, width: 1, height: 1 }, photo, frame);
                  if (!box) return null;
                  const display = getExpressionDisplay(face.expression, face.expression === 'uncertain' ? null : face.expressionConfidence, language);
                  return <React.Fragment key={face.id}><View style={[styles.liveFaceBox, box, !face.stable && styles.uncertainBox]} pointerEvents="none"><Text style={styles.liveFaceTag}>{display.emoji} {index + 1}</Text></View>{landmarksVisible && face.landmarks.map((point, index) => <View key={index} pointerEvents="none" style={[styles.landmarkDot, { left: fullImage.left + point.x * fullImage.width - 1.5, top: fullImage.top + point.y * fullImage.height - 1.5 }]} />)}</React.Fragment>;
                })}
              </>
            ) : cameraOpen ? (
              <>
              <CameraView style={StyleSheet.absoluteFillObject} facing="front" mirror={false} animateShutter={false} ref={cameraRef}
                onCameraReady={() => setCameraReady(true)}
                onMountError={() => { stopLive(); setCameraOpen(false); setCameraReady(false); setErrorCode('camera'); }} />
              {overlayFrame?.faces.map((face, index) => {
                  const box = livePreviewFaceBox(face.box, overlayFrame.image, frame, FRONT_PREVIEW_TRANSFORM);
                  if (!box) return null;
                  const display = getExpressionDisplay(face.expression, face.expression === 'uncertain' ? null : face.expressionConfidence, language);
                  return <React.Fragment key={face.id}>
                    <View style={[styles.liveFaceBox, box, !face.stable && styles.uncertainBox]} pointerEvents="none"><Text style={styles.liveFaceTag}>{display.emoji} {index + 1}</Text></View>
                    {landmarksVisible && face.landmarks.map((point, landmarkIndex) => {
                      const position = livePreviewPoint(point, overlayFrame.image, frame, FRONT_PREVIEW_TRANSFORM);
                      return position ? <View key={landmarkIndex} pointerEvents="none" style={[styles.landmarkDot, { left: position.left - 1.5, top: position.top - 1.5 }]} /> : null;
                    })}
                  </React.Fragment>;
                })}
              {freshLocalFrame && <View style={styles.analyzedThumbnail} pointerEvents="none">
                <Image source={{ uri: freshLocalFrame.image.dataUri }} style={styles.analyzedThumbnailImage} resizeMode="contain" fadeDuration={0} accessibilityLabel={liveCopy.analyzedThumbnail} />
                {freshLocalFrame.faces.map((face, index) => {
                  const box = containedFaceBox(face.box, freshLocalFrame.image, { width: 102, height: 112 });
                  return box ? <View key={face.id} style={[styles.analyzedThumbnailBox, box]}><Text style={styles.analyzedThumbnailFace}>{index + 1}</Text></View> : null;
                })}
                <Text style={styles.analyzedThumbnailText}>{liveCopy.analyzedThumbnail}</Text>
              </View>}
              <View style={styles.liveBadge}><View style={[styles.statusDot, !freshLocalFrame && { backgroundColor: '#F4C883' }]} /><Text style={styles.liveBadgeText}>{liveIndicator}</Text></View>
              </>
            ) : (
              <View style={styles.empty}>
                <View style={styles.faceIcon}><MaterialCommunityIcons name="face-recognition" size={60} color="#A5E6D0" /></View>
                <Text style={styles.emptyTitle}>{liveCopy.emptyTitle}</Text>
                <Text style={styles.emptyHint}>{liveCopy.emptyHint}</Text>
              </View>
            )}
            {busy && <View style={styles.overlay}><ActivityIndicator color="#FFF" size="large" /><Text style={styles.overlayText}>{copy[busy]}</Text></View>}
          </View>
          {cameraOpen && freshLocalFrame && <View style={styles.liveResultPanel} testID="live-expression-results">
            <View style={styles.liveResultHeading}><Text style={styles.liveResultTitle}>{liveCopy.liveResults}</Text><Text style={styles.liveResultStatus}>{sampledPresentation ? liveCopy.analyzedThumbnail : liveCopy.updating}</Text></View>
            {!freshLocalFrame.faces.length ? <Text style={styles.liveResultText}>{liveCopy.noFaces}</Text> : freshLocalFrame.faces.map((face, index) => {
              const display = getExpressionDisplay(face.expression, face.expression === 'uncertain' ? null : face.expressionConfidence, language);
              const summary = getLiveExpressionSummary(face, language);
              return <View key={face.id} style={styles.liveResultFace}>
                <View style={styles.liveResultRow}><Text style={styles.liveResultText}>{display.emoji} {liveCopy.face} {index + 1} · {display.label}</Text><Text style={styles.liveResultProbability}>{face.stable ? display.valueText : liveCopy.notConfirmed}</Text></View>
                <Text style={styles.liveLeadingScore}>{summary.leading ? `${liveCopy.highestModelScore}: ${summary.leading.emoji} ${summary.leading.label} · ${summary.leading.valueText}` : summary.scoreEntries.length ? liveCopy.noUniqueLeadingScore : liveCopy.noModelScores}</Text>
                {!face.stable && summary.explanation && <Text style={styles.liveReason}>{summary.explanation}</Text>}
                <Text style={styles.liveScoreTitle}>{liveCopy.rawModelScores}</Text>
                <View style={styles.liveScoreList}>{summary.scoreEntries.slice().sort((a, b) => LIVE_EXPRESSIONS.indexOf(a.expression) - LIVE_EXPRESSIONS.indexOf(b.expression)).map(entry => <View key={entry.expression} style={styles.liveScoreRow}>
                  <Text style={styles.liveScoreLabel}>{entry.emoji} {entry.label}</Text><View style={styles.liveScoreTrack}><View style={[styles.liveScoreFill, { width: (entry.score * 100) + '%' }]} /></View><Text style={styles.liveScorePercent}>{entry.valueText}</Text>
                </View>)}</View>
              </View>;
            })}
            <View style={styles.liveMetrics}><Text style={styles.liveMetricText}>{freshLocalFrame.faces.length} · {liveCopy.faces}</Text><Text style={styles.liveMetricText}>{freshLocalFrame.fps === null ? liveCopy.unknown : freshLocalFrame.fps.toFixed(1)} · {liveCopy.updateRate}</Text></View>
            <Text style={styles.liveMetricText}>{liveCopy.captureAge}: {(presentation.captureAgeMs / 1000).toFixed(1)} {liveCopy.seconds} · {liveCopy.analysisDelay}: {((Date.parse(freshLocalFrame.completedAt) - Date.parse(freshLocalFrame.capturedAt)) / 1000).toFixed(1)} {liveCopy.seconds}</Text>
          </View>}
          <View style={styles.photoCaption}>
            <MaterialCommunityIcons name={photo ? 'image-check-outline' : 'lightbulb-outline'} size={20} color="#95B9B3" />
            <Text style={styles.caption}>{photo ? liveCopy.singleImageNotice : cameraOpen && localFrame && !freshLocalFrame ? liveCopy.staleFrameNotice : sampledPresentation ? liveCopy.sampledNotice : cameraOpen ? liveCopy.localProcessing : copy.captureHint}</Text>
          </View>
          <View style={styles.studioMetrics}>
            <View style={styles.studioMetric}><Text style={styles.studioMetricValue}>{cameraOpen && !freshLocalFrame || quality.faceCount === null ? '—' : quality.faceCount}</Text><Text style={styles.studioMetricLabel}>{qualityCopy.faces}</Text></View>
            <View style={[styles.studioMetric, styles.studioMetricMiddle]}><Text style={styles.studioMetricValue}>{photo ? '1' : !freshLocalFrame || quality.completedRateHz === null ? '—' : quality.completedRateHz.toFixed(1)}</Text><Text style={styles.studioMetricLabel}>{photo ? liveCopy.singleImage : qualityCopy.updateRate}</Text></View>
            <View style={styles.studioMetric}><Text style={styles.studioMetricValue}>{cameraOpen && !freshLocalFrame || quality.processingTimeMs === null ? '—' : Math.round(quality.processingTimeMs)}</Text><Text style={styles.studioMetricLabel}>{qualityCopy.processingTime} · {liveCopy.milliseconds}</Text></View>
          </View>
        </View>

        {errorCode && <View style={styles.errorBox} accessibilityRole="alert"><MaterialCommunityIcons name="alert-circle-outline" color="#AB3049" size={22} /><Text style={styles.errorText}>{copy.errors[errorCode] || copy.errors.analysis}</Text></View>}

        {cameraOpen ? (
          <>
            <View style={styles.sourceActions}>
              <TouchableOpacity style={[styles.secondary, (!modelReady || busy) && styles.disabled]} onPress={toggleLivePause} disabled={!modelReady || Boolean(busy)}><MaterialCommunityIcons name={paused ? 'play' : 'pause'} size={22} color="#343078" /><Text style={styles.secondaryText}>{paused ? liveCopy.resume : liveCopy.pause}</Text></TouchableOpacity>
              <TouchableOpacity style={styles.secondary} onPress={discardPhoto}><MaterialCommunityIcons name="stop" size={22} color="#343078" /><Text style={styles.secondaryText}>{liveCopy.stopCamera}</Text></TouchableOpacity>
            </View>
            <TouchableOpacity style={[styles.primary, (!cameraReady || busy) && styles.disabled]} onPress={capturePhoto} disabled={!cameraReady || Boolean(busy)}>
              <MaterialCommunityIcons name="camera" size={22} color="#173C34" /><Text style={styles.primaryText}>{overlayFrame ? liveCopy.freeze : copy.capture}</Text>
            </TouchableOpacity>
            {['modelError', 'error'].includes(localStatus) && <View style={styles.errorBox}><View style={{ flex: 1 }}><Text style={styles.errorText}>{localStatus === 'modelError' ? liveCopy.modelUnavailable : liveCopy.liveError}</Text><TouchableOpacity onPress={retryLocalModel} style={styles.retake}><Text style={styles.retakeText}>{liveCopy.restart}</Text></TouchableOpacity></View></View>}
            <TouchableOpacity style={styles.retake} onPress={() => setLandmarksVisible(!landmarksVisible)}><Text style={styles.retakeText}>{landmarksVisible ? liveCopy.hideLandmarks : liveCopy.showLandmarks}</Text></TouchableOpacity>
          </>
        ) : photo ? (
          <>
            <Text style={styles.notice}>{cloudStatusText}</Text>
            <Text style={styles.notice}>{copy.consent}</Text>
            <TouchableOpacity style={[styles.primary, busy && styles.disabled]} onPress={analyzePhoto} disabled={Boolean(busy)}>
              <MaterialCommunityIcons name="face-recognition" size={22} color="#173C34" /><Text style={styles.primaryText}>{busy === 'analyzing' ? copy.analyzing : copy.analyze}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.retake} onPress={discardPhoto}><Text style={styles.retakeText}>{copy.retake}</Text></TouchableOpacity>
          </>
        ) : null}

        {!photo && <View style={styles.sourceActions}>
          {!cameraOpen && <TouchableOpacity style={[styles.secondary, busy && styles.disabled]} onPress={openCamera} disabled={Boolean(busy)}>
            <MaterialCommunityIcons name="camera-outline" size={22} color="#343078" /><Text style={styles.secondaryText}>{liveCopy.startCamera}</Text>
          </TouchableOpacity>}
          <TouchableOpacity style={[styles.secondary, busy && styles.disabled]} onPress={choosePhoto} disabled={Boolean(busy)}>
            <MaterialCommunityIcons name="image-outline" size={22} color="#343078" /><Text style={styles.secondaryText}>{copy.upload}</Text>
          </TouchableOpacity>
          {!cameraOpen && <TouchableOpacity style={[styles.secondary, { backgroundColor: '#EDE9FE' }]} onPress={() => setVocalModalOpen(true)}>
            <MaterialCommunityIcons name="microphone" size={22} color="#6D38FF" /><Text style={[styles.secondaryText, { color: '#6D38FF' }]}>Voice Scan</Text>
          </TouchableOpacity>}
        </View>}
        {!photo && !permission?.granted && <Text style={styles.notice}>{copy.cameraPermission}</Text>}

        <View style={[styles.workflowCard, { borderColor: {normal:'#338A74',possible:'#B79550',attention:'#C28748',urgent:'#B95D57',unavailable:'#365562'}[workflowState] }]} testID="assistance-workflow-status"><Text style={styles.workflowEyebrow}>{guideCopy.workflow}</Text><Text style={styles.workflowTitle}>{guideCopy[workflowState]}</Text><Text style={styles.workflowNote}>{guideCopy.workflowNotice}</Text></View>
        {cameraOpen && <FacialObservationPanel frame={freshLocalFrame} language={language} active={!paused && modelReady && ['running','recovering'].includes(localStatus)} ownerUid={accountRef.current} onChange={handleMovementChange} />}
        <FaceCareHelpPanel language={language} navigation={navigation} onChange={handleSymptomChange} />
        {!cameraOpen && <FaceMonitoringGuide language={language} />}

        {(cameraOpen || photoLocalFrame) && <View style={styles.qualityCard}>
          <View style={styles.reportHeading}><View style={styles.qualityIcon}><MaterialCommunityIcons name="tune-variant" color="#24765D" size={23} /></View><View style={{ flex: 1 }}><Text style={styles.reportTitle}>{qualityCopy.title}</Text><Text style={styles.notice}>{qualityCopy.states[quality.state]}</Text></View></View>
          <View style={styles.qualityRail}><View style={styles.qualityMetric}><Text style={styles.qualityValue}>{cameraOpen && !freshLocalFrame || quality.stableCount === null ? '—' : quality.stableCount}</Text><Text style={styles.metricLabel}>{qualityCopy.stable}</Text></View><View style={styles.qualityMetric}><Text style={styles.qualityValue}>{cameraOpen && !freshLocalFrame || quality.uncertainCount === null ? '—' : quality.uncertainCount}</Text><Text style={styles.metricLabel}>{qualityCopy.uncertain}</Text></View><View style={styles.qualityMetric}><Text style={styles.qualityValue}>{cameraOpen && !freshLocalFrame || quality.faceCount === null ? '—' : quality.faceCount}</Text><Text style={styles.metricLabel}>{qualityCopy.faces}</Text></View></View>
          {quality.reasonCodes.filter(code => qualityCopy.tips[code]).map(code => <View key={code} style={styles.qualityTip}><MaterialCommunityIcons name="information-outline" size={17} color="#58887A" /><Text style={styles.qualityTipText}>{qualityCopy.tips[code]}</Text></View>)}
          <Text style={styles.qualityEvidence}>{photo || sampledAnalysis ? qualityCopy.singleFrameNotice : qualityCopy.evidenceNotice}</Text><Text style={styles.qualityEvidence}>{qualityCopy.notHealth}</Text>
        </View>}

        {photo && !photoLocalFrame && <View style={styles.reportCard}>
          {photoLocalStatus === 'error' ? <><Text style={styles.errorText}>{liveCopy.modelUnavailable}</Text><TouchableOpacity style={styles.secondary} onPress={retryLocalModel}><Text style={styles.secondaryText}>{liveCopy.restart}</Text></TouchableOpacity></>
            : <><ActivityIndicator color="#187B62" /><Text style={styles.notice}>{modelReady ? liveCopy.analyzing : liveCopy.modelLoading}</Text></>}
          <Text style={styles.notice}>{liveCopy.localOnly}</Text>
        </View>}

        {(cameraOpen || photoLocalFrame) && <>
          <View style={styles.localPrivacy}><MaterialCommunityIcons name="shield-lock-outline" size={20} color="#1B8065" /><Text style={styles.localPrivacyText}>{cameraOpen ? liveCopy.localPrivacy : liveCopy.localProcessing}</Text></View>
          {expressionFrame && <View style={styles.reportCard}>
            <View style={styles.reportHeading}><MaterialCommunityIcons name="face-recognition" size={27} color="#187B62" /><Text style={styles.reportTitle}>{photo ? liveCopy.photoResults : liveCopy.liveTitle}</Text></View>
            {cameraOpen && <Text style={styles.notice}>{sampledPresentation ? liveCopy.sampledNotice : liveCopy.trackingHelp}</Text>}
            {cameraOpen && <Text style={styles.notice}>{liveCopy.captureAge}: {(presentation.captureAgeMs / 1000).toFixed(1)} {liveCopy.seconds} · {liveCopy.analysisDelay}: {((Date.parse(expressionFrame.completedAt) - Date.parse(expressionFrame.capturedAt)) / 1000).toFixed(1)} {liveCopy.seconds}</Text>}
            <Text style={styles.notice}>{liveCopy.imageSize}: {expressionFrame.width} × {expressionFrame.height} {liveCopy.pixels}</Text>
            {!expressionFrame.faces.length && <Text style={styles.notice}>{liveCopy.noFaces}</Text>}
            {expressionFrame.faces.map((face, index) => {
              const display = getExpressionDisplay(face.expression, face.expression === 'uncertain' ? null : face.expressionConfidence, language);
              return <View style={styles.expressionCard} key={face.id}>
                <View style={styles.expressionHeading}><Text style={styles.expressionEmoji}>{display.emoji}</Text><View style={{ flex: 1 }}><Text style={styles.expressionLabel}>{liveCopy.face} {index + 1} · {display.label}</Text><Text style={styles.notice}>{!face.stable ? liveCopy.uncertain : face.evidenceMode === 'single-frame' ? liveCopy.singleFrame : liveCopy.stable}</Text></View><Text style={styles.probability}>{display.valueText}</Text></View>
                <Text style={styles.notice}>{liveCopy.evidenceMode}: {face.evidenceMode === 'single-frame' ? liveCopy.singleFrame : liveCopy.temporalEvidence}</Text>
                <Text style={styles.metricLabel}>{liveCopy.expressionConfidence}</Text>
                <Text style={styles.notice}>{liveCopy.confidence}: {(face.detectionConfidence * 100).toFixed(1)}%</Text>
                <View style={styles.probabilityList}>{LIVE_EXPRESSIONS.map(expression => {
                  const value = face.smoothedScores[expression];
                  return <View key={expression} style={styles.probabilityRow}><Text style={styles.probabilityEmoji}>{expressionEmoji[expression]}</Text><Text style={styles.probabilityLabel}>{liveCopy.expressions[expression]}</Text><View style={styles.probabilityTrack}><View style={[styles.probabilityFill, { width: (value * 100) + '%' }]} /></View><Text style={styles.probabilityPercent}>{(value * 100).toFixed(1)}%</Text></View>;
                })}</View>
              </View>;
            })}
            <Text style={styles.notice}>{liveCopy.probabilityHelp}</Text><Text style={styles.notice}>{photo || sampledAnalysis ? liveCopy.singleImageNotice : liveCopy.trackingHelp}</Text>
            <TouchableOpacity style={styles.secondary} onPress={shareLiveReport}><MaterialCommunityIcons name="share-variant-outline" color="#343078" size={22} /><Text style={styles.secondaryText}>{photo ? liveCopy.sharePhoto : liveCopy.share}</Text></TouchableOpacity>
          </View>}
          {cameraOpen && <FaceExpressionCheckIn frame={freshLocalFrame} monitoring={!paused && localStatus === 'running' && modelReady} language={language} />}
          {cameraOpen && <View style={styles.reportCard}>
            <View style={styles.selfHeader}><MaterialCommunityIcons name="cloud-outline" size={24} color="#6D38FF" /><Text style={styles.selfTitle}>{liveCopy.cloudAssist}</Text><TouchableOpacity onPress={toggleCloudAssist} disabled={!cloudOn && ['checking', 'missing', 'invalid'].includes(cloudStatus.configurationState)} style={[styles.cloudToggle, cloudOn && styles.cloudToggleOn]} accessibilityRole="switch" accessibilityState={{ checked: cloudOn, disabled: !cloudOn && ['checking', 'missing', 'invalid'].includes(cloudStatus.configurationState) }} accessibilityLabel={liveCopy.cloudAssist}><View style={[styles.toggleThumb, cloudOn && { alignSelf: 'flex-end' }]} /></TouchableOpacity></View>
            <Text style={styles.notice}>{cloudStatusText}</Text>
            <Text style={styles.notice}>{liveCopy.cloudConsent}</Text><Text style={styles.localPrivacyText}>{cloudOn ? liveCopy.cloudOn : liveCopy.cloudOff}</Text>
            {cloudError && <Text style={styles.errorText}>{copy.errors[cloudError] || copy.errors.unavailable}</Text>}
            {cloudResult && <View style={styles.cloudSnapshot}><Text style={styles.reportTitle}>{liveCopy.cloudFrame}</Text><Text style={styles.notice}>{liveCopy.cloudDifferent}</Text><Image source={{ uri: cloudResult.image.dataUri }} style={styles.cloudImage} resizeMode="contain" /><Text selectable style={styles.reportBody}>{buildFaceReportText(cloudResult.report, language)}</Text></View>}
          </View>}
        </>}

        {report && (
          <View style={styles.reportCard}>
            <View style={styles.reportHeading}><MaterialCommunityIcons name={report.status === 'ready' ? 'check-decagram-outline' : 'camera-retake-outline'} size={28} color={report.status === 'ready' ? '#187B62' : '#B76916'} /><View style={{ flex: 1 }}><Text style={styles.reportTitle}>{copy.report}</Text><Text style={[styles.reportStatus, report.status !== 'ready' && { color: '#B76916' }]}>{report.status === 'ready' ? copy.ready : copy.needsRetake}</Text></View></View>
            <View style={styles.metricRow}><View style={styles.metric}><Text style={styles.metricValue}>{report.faceCount}</Text><Text style={styles.metricLabel}>{copy.faces}</Text></View>{report.faceCount === 1 && <View style={styles.metric}><Text style={styles.metricValue}>{(report.faces[0].confidence * 100).toFixed(1)}%</Text><Text style={styles.metricLabel}>{copy.confidence}</Text></View>}</View>
            <Text selectable style={styles.reportBody}>{buildFaceReportText(report, language)}</Text>
            <Text style={styles.notice}>{copy.noPerfect}</Text>
            <TouchableOpacity style={styles.secondary} onPress={shareReport}><MaterialCommunityIcons name="share-variant-outline" color="#343078" size={22} /><Text style={styles.secondaryText}>{copy.share}</Text></TouchableOpacity>
          </View>
        )}

        <View style={styles.limitCard}><MaterialCommunityIcons name="shield-check-outline" size={22} color="#6862A8" /><View style={{ flex: 1 }}><Text style={styles.notice}>{copy.limits}</Text><Text style={[styles.notice, { marginTop: 8 }]}>{copy.privacy}</Text></View></View>

        <View style={styles.selfCard}>
          <TouchableOpacity style={styles.selfHeader} onPress={() => setSelfOpen(!selfOpen)} accessibilityRole="button" accessibilityState={{ expanded: selfOpen }}>
            <MaterialCommunityIcons name="heart-outline" size={24} color="#6D38FF" /><Text style={styles.selfTitle}>{getEmotionCheckInCopy(language).title}</Text><MaterialCommunityIcons name={selfOpen ? 'chevron-up' : 'chevron-down'} size={24} color="#6D38FF" />
          </TouchableOpacity>
          {selfOpen && <>
            <Text style={styles.notice}>{copy.manualHint}</Text>
            <Text style={styles.fieldLabel}>{copy.feeling}</Text>
            <EmotionCheckInPicker language={language} value={feeling} disabled={saving || Boolean(saved)} onChange={key => editCheckIn(setFeeling, key)} />
            <Text style={styles.fieldLabel}>{copy.score}</Text>
            <Text style={styles.notice}>{copy.scoreHint}</Text>
            <TextInput accessibilityLabel={copy.score} keyboardType="number-pad" inputMode="numeric" value={scoreText} editable={!saving && !saved} maxLength={3} onChangeText={value => editCheckIn(setScoreText, value.replace(/[^\d]/g, ''))} placeholder="0–100" style={styles.scoreInput} />
            <View style={styles.scoreChoices}>{[0, 25, 50, 75, 100].map(score => <TouchableOpacity key={score} disabled={saving || Boolean(saved)} onPress={() => editCheckIn(setScoreText, String(score))} style={[styles.scoreChoice, scoreText === String(score) && styles.feelingSelected]} accessibilityLabel={copy.score + ': ' + score}><Text style={[styles.feelingText, scoreText === String(score) && { color: '#FFF' }]}>{score}</Text></TouchableOpacity>)}</View>
            <Text style={styles.fieldLabel}>{copy.note}</Text>
            <TextInput accessibilityLabel={copy.note} multiline value={note} editable={!saving && !saved} maxLength={4500} onChangeText={value => editCheckIn(setNote, value)} placeholder={copy.notePlaceholder} style={styles.noteInput} />
            <Text style={[styles.notice, { marginBottom: 14 }]}>{copy.alertNotice}</Text>
            {saved ? <View style={styles.savedBox}><Text style={styles.savedText}>{copy.saved}</Text>{saved.alert && <Text style={styles.notice}>{copy[saved.alert]}</Text>}
              <TouchableOpacity style={styles.secondary} onPress={shareCheckInReport} accessibilityRole="button"><MaterialCommunityIcons name="share-variant-outline" color="#343078" size={22} /><Text style={styles.secondaryText}>{getEmotionCheckInCopy(language).shareReport}</Text></TouchableOpacity></View>
              : <TouchableOpacity style={[styles.primary, (saving || !feeling || !scoreText) && styles.disabled]} onPress={saveCheckIn} disabled={saving || !feeling || !scoreText}>{saving ? <ActivityIndicator color="#173C34" /> : <MaterialCommunityIcons name="content-save-outline" color="#173C34" size={22} />}<Text style={styles.primaryText}>{saving ? copy.saving : copy.save}</Text></TouchableOpacity>}
          </>}
        </View>
      </ScrollView>
      <VocalToneModal 
        visible={vocalModalOpen} 
        onClose={() => setVocalModalOpen(false)} 
        onSaved={() => {
          Alert.alert('Analysis Saved', 'Your vocal emotion check-in was successfully saved to your records.');
        }} 
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  workflowCard: { backgroundColor: '#18313B', borderWidth: 1, borderRadius: 22, padding: 17, gap: 7 }, workflowEyebrow: { color: '#9EBCC5', fontSize: 10, lineHeight: 19, fontWeight: '700' }, workflowTitle: { color: '#F0F7F4', fontSize: 16, lineHeight: 29, fontWeight: '800' }, workflowNote: { color: '#A4BFC7', fontSize: 11, lineHeight: 21 },
  container: { flex: 1, backgroundColor: '#0F1D24' },
  content: { padding: 20, paddingBottom: 44, gap: 18, width: '100%', maxWidth: 740, alignSelf: 'center' },
  header: { flexDirection: 'row', gap: 14, alignItems: 'flex-start', paddingTop: 8 },
  back: { width: 44, height: 44, borderRadius: 15, backgroundColor: '#21363D', borderWidth: 1, borderColor: '#34514F', alignItems: 'center', justifyContent: 'center' },
  headerCopy: { flex: 1 },
  eyebrow: { color: '#9AB5AF', fontSize: 9, letterSpacing: 1.5, fontWeight: '800', marginBottom: 7 },
  title: { color: '#ECF9F4', fontSize: 25, fontWeight: '800', lineHeight: 36 },
  subtitle: { color: '#A2B9B6', fontSize: 12, lineHeight: 23, marginTop: 6 },
  languages: { flexDirection: 'row', backgroundColor: '#1B3037', borderWidth: 1, borderColor: '#2C474B', borderRadius: 18, padding: 5, gap: 4 },
  language: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 14, paddingHorizontal: 4 },
  languageSelected: { backgroundColor: '#A5E6D0' },
  languageText: { color: '#B1C6C1', fontSize: 13, fontWeight: '700' },
  languageTextSelected: { color: '#173C34' },
  detectorLabel: { color: '#B1C6C1', fontSize: 12, fontWeight: '700', marginBottom: 7 },
  detectorHint: { color: '#A2B9B6', fontSize: 11, lineHeight: 20, marginTop: 7 },
  photoCard: { overflow: 'hidden', borderRadius: 28, backgroundColor: '#14272F', borderWidth: 1, borderColor: '#34534F' },
  photoStage: { height: 390, backgroundColor: '#101B22', position: 'relative', overflow: 'hidden' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 25, gap: 14 },
  faceIcon: { width: 104, height: 104, borderRadius: 31, backgroundColor: '#1D3D40', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#427669' },
  emptyTitle: { fontSize: 20, lineHeight: 29, fontWeight: '800', color: '#FFF', textAlign: 'center' },
  emptyHint: { color: '#A5C3BC', fontSize: 12, lineHeight: 24, textAlign: 'center' },
  faceBox: { position: 'absolute', borderWidth: 2, borderColor: '#61E8B5', borderRadius: 9 },
  faceTag: { backgroundColor: '#145C46', color: '#FFF', fontWeight: '800', fontSize: 12, paddingHorizontal: 6, paddingVertical: 2, alignSelf: 'flex-start', borderBottomRightRadius: 5 },
  photoCaption: { flexDirection: 'row', gap: 9, padding: 15, alignItems: 'flex-start' },
  caption: { color: '#A8C0B9', fontSize: 11, lineHeight: 21, flex: 1 },
  overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(10,28,33,0.86)', alignItems: 'center', justifyContent: 'center', gap: 16 },
  overlayText: { color: '#FFF', fontSize: 16, lineHeight: 26, fontWeight: '700', textAlign: 'center', paddingHorizontal: 20 },
  primary: { minHeight: 56, paddingVertical: 15, paddingHorizontal: 18, borderRadius: 18, backgroundColor: '#A5E6D0', flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 9 },
  primaryText: { color: '#173C34', fontSize: 14, lineHeight: 24, fontWeight: '800', flexShrink: 1, textAlign: 'center' },
  disabled: { opacity: 0.5 },
  secondary: { minHeight: 54, paddingVertical: 13, paddingHorizontal: 12, borderRadius: 17, backgroundColor: '#EDF5F1', flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8, flex: 1 },
  secondaryText: { color: '#275447', fontWeight: '800', fontSize: 12, lineHeight: 22, flexShrink: 1, textAlign: 'center' },
  sourceActions: { flexDirection: 'row', gap: 10 },
  retake: { paddingVertical: 12, alignItems: 'center' },
  retakeText: { color: '#86BCAF', fontSize: 13, lineHeight: 24, fontWeight: '700', textAlign: 'center' },
  notice: { color: '#79718D', fontSize: 12, lineHeight: 22 },
  errorBox: { backgroundColor: '#FCEAF0', borderWidth: 1, borderColor: '#F2C8D3', borderRadius: 18, padding: 15, flexDirection: 'row', gap: 10 },
  errorText: { color: '#AB3049', fontSize: 13, lineHeight: 23, flex: 1 },
  reportCard: { backgroundColor: '#F9FCFA', borderRadius: 26, padding: 20, borderWidth: 1, borderColor: '#DCE9E2', gap: 17 },
  reportHeading: { flexDirection: 'row', gap: 11, alignItems: 'center' },
  reportTitle: { color: '#25473B', fontSize: 18, lineHeight: 29, fontWeight: '800', flexShrink: 1 },
  reportStatus: { color: '#187B62', fontSize: 12, lineHeight: 22, marginTop: 3 },
  metricRow: { flexDirection: 'row', gap: 10 },
  metric: { backgroundColor: '#EEF5F1', borderRadius: 18, padding: 14, flex: 1 },
  metricValue: { color: '#246B53', fontSize: 26, fontWeight: '800' },
  metricLabel: { color: '#89809B', fontSize: 11, lineHeight: 19, marginTop: 4 },
  reportBody: { color: '#5C5570', fontSize: 13, lineHeight: 24 },
  limitCard: { backgroundColor: '#EDF3F0', borderRadius: 20, padding: 16, flexDirection: 'row', gap: 12 },
  selfCard: { borderRadius: 24, padding: 18, backgroundColor: '#FFF', borderWidth: 1, borderColor: '#E6E0F1' },
  selfHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  selfTitle: { color: '#423469', fontSize: 15, lineHeight: 25, fontWeight: '800', flex: 1 },
  fieldLabel: { color: '#4C406A', fontSize: 13, fontWeight: '700', lineHeight: 24, marginTop: 18, marginBottom: 8 },
  feelings: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  feeling: { paddingHorizontal: 13, paddingVertical: 10, borderRadius: 13, backgroundColor: '#F1EDF9', minHeight: 44 },
  feelingSelected: { backgroundColor: '#6333C4' },
  feelingText: { color: '#776890', fontSize: 12, fontWeight: '700', lineHeight: 22 },
  scoreInput: { minHeight: 56, borderWidth: 1, borderColor: '#D9CFEA', borderRadius: 16, color: '#503298', paddingHorizontal: 16, fontSize: 22, fontWeight: '800', marginTop: 12 },
  scoreChoices: { flexDirection: 'row', gap: 7, marginTop: 10 },
  scoreChoice: { flex: 1, minHeight: 44, paddingVertical: 10, backgroundColor: '#F1EDF9', borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  noteInput: { minHeight: 110, borderWidth: 1, borderColor: '#D9CFEA', borderRadius: 16, padding: 14, color: '#5C5570', fontSize: 13, textAlignVertical: 'top', lineHeight: 22, marginBottom: 14 },
  savedBox: { padding: 16, borderRadius: 18, backgroundColor: '#E8F7EF', gap: 6 },
  savedText: { color: '#187B62', fontSize: 14, lineHeight: 25, fontWeight: '700' },
  liveFaceBox: { position: 'absolute', borderWidth: 2, borderColor: '#58EDBC', borderRadius: 9 },
  uncertainBox: { borderColor: '#F4C883' },
  liveFaceTag: { backgroundColor: '#175B4E', color: '#FFF', fontWeight: '800', fontSize: 15, lineHeight: 24, paddingHorizontal: 7, alignSelf: 'flex-start', borderBottomRightRadius: 8 },
  landmarkDot: { position: 'absolute', width: 3, height: 3, borderRadius: 2, backgroundColor: '#8DFFDE' },
  liveBadge: { position: 'absolute', top: 14, left: 14, right: 14, paddingHorizontal: 13, paddingVertical: 9, backgroundColor: 'rgba(22,28,49,0.85)', borderRadius: 14, flexDirection: 'row', alignItems: 'center', gap: 9 },
  statusDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#58EDBC' },
  liveBadgeText: { color: '#F6FCFA', fontSize: 11, lineHeight: 20, fontWeight: '700', flex: 1 },
  liveResultPanel: { backgroundColor: '#112B30', paddingHorizontal: 16, paddingVertical: 15, gap: 9, borderTopWidth: 1, borderTopColor: '#35574F' },
  liveResultFace: { gap: 7, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#35574F' },
  liveLeadingScore: { color: '#EAD7A5', fontSize: 12, lineHeight: 23, fontWeight: '700' },
  liveReason: { color: '#B7CCC5', fontSize: 11, lineHeight: 22 },
  liveScoreTitle: { color: '#9DBAB0', fontSize: 10, lineHeight: 20, fontWeight: '700', marginTop: 2 },
  liveScoreList: { gap: 5 },
  liveScoreRow: { flexDirection: 'row', gap: 7, alignItems: 'center' },
  liveScoreLabel: { color: '#D2EAE0', fontSize: 11, lineHeight: 21, width: '45%' },
  liveScoreTrack: { flex: 1, height: 5, borderRadius: 4, overflow: 'hidden', backgroundColor: '#284740' },
  liveScoreFill: { height: 5, borderRadius: 4, backgroundColor: '#85DABD' },
  liveScorePercent: { color: '#D0EAE0', fontSize: 10, lineHeight: 20, width: 44, textAlign: 'right' },
  liveResultHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  liveResultTitle: { color: '#DDFBF0', fontSize: 11, lineHeight: 19, fontWeight: '800', flexShrink: 1 },
  liveResultStatus: { color: '#78DAB8', fontSize: 9, lineHeight: 18, flexShrink: 1 },
  liveResultRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  liveResultText: { color: '#F4FCF9', fontSize: 12, lineHeight: 23, fontWeight: '700', flexShrink: 1 },
  liveResultProbability: { color: '#80F2C9', fontSize: 11, lineHeight: 21, fontWeight: '800', maxWidth: '38%', textAlign: 'right', flexShrink: 1 },
  liveMetrics: { paddingTop: 5, borderTopWidth: 1, borderTopColor: '#35524E', flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  liveMetricText: { color: '#B6EBD9', fontSize: 10, lineHeight: 18, fontWeight: '600', flexShrink: 1 },
  localPrivacy: { padding: 13, backgroundColor: '#E5F6EE', borderRadius: 16, flexDirection: 'row', alignItems: 'flex-start', gap: 9 },
  localPrivacyText: { color: '#1B8065', fontSize: 12, lineHeight: 21, flexShrink: 1 },
  expressionCard: { padding: 14, backgroundColor: '#EEF5F0', borderRadius: 18, gap: 8 },
  expressionHeading: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  expressionEmoji: { fontSize: 32, lineHeight: 44 },
  expressionLabel: { color: '#315447', fontSize: 13, lineHeight: 23, fontWeight: '700' },
  probability: { color: '#187B62', fontSize: 17, fontWeight: '800', lineHeight: 27 },
  probabilityList: { gap: 7, marginTop: 4 },
  probabilityRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  probabilityEmoji: { fontSize: 15, width: 22 },
  probabilityLabel: { color: '#7E738E', fontSize: 9, lineHeight: 17, width: 91 },
  probabilityTrack: { height: 5, flex: 1, backgroundColor: '#DCE8E0', borderRadius: 4, overflow: 'hidden' },
  probabilityFill: { height: 5, backgroundColor: '#54B89D', borderRadius: 4 },
  probabilityPercent: { color: '#665C7A', fontSize: 10, lineHeight: 18, width: 43, textAlign: 'right' },
  cloudToggle: { width: 48, minHeight: 44, borderRadius: 14, backgroundColor: '#E1D9EF', padding: 5, justifyContent: 'center' },
  cloudToggleOn: { backgroundColor: '#5AA98F' },
  toggleThumb: { width: 24, height: 24, borderRadius: 11, backgroundColor: '#FFF', alignSelf: 'flex-start' },
  cloudSnapshot: { gap: 10, borderTopWidth: 1, borderTopColor: '#EEEAF4', paddingTop: 14 },
  cloudImage: { width: '100%', height: 180, backgroundColor: '#211C53', borderRadius: 17 },
  analyzedThumbnail: { position: 'absolute', right: 14, top: 66, width: 104, borderRadius: 13, overflow: 'hidden', zIndex: 20, borderWidth: 1, borderColor: '#BEEEDD', backgroundColor: '#15392F' },
  analyzedThumbnailImage: { width: 102, height: 112, backgroundColor: '#0C2821' },
  analyzedThumbnailBox: { position: 'absolute', borderWidth: 1, borderColor: '#A5E6D0', borderRadius: 3 },
  analyzedThumbnailFace: { color: '#FFF', backgroundColor: '#175B4E', fontSize: 8, lineHeight: 11, paddingHorizontal: 2, alignSelf: 'flex-start' },
  analyzedThumbnailText: { color: '#BEEEDD', fontSize: 9, lineHeight: 14, textAlign: 'center', fontWeight: '700', paddingHorizontal: 4, paddingVertical: 5 },
  studioHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#2B4948' },
  studioTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }, studioTitle: { color: '#D3EEE3', fontSize: 12, lineHeight: 22, fontWeight: '800', flexShrink: 1 },
  studioPill: { flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: '#24453F', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12, maxWidth: '48%' },
  studioPillText: { color: '#B5DCD0', fontSize: 10, lineHeight: 20, fontWeight: '700', flexShrink: 1 },
  studioMetrics: { flexDirection: 'row', paddingVertical: 16, borderTopWidth: 1, borderTopColor: '#2A4948' },
  studioMetric: { flex: 1, alignItems: 'center', paddingHorizontal: 8, gap: 5 }, studioMetricMiddle: { borderLeftWidth: 1, borderRightWidth: 1, borderColor: '#34534F' },
  studioMetricValue: { fontSize: 24, lineHeight: 32, fontWeight: '800', color: '#A5E6D0' }, studioMetricLabel: { fontSize: 9, lineHeight: 18, color: '#A2BCB3', textAlign: 'center' },
  qualityCard: { backgroundColor: '#F3F9F5', borderRadius: 25, padding: 20, borderWidth: 1, borderColor: '#D9E9DE', gap: 13 },
  qualityIcon: { width: 43, height: 43, borderRadius: 14, backgroundColor: '#E1F0E5', alignItems: 'center', justifyContent: 'center' },
  qualityRail: { flexDirection: 'row', backgroundColor: '#E8F2EB', borderRadius: 16, paddingVertical: 11 }, qualityMetric: { flex: 1, paddingHorizontal: 8, alignItems: 'center' },
  qualityValue: { color: '#28694F', fontSize: 22, lineHeight: 30, fontWeight: '800' }, qualityTip: { flexDirection: 'row', gap: 9, alignItems: 'flex-start' },
  qualityTipText: { color: '#547366', fontSize: 12, lineHeight: 22, flex: 1 }, qualityEvidence: { color: '#768C80', fontSize: 10, lineHeight: 20 },
});

export default LiveEmotionScreen;

