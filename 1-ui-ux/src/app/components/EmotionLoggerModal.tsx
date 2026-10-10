import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { AlertCircle, Camera, CheckCircle2, FileText, Loader2, RefreshCw, Send, Upload, X } from 'lucide-react';
import { Resident } from '../models/Resident';
import { EmotionalState } from '../models/EmotionalState';
import { auth } from '../firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { emotionsApi } from '../services/apiService';
import { faceReportHTML, photoFromCanvas, photoFromFile } from '../services/faceImage';
import type { FacePhoto } from '../services/faceImage';
import { FACE_LANGUAGES, buildFaceReportText, validateFaceReport } from '../../../../shared/faceReport';
import type { FaceLanguage, FaceReport } from '../../../../shared/faceReport';
import { getLiveFaceCopy, buildLiveReportText, getCloudExpressionDisplay } from '../../../../shared/liveFace';
import type { TrackedLiveFrame } from '../../../../shared/liveFace';
import { startLiveFaceDetection, analyzeFacePhoto } from '../ml/live/LiveFaceSession';
import { FaceOverlay, LiveFaceResults, LiveResultStrip } from './LiveFacePanel';
import { FaceQualityPanel } from './FaceQualityPanel';
import { FaceCareHelpPanel } from './FaceCareHelpPanel';
import { ExperimentalWellnessReview } from './ExperimentalWellnessReview';
import { isFaceFrameStale, useFaceFrameClock } from './useFaceFrameClock';
import { getFaceProviderStatusCopy, validateFaceProviderStatus } from '../../../../shared/faceProviderStatus';
import type { FaceProviderUiState } from '../../../../shared/faceProviderStatus';

interface EmotionLoggerModalProps {
  resident: Resident;
  onClose: () => void;
  onLogged: () => void;
}

const primary = 'inline-flex items-center justify-center gap-2 rounded-xl bg-teal-700 px-4 py-3 font-semibold text-white hover:bg-teal-800 disabled:opacity-40 disabled:cursor-not-allowed';
const secondary = 'inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40';
const feelings = ['Happy', 'Sad', 'Angry', 'Anxious', 'Neutral'] as const;

// The component name stays compatible with existing dashboard imports.
// Experimental scores require a captured frame and explicit patient review.
export function EmotionLoggerModal({ resident, onClose, onLogged }: EmotionLoggerModalProps) {
  const [language, setLanguage] = useState<FaceLanguage>('en');
  const [photo, setPhoto] = useState<FacePhoto | null>(null);
  const [report, setReport] = useState<FaceReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState(false);
  const [error, setError] = useState('');
  const [feeling, setFeeling] = useState('');
  const [score, setScore] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const [medicine, setMedicine] = useState('');
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const mounted = useRef(true);
  const sequence = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const context = useRef('');
  const currentUid = auth.currentUser?.uid || '';
  context.current = currentUid + ':' + resident.residentId;
  const observationId = useRef<string | null>(null);
  const saveLock = useRef(false);
  const cameraGeneration = useRef(0);
  const [liveFrame, setLiveFrame] = useState<(TrackedLiveFrame & {fps?:number}) | null>(null);
  const [localPhotoFrame, setLocalPhotoFrame] = useState<TrackedLiveFrame | null>(null);
  const [liveStatus, setLiveStatus] = useState('loading');
  const [cameraEnabled, setCameraEnabled] = useState(true);
  const [points, setPoints] = useState(true);
  const [detector, setDetector] = useState<'tiny'|'ssd'>('tiny');
  const [cloudAssist, setCloudAssist] = useState(false);
  const [cloudSample, setCloudSample] = useState<{photo:FacePhoto;report:FaceReport}|null>(null);
  const [cameraAspect, setCameraAspect] = useState(4/3);
  const liveAbort = useRef<AbortController | null>(null);
  const localGeneration = useRef(0);
  const cloudGeneration = useRef(0);
  const cloudAbort = useRef<AbortController | null>(null);
  const photoAbort = useRef<AbortController | null>(null);
  const cloudNextAt = useRef(0);
  const dialogRef = useRef<HTMLElement | null>(null);
  const liveRate = useRef<{at:number;fps:number|null}|null>(null);
  const liveBackend=useRef<string|undefined>(undefined);
  const [providerState, setProviderState] = useState<FaceProviderUiState>('checking');
  const [providerRetry, setProviderRetry] = useState(0);
  const providerAbort = useRef<AbortController | null>(null);
  const providerTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const now = useFaceFrameClock(cameraEnabled && !photo && !!currentUid);
  const t = getLiveFaceCopy(language);
  const providerCopy = getFaceProviderStatusCopy(language);
  const cloudAllowed = providerState === 'available' || providerState === 'unavailable';
  const staleLiveFrame = !!liveFrame && isFaceFrameStale(liveFrame, now);
  const freshLiveFrame = cameraEnabled && cameraReady && liveStatus === 'running' && !staleLiveFrame ? liveFrame : null;
  const isCurrent = (id: number, session: string) => mounted.current && id === sequence.current &&
    context.current === session && session === (auth.currentUser?.uid || '') + ':' + resident.residentId;

  function stopCamera() {
    liveAbort.current?.abort();
    cloudAbort.current?.abort();
    cloudGeneration.current += 1;
    cameraGeneration.current += 1;
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }

  async function startCamera() {
    stopCamera();
    const id = cameraGeneration.current;
    const session = context.current;
    setCameraReady(false);
    setCameraError(false);
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('camera');
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 960 } }, audio: false,
      });
      if (!mounted.current || id !== cameraGeneration.current || context.current !== session ||
          session !== (auth.currentUser?.uid || '') + ':' + resident.residentId) {
        stream.getTracks().forEach(track => track.stop());
        return;
      }
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      if (mounted.current && id === cameraGeneration.current) setCameraReady(true);
    } catch {
      if (mounted.current && id === cameraGeneration.current) setCameraError(true);
    }
  }

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      sequence.current += 1;
      controller.current?.abort();
      photoAbort.current?.abort();
      providerAbort.current?.abort();
      if (providerTimeout.current !== null) clearTimeout(providerTimeout.current);
      stopCamera();
    };
  }, []);
  useEffect(() => {
    sequence.current += 1;
    controller.current?.abort();
    setReport(null);
    setPhoto(null);
    setError('');
    setScore(null);
    setFeeling('');
    setNote('');
    setMedicine('');
    setSaved(false);
    setBusy(false);
    setCloudAssist(false);
    setCloudSample(null);
    setLocalPhotoFrame(null);
    setLiveFrame(null);
    setCameraEnabled(true);
    observationId.current = null;
  }, [resident.residentId, currentUid]);
  useEffect(() => {
    if (!photo && cameraEnabled) void startCamera();
    return stopCamera;
  }, [photo, cameraEnabled, resident.residentId, currentUid]);
  useEffect(() => {
    const abort = new AbortController();
    liveAbort.current = abort;
    const session = context.current;
    setLiveFrame(null);
    liveRate.current=null;
    liveBackend.current=undefined;
    if (photo || !cameraEnabled || !cameraReady || !videoRef.current) return () => abort.abort();
    void startLiveFaceDetection(videoRef.current, frame => {
      if (!abort.signal.aborted && mounted.current && context.current === session &&
          session === (auth.currentUser?.uid || '') + ':' + resident.residentId) {
        const at=performance.now(), previous=liveRate.current;
        const sample=previous&&at>previous.at?1000/(at-previous.at):null;
        const fps=sample===null?null:previous?.fps==null?sample:previous.fps*.7+sample*.3;
        liveRate.current={at,fps};
        setLiveFrame({...frame,fps:fps??undefined});
      }
    }, status => {
      if (!abort.signal.aborted && mounted.current && context.current===session) {
        setLiveStatus(status.state);
        if(status.backend)liveBackend.current=status.backend;
        if (status.state==='unavailable'||status.state==='stopped') {setLiveFrame(null);liveRate.current=null;}
      }
    }, {signal:abort.signal,detector});
    return () => abort.abort();
  }, [photo, cameraReady, cameraEnabled, detector, currentUid, resident.residentId]);
  useEffect(() => {
    const id = ++localGeneration.current;
    const abort = new AbortController();photoAbort.current=abort;
    const session = context.current;
    setLocalPhotoFrame(null);
    if (!photo) return;
    setLiveStatus('loading');
    void analyzeFacePhoto(photo.dataUrl,'ssd',{signal:abort.signal,capturedAt:photo.capturedAt}).then(frame => {
      if (mounted.current && localGeneration.current === id && context.current === session &&
          session === (auth.currentUser?.uid || '') + ':' + resident.residentId) {setLocalPhotoFrame(frame);setLiveStatus('running');}
    }).catch(() => {if (mounted.current && localGeneration.current === id) setLiveStatus('unavailable');});
    return () => {localGeneration.current += 1;abort.abort();};
  }, [photo, currentUid, resident.residentId]);
  useEffect(() => {
    const generation = ++cloudGeneration.current;
    let timer: ReturnType<typeof setTimeout>;
    let cancelled = false;
    const session = context.current;
    const current = () => !cancelled && mounted.current && cloudGeneration.current === generation && context.current === session &&
      session === (auth.currentUser?.uid || '') + ':' + resident.residentId;
    if (!cloudAssist || !cloudAllowed || photo || !cameraEnabled || !cameraReady || !currentUid) return;
    const sample = async () => {
      if (!current()) return;
      if (Date.now()<cloudNextAt.current) {timer=setTimeout(sample,cloudNextAt.current-Date.now());return;}
      const video = videoRef.current;
      if (document.hidden || !video || video.readyState < 2) {timer=setTimeout(sample,15000);return;}
      const abort = new AbortController();cloudAbort.current=abort;
      cloudNextAt.current=Date.now()+15000;
      const timeout=setTimeout(()=>abort.abort(),25000);
      let delay=15000;
      try {
        const selected=photoFromCanvas(video,video.videoWidth,video.videoHeight);
        const result=validateFaceReport(await emotionsApi.analyzeImage(selected.dataUrl,{signal:abort.signal}));
        if (result.image.width !== selected.width || result.image.height !== selected.height) throw Error('FACE_UNAVAILABLE');
        if (current()) setCloudSample({photo:selected,report:result});
      } catch (failure:any) {
        if (current() && !abort.signal.aborted) {
          setError(failure?.status === 429 ? 'rateLimit' : failure?.errorCode || 'FACE_UNAVAILABLE');
          delay=failure?.status === 429 ? 60000 : 30000;
          cloudNextAt.current=Date.now()+delay;
          if (failure?.errorCode === 'FACE_NOT_CONFIGURED' || failure?.status === 401) setCloudAssist(false);
        }
      } finally {clearTimeout(timeout);if(current())timer=setTimeout(sample,delay);}
    };
    void sample();
    return () => {cancelled=true;clearTimeout(timer);cloudAbort.current?.abort();};
  }, [cloudAssist, cloudAllowed, photo, cameraEnabled, cameraReady, currentUid, resident.residentId]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialogRef.current?.querySelector<HTMLElement>('select')?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') handleClose();
      if (event.key === 'Tab' && dialogRef.current) {
        const items=Array.from(dialogRef.current.querySelectorAll<HTMLElement>('button:not(:disabled),select:not(:disabled),input:not(:disabled),textarea:not(:disabled),summary')).filter(item=>item.getClientRects().length>0);
        const first=items[0],last=items[items.length-1];
        if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
        else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
      }
    };
    window.addEventListener('keydown', keydown);
    return () => {window.removeEventListener('keydown', keydown);previous?.focus();};
  }, []);

  useEffect(() => {
    const abort = new AbortController();
    providerAbort.current = abort;
    const session = context.current, uid = currentUid;
    const current = () => !abort.signal.aborted && mounted.current && context.current === session && auth.currentUser?.uid === uid;
    setProviderState(uid ? 'checking' : 'unavailable');
    setCloudAssist(false);
    if (!uid) return () => abort.abort();
    const timeout = setTimeout(() => {
      if (current()) { setProviderState('unavailable'); setCloudAssist(false); }
      abort.abort();
    }, 10000);
    providerTimeout.current = timeout;
    const unsubscribe = onAuthStateChanged(auth, user => {
      if (user?.uid === uid) return;
      abort.abort(); clearTimeout(timeout); cloudAbort.current?.abort();
      if (mounted.current && context.current === session) {
        setProviderState('unavailable'); setCloudAssist(false); setLiveFrame(null); setCloudSample(null);
      }
    });
    void (async () => {
      try {
        const status = validateFaceProviderStatus(await emotionsApi.faceStatus({ signal: abort.signal }));
        if (current()) { setProviderState(status.configurationState); if (status.configurationState !== 'available') setCloudAssist(false); }
      } catch { if (current()) setProviderState('unavailable'); }
      finally { clearTimeout(timeout); if (providerTimeout.current === timeout) providerTimeout.current = null; }
    })();
    return () => { unsubscribe(); clearTimeout(timeout); abort.abort(); if (providerTimeout.current === timeout) providerTimeout.current = null; };
  }, [currentUid, resident.residentId, providerRetry]);

  function handleClose() {
    mounted.current = false;
    photoAbort.current?.abort();
    sequence.current += 1;
    controller.current?.abort();
    providerAbort.current?.abort();
    if (providerTimeout.current !== null) clearTimeout(providerTimeout.current);
    stopCamera();
    onClose();
  }

  function handleCapture() {
    const video = videoRef.current;
    if (!video || !cameraReady || video.readyState < 2 || !video.videoWidth) {
      setError('camera');
      return;
    }
    try {
      const captured = photoFromCanvas(video, video.videoWidth, video.videoHeight);
      sequence.current += 1;
      controller.current?.abort();
      setPhoto(captured);
      setReport(null);
      setError('');
      stopCamera();
    } catch { setError('INVALID_IMAGE'); }
  }

  async function handleUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const id = ++sequence.current;
    const session = context.current;
    controller.current?.abort();
    setBusy(true);
    setReport(null);
    setPhoto(null);
    setError('');
    try {
      const selected = await photoFromFile(file);
      if (!isCurrent(id, session)) return;
      setPhoto(selected);
      stopCamera();
    } catch {
      if (isCurrent(id, session)) setError('INVALID_IMAGE');
    } finally {
      if (isCurrent(id, session)) setBusy(false);
    }
  }

  async function handleAnalyze() {
    if (!photo || busy || !cloudAllowed || !currentUid || auth.currentUser?.uid !== currentUid) return;
    const selected = photo;
    const id = ++sequence.current;
    const session = context.current;
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    setError('');
    setReport(null);
    try {
      const result = validateFaceReport(await emotionsApi.analyzeImage(selected.dataUrl, { signal: abort.signal }));
      if (!isCurrent(id, session)) return;
      if (result.image.width !== selected.width || result.image.height !== selected.height) throw new Error('FACE_UNAVAILABLE');
      setReport(result);
    } catch (failure: any) {
      if (isCurrent(id, session) && !abort.signal.aborted) {
        setError(failure?.status === 429 ? 'rateLimit' : failure?.errorCode || 'FACE_UNAVAILABLE');
      }
    } finally {
      if (isCurrent(id, session)) setBusy(false);
    }
  }

  function handleRetake() {
    sequence.current += 1;
    controller.current?.abort();
    setBusy(false);
    setPhoto(null);
    setReport(null);
    setError('');
  }

  function handleDownload() {
    if (!photo || (!report && !localPhotoFrame)) return;
    const text = [localPhotoFrame ? buildLiveReportText(localPhotoFrame,language) : '', report ? buildFaceReportText(report, language) : '', t.capturedAt + ': ' + new Date(photo.capturedAt).toLocaleString(language === 'si' ? 'si-LK' : language === 'ta' ? 'ta-LK' : 'en-GB')].filter(Boolean).join('\n\n');
    const html = faceReportHTML(photo, text, (localPhotoFrame?.faces || report!.faces).map(face => face.box), language);
    const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'CareConnect-face-report-' + language + '-' + photo.capturedAt.slice(0,10) + '.html';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function handleDownloadLive() {
    // Recheck wall-clock age at the action, even if a browser delays a render.
    if (!freshLiveFrame || photo || !currentUid || auth.currentUser?.uid !== currentUid ||
        isFaceFrameStale(freshLiveFrame, Date.now())) return;
    const text = buildLiveReportText(freshLiveFrame, language);
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url;
    link.download = 'CareConnect-live-face-report-' + language + '-' + freshLiveFrame.capturedAt.slice(0, 10) + '.txt';
    link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function changeCheckIn(update: () => void) {
    update();
    observationId.current = null;
    setSaved(false);
  }

  async function handleSubmit() {
    if (score === null || !Number.isInteger(score) || score < 0 || score > 100 || saveLock.current || saved) return;
    saveLock.current = true;
    const session = context.current;
    const residentAtStart = resident;
    const chosenScore = score;
    const id = observationId.current || crypto.randomUUID();
    observationId.current = id;
    setSaving(true);
    setError('');
    try {
      await emotionsApi.record({
        observationId: id, residentId: resident.residentId, stateScore: chosenScore,
        emotionLabel: 'Self-reported',
        category: chosenScore > 50 ? 'positive' : chosenScore < 50 ? 'negative' : 'neutral',
        relatedMedicine: medicine || null,
        note: '[Self-reported]' + (feeling ? ' Feeling: ' + feeling + '.' : '') + (note.trim() ? ' ' + note.trim() : ''),
      });
      if (!mounted.current || context.current !== session || session !== (auth.currentUser?.uid || '') + ':' + residentAtStart.residentId) return;
      residentAtStart.addEmotionalState(new EmotionalState(new Date(), chosenScore));
      setSaved(true);
      onLogged();
    } catch {
      if (mounted.current && context.current === session) setError('save');
    } finally {
      saveLock.current = false;
      if (mounted.current && context.current === session) setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#030f17]/80 p-2 backdrop-blur-sm sm:p-5">
      <section ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="face-title" lang={language} className="flex max-h-[96vh] w-full max-w-6xl flex-col overflow-hidden rounded-3xl border border-white/10 bg-[#f3f7f6] shadow-2xl">
        <header className="relative flex flex-wrap items-center gap-3 border-b border-white/10 bg-[#091b24] py-5 pl-5 pr-14 text-white sm:pl-7">
          <div className="mr-auto min-w-0">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.25em] text-emerald-300">CareConnect</p>
            <h2 id="face-title" className="text-xl font-bold tracking-tight sm:text-2xl">{t.studio}</h2>
            <p className="mt-1 text-xs leading-relaxed text-slate-300">{t.studioSubtitle}</p>
          </div>
          <select aria-label={t.language} value={language} onChange={event => setLanguage(event.target.value as FaceLanguage)} className="rounded-xl border border-white/20 bg-white/5 px-3 py-2 text-xs text-white [&>option]:bg-slate-900">
            {FACE_LANGUAGES.map(item => <option key={item.code} value={item.code}>{item.label}</option>)}
          </select>
          <button aria-label={t.close} onClick={handleClose} className="absolute right-3 top-4 rounded-full p-2 hover:bg-white/20"><X className="h-5 w-5" /></button>
        </header>
        <div className="overflow-y-auto p-4 sm:p-6">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs"><span className="text-slate-500">{t.patientContext} <strong className="ml-2 text-slate-900">{resident.name}</strong></span><span className="text-emerald-800">{t.localProcessing}</span></div>
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
            <div className="min-w-0 space-y-4">
              <div className="overflow-hidden rounded-2xl border border-[#22434b] bg-[#091b24] shadow-sm">
                <div className="flex items-center justify-between gap-2 border-b border-white/10 px-4 py-3"><span className="text-[11px] font-semibold text-slate-200">{photo?t.preview:t.camera}</span><span className="text-[10px] font-medium text-emerald-300">{photo?t.localPhoto:t.live}</span></div>
                {photo ? (
                  <div className="relative" style={{ aspectRatio: photo.width + '/' + photo.height }}>
                    <img src={photo.dataUrl} alt={t.preview} className="block h-full w-full" />
                    <FaceOverlay frame={localPhotoFrame} points={points} />
                    {!localPhotoFrame && report?.faces.map((face, index) => <div key={index} className="pointer-events-none absolute rounded border-2 border-teal-300" style={{ left: face.box.x*100+'%', top: face.box.y*100+'%', width: face.box.width*100+'%', height: face.box.height*100+'%' }}>
                      <span className="absolute left-0 top-0 rounded-br bg-teal-700 px-1.5 py-0.5 text-xs text-white">{index+1}</span>
                    </div>)}
                  </div>
                ) : (
                  <div className="relative" style={{aspectRatio:cameraAspect}}>
                    <video ref={videoRef} autoPlay playsInline muted onLoadedData={() => {setCameraReady(true);if(videoRef.current?.videoWidth)setCameraAspect(videoRef.current.videoWidth/videoRef.current.videoHeight);}} className="h-full w-full object-contain" style={{ transform:'scaleX(-1)' }} />
                    <FaceOverlay frame={freshLiveFrame} mirror points={points} />
                    <div className="absolute left-3 top-3 max-w-[calc(100%-1.5rem)] flex items-center gap-2 rounded-full border border-white/10 bg-slate-950/75 px-3 py-1.5 text-xs font-semibold text-white"><span className={'h-1.5 w-1.5 shrink-0 rounded-full '+(cameraEnabled&&liveStatus==='running'&&!staleLiveFrame?'bg-emerald-400':'bg-amber-400')} />{cameraEnabled ? liveStatus === 'loading' ? t.modelLoading : liveStatus==='unavailable'?t.liveError:staleLiveFrame?t.waitingFresh:t.live : t.paused}</div>
                    {!cameraReady && <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-slate-900/85 px-6 text-center text-sm text-white">
                      {cameraError ? <Camera className="h-9 w-9 text-teal-200" /> : <Loader2 className="h-8 w-8 animate-spin" />}
                      <p>{!cameraEnabled ? t.paused : cameraError ? t.errors.camera : t.cameraHint}</p>
                    </div>}
                  </div>
                )}
                {!photo&&<LiveResultStrip frame={freshLiveFrame} language={language} active={cameraEnabled&&cameraReady&&liveStatus==='running'} loading={liveStatus==='loading'&&cameraEnabled} stale={staleLiveFrame} fps={freshLiveFrame?.fps}/>}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
                {!photo && <button onClick={() => {if(cameraEnabled){stopCamera();setCameraReady(false);setLiveFrame(null);}setCameraEnabled(!cameraEnabled);}} className="font-semibold text-teal-700">{cameraEnabled?t.stopCamera:t.startCamera}</button>}
                <label className="flex items-center gap-2"><input type="checkbox" checked={points} onChange={e=>setPoints(e.target.checked)} className="accent-teal-700" />{t.showLandmarks}</label>
                {!photo && <label className="flex items-center gap-2">{t.detectorMode}<select value={detector} onChange={e=>setDetector(e.target.value as 'tiny'|'ssd')} className="max-w-36 rounded-lg bg-slate-50 p-2"><option value="tiny">{t.balanced}</option><option value="ssd">{t.enhanced}</option></select></label>}
              </div>
              <input ref={fileRef} type="file" accept="image/jpeg,image/png" onChange={handleUpload} className="hidden" aria-label={t.upload} />
              <div className="grid grid-cols-2 gap-2">
                {photo ? <>
                  <button onClick={handleAnalyze} disabled={busy || !!report || !cloudAllowed} className={primary}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}{busy ? t.analyzing : t.cloudPhoto}</button>
                  <button onClick={handleRetake} className={secondary}><RefreshCw className="h-4 w-4" />{t.retake}</button>
                </> : <>
                  <button onClick={handleCapture} disabled={!cameraReady || busy} className={primary}><Camera className="h-4 w-4" />{t.capture}</button>
                  <button onClick={() => fileRef.current?.click()} disabled={busy} className={secondary}><Upload className="h-4 w-4" />{t.upload}</button>
                </>}
              </div>
              {cameraError && !photo && <button onClick={startCamera} className="w-full text-sm font-medium text-teal-700">{t.retake}</button>}
              <p className="text-xs leading-relaxed text-slate-500">{photo?t.consent:t.qualityHint}</p>
              <FaceQualityPanel frame={photo?localPhotoFrame:liveFrame} language={language} fps={photo?undefined:liveFrame?.fps} backend={photo?undefined:liveBackend.current} photo={!!photo} now={now}/>
              <FaceCareHelpPanel key={currentUid+':'+resident.residentId} residentId={resident.residentId} residentName={resident.name} language={language}/>
              {!photo && <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <label className="flex items-center gap-3 text-sm font-bold text-slate-800"><input type="checkbox" checked={cloudAssist} disabled={!cloudAllowed} onChange={e=>{setCloudAssist(e.target.checked&&cloudAllowed);setError('');}} className="h-4 w-4 accent-teal-700 disabled:opacity-40" />{t.cloudAssist}</label>
                <p className="mt-2 text-xs leading-relaxed text-slate-500">{t.cloudConsent}</p>
              </div>}
              <div className="rounded-xl border border-slate-200 bg-white p-3 text-xs leading-relaxed text-slate-600">
                <p className="font-semibold text-slate-800">{providerCopy.title}</p>
                <p role="status" className="mt-1">{providerCopy.states[providerState]}</p>
                {providerState!=='checking'&&<button onClick={()=>setProviderRetry(value=>value+1)} className="mt-2 inline-flex items-center gap-1.5 font-semibold text-teal-700"><RefreshCw className="h-3.5 w-3.5"/>{t.retry}</button>}
              </div>
              {error && <div role="alert" className="flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-900"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{(t.errors as Record<string,string>)[error] || t.errors.FACE_UNAVAILABLE}</div>}
            </div>
            <div className="min-w-0 space-y-4">
              <LiveFaceResults frame={photo?localPhotoFrame:freshLiveFrame} language={language} loading={liveStatus==='loading'} photo={!!photo} stale={!photo&&staleLiveFrame} fps={freshLiveFrame?.fps} active={!photo&&cameraEnabled} />
              {!photo&&<button onClick={handleDownloadLive} disabled={!freshLiveFrame} className={secondary+' w-full'}><FileText className="h-4 w-4"/>{t.downloadReport}</button>}
              {liveStatus==='unavailable' && <p role="status" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">{t.modelUnavailable}</p>}
              {photo && localPhotoFrame && !report && <button onClick={handleDownload} className={secondary+' w-full'}><FileText className="h-4 w-4" />{t.downloadReport}</button>}
              <details open={!!report||!!cloudSample||cloudAssist} className="rounded-2xl border border-slate-200 bg-white p-4">
                <summary className="mb-3 cursor-pointer text-sm font-bold text-slate-800">{t.cloudReport}</summary>
                {report ? <>
                  <div className={'mb-4 rounded-xl p-3 text-sm font-semibold ' + (report.status === 'ready' ? 'bg-teal-50 text-teal-800' : 'bg-amber-50 text-amber-900')}>{report.status === 'ready' ? t.ready : t.retakeNeeded}</div>
                  <div className="mb-4 rounded-xl bg-slate-50 p-4"><span className="text-3xl font-bold text-teal-800">{report.faceCount}</span><span className="ml-2 text-sm text-slate-600">{t.faces}</span></div>
                  {report.issues.length > 0 && <ul className="mb-4 space-y-2 text-sm text-amber-900">{report.issues.map(issue => <li key={issue}>• {t.issues[issue]}</li>)}</ul>}
                  {report.faces.map((face, index) => <div key={index} className="mb-3 rounded-xl border border-slate-100 p-3">
                    <p className="mb-3 text-sm font-semibold">{getCloudExpressionDisplay(face.signals,language).emoji} {getCloudExpressionDisplay(face.signals,language).label} · {getCloudExpressionDisplay(face.signals,language).valueText}</p>
                    <div className="flex flex-wrap justify-between gap-2 text-sm"><strong>{t.face} {index+1}</strong><span>{t.confidence}: {(face.confidence*100).toFixed(1)}%</span></div>
                    <div className="my-3 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full bg-teal-600" style={{width:face.confidence*100+'%'}} /></div>
                    <dl className="space-y-1 text-xs text-slate-600">
                      <div className="flex justify-between"><dt>{t.quality.blur}</dt><dd>{t.likelihood[face.quality.blur]}</dd></div>
                      <div className="flex justify-between"><dt>{t.quality.underExposure}</dt><dd>{t.likelihood[face.quality.underExposure]}</dd></div>
                    </dl>
                    <details className="mt-3 text-xs"><summary className="cursor-pointer font-medium text-teal-700">{t.signalsTitle}</summary><p className="my-2 text-slate-500">{t.signalsHelp}</p>
                      <dl className="space-y-1">{(['joy','sorrow','anger','surprise'] as const).map(key => <div key={key} className="flex justify-between"><dt>{t.signals[key]}</dt><dd>{t.likelihood[face.signals[key]]}</dd></div>)}</dl>
                    </details>
                  </div>)}
                  <p className="mb-3 text-xs text-slate-500">{t.confidenceHelp}</p>
                  <p className="mb-4 text-xs text-slate-500">Google Cloud Vision · {new Date(report.analyzedAt).toLocaleString(language === 'ta' ? 'ta-LK' : language === 'si' ? 'si-LK' : 'en-GB')}</p>
                  <button onClick={handleDownload} className={secondary+' w-full'}><FileText className="h-4 w-4" />{t.download}</button>
                </> : cloudSample && !photo ? <>
                  <p className="mb-3 text-xs text-slate-500">{t.cloudLastChecked}: {new Date(cloudSample.report.analyzedAt).toLocaleTimeString(language)}</p>
                  <div className="relative mb-3 overflow-hidden rounded-xl" style={{aspectRatio:cloudSample.photo.width+'/'+cloudSample.photo.height}}><img alt={t.sampledPreview} src={cloudSample.photo.dataUrl} className="h-full w-full" />{cloudSample.report.faces.map((face,index)=><div key={index} className="absolute rounded border-2 border-teal-300" style={{left:face.box.x*100+'%',top:face.box.y*100+'%',width:face.box.width*100+'%',height:face.box.height*100+'%'}} />)}</div>
                  {cloudSample.report.faces.map((face,index)=>{const expression=getCloudExpressionDisplay(face.signals,language);return <p key={index} className="mb-2 text-sm text-slate-700">{t.face} {index+1} · {expression.emoji} {expression.label} · {expression.valueText}</p>;})}
                  <p className="text-xs text-slate-500">{t.likelihoodHelp}</p>
                </> : <p className="text-sm leading-relaxed text-slate-500">{busy ? t.analyzing : t.cloudWaiting}</p>}
              </details>
              <p className="rounded-xl bg-slate-50 p-4 text-xs leading-relaxed text-slate-600">{t.localPrivacy} {t.trackingHelp} {t.limitations}</p>
            </div>
          </div>
          <ExperimentalWellnessReview key={resident.residentId + ':' + currentUid} resident={resident} frame={photo ? localPhotoFrame : freshLiveFrame} captured={!!photo} onSaved={onLogged} />
          <details className="mt-6 rounded-2xl border border-teal-100 bg-teal-50/40 p-4 sm:p-5">
            <summary className="cursor-pointer font-bold text-teal-900">{t.selfReportTitle}</summary>
            <p className="my-3 text-sm text-slate-600">{t.selfReportHelp}</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="text-sm text-slate-700">{t.feeling}
                <select disabled={saving} value={feeling} onChange={event => changeCheckIn(() => setFeeling(event.target.value))} className="mt-1 block w-full rounded-xl border border-slate-200 bg-white p-3">
                  <option value="">—</option>{feelings.map(item => <option key={item} value={item}>{t.feelings[item]}</option>)}
                </select>
              </label>
              <label className="text-sm text-slate-700">{t.medicine}
                <select disabled={saving} value={medicine} onChange={event => changeCheckIn(() => setMedicine(event.target.value))} className="mt-1 block w-full rounded-xl border border-slate-200 bg-white p-3">
                  <option value="">{t.noMedicine}</option>{resident.getAllMedications().map((item,index) => <option key={index} value={item.drugName}>{item.drugName}</option>)}
                </select>
              </label>
            </div>
            <label className="mt-4 block text-sm font-semibold text-slate-700">{t.score}: {score === null ? '—' : score+'/100'}
              <input aria-label={t.score} type="range" min="0" max="100" step="1" value={score ?? 50} disabled={saving} onChange={event => changeCheckIn(() => setScore(Number(event.target.value)))} className="mt-3 w-full accent-teal-700" />
            </label>
            <div className="flex justify-between text-xs text-slate-500"><span>{t.scoreLow}</span><span>{t.scoreHigh}</span></div>
            <div className="mt-3 flex justify-between gap-2">{[0,25,50,75,100].map(value => <button key={value} disabled={saving} aria-label={t.score+' '+value} aria-pressed={score === value} onClick={() => changeCheckIn(() => setScore(value))} className={'min-w-10 rounded-lg border px-2 py-2 text-sm font-semibold '+(score === value ? 'border-teal-700 bg-teal-700 text-white' : 'border-slate-200 bg-white text-slate-600')}>{value}</button>)}</div>
            <label className="mt-4 block text-sm text-slate-700">{t.note}
              <textarea disabled={saving} value={note} maxLength={4500} onChange={event => changeCheckIn(() => setNote(event.target.value))} placeholder={t.notePlaceholder} className="mt-1 block w-full rounded-xl border border-slate-200 p-3" rows={2} />
            </label>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button onClick={handleSubmit} disabled={score === null || saving || saved} className={primary}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : saved ? <CheckCircle2 className="h-4 w-4" /> : <Send className="h-4 w-4" />}{saving ? t.saving : saved ? t.saved : t.save}</button>
              <p className="flex-1 text-xs text-slate-500">{saved ? t.saved : t.saveHelp}</p>
            </div>
          </details>
        </div>
      </section>
    </div>
  );
}
