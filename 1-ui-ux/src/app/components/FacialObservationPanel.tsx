import { useEffect, useRef, useState } from 'react';
import { Activity, FileText, ShieldCheck } from 'lucide-react';
import type { TrackedLiveFrame } from '../../../../shared/liveFace';
import { createFacialObservationSession, getFacialObservationCopy, buildFacialObservationReport } from '../../../../shared/facialObservations';
import { FaceMonitoringGuide } from './FaceMonitoringGuide';

const metrics = ['leftEyeOpeningRatio', 'rightEyeOpeningRatio', 'mouthOpeningRatio', 'mouthCornerAsymmetryRatio', 'eyeLineRollDegrees'] as const;
const locale = (language:string) => language === 'ta' ? 'ta-LK' : language === 'si' ? 'si-LK' : 'en-GB';
const timeText = (value:string|null, language:string, unknown:string) => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleTimeString(locale(language)) : unknown;

// This is a consumer of the existing completed camera frames, not a second model.
// It keeps no face image, patient identity or persistent biometric calibration.
export function FacialObservationPanel({frame, language, photo=false, active=false}:{frame:TrackedLiveFrame|null;language:string;photo?:boolean;active?:boolean}) {
  const session = useRef(createFacialObservationSession());
  const [snapshot,setSnapshot] = useState(()=>session.current.reset());
  const [consent,setConsent] = useState(false);
  const [exportError,setExportError] = useState(false);
  const priorMode = useRef(photo);
  const t = getFacialObservationCopy(language);
  useEffect(()=>{
    if(priorMode.current !== photo){session.current.reset();setConsent(false);priorMode.current=photo;}
    if(photo)session.current.reset();
    setSnapshot(frame ? session.current.update(frame) : session.current.reset());
    setExportError(false);
  },[frame,photo]);
  useEffect(()=>()=>{session.current.reset();},[]);
  // A previous sample must not flash as current while the next effect is pending.
  const current = frame && snapshot.capturedAt === frame.capturedAt ? snapshot : null;
  const state = current?.state ?? 'unavailable';
  const repeated = state === 'repeated-change';
  const explanation = repeated ? t.changedExplanation : state === 'no-significant-change' ? t.noChangeExplanation : state === 'observing' ? t.observingExplanation : null;
  const calibrationAllowed = !photo && !!current?.metrics && state!=='unavailable' && !current?.qualityReasons.includes('sampled-only');
  function calibrate(){if(consent && calibrationAllowed)setSnapshot(session.current.startBaseline({consent:true}));}
  function deleteCalibration(){setSnapshot(session.current.resetBaseline());setConsent(false);}
  function clearObservations(){setSnapshot(session.current.reset());setConsent(false);setExportError(false);}
  function downloadObservations(){
    if(!current)return;
    try{
      const lines = [buildFacialObservationReport(current,language), '', t.timeline];
      current.history.forEach(entry=>{
        lines.push(new Date(entry.capturedAt).toISOString()+' · '+t.states[entry.state]);
        for(const key of metrics){const value=entry.metrics[key];if(Number.isFinite(value))lines.push(t.metrics[key]+': '+value.toFixed(3)+' '+(key==='eyeLineRollDegrees'?t.degreesUnit:t.ratioUnit));}
      });
      const url=URL.createObjectURL(new Blob(['\ufeff'+lines.join('\n')],{type:'text/plain;charset=utf-8'}));
      try{const anchor=document.createElement('a');anchor.href=url;anchor.download='CareConnect-Facial-Observations-'+language+'.txt';document.body.appendChild(anchor);try{anchor.click();}finally{anchor.remove();}}
      finally{setTimeout(()=>URL.revokeObjectURL(url),1000);}
      setExportError(false);
    }catch{setExportError(true);}
  }
  return <section data-testid="facial-observation-panel" className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm" aria-label={t.title}>
    <div className="flex items-start gap-3 border-b border-slate-100 bg-gradient-to-br from-[#0B1730] to-[#123c46] p-4 text-white"><Activity className="mt-0.5 h-5 w-5 shrink-0 text-cyan-300"/><div className="min-w-0"><h3 className="text-sm font-bold">{t.title}</h3><p className="mt-1 text-[11px] leading-relaxed text-slate-300">{t.notice}</p></div></div>
    <div className="space-y-4 p-4">
      <div className={'rounded-xl border p-3 text-xs font-semibold leading-relaxed '+(repeated?'border-amber-200 bg-amber-50 text-amber-900':state==='unavailable'?'border-slate-200 bg-slate-50 text-slate-600':'border-teal-100 bg-teal-50 text-teal-900')} role="status" aria-live="polite">{t.states[state]}</div>
      {explanation&&<p className="text-xs leading-relaxed text-slate-600">{explanation}</p>}
      {repeated&&<p className="rounded-xl bg-amber-50 p-3 text-xs leading-relaxed text-amber-900">{t.checkInSuggested}</p>}
      {current?.qualityReasons.length ? <ul className="space-y-2 text-xs text-slate-600">{current.qualityReasons.map(reason=><li key={reason}>• {t.reasons[reason]}</li>)}</ul> : null}
      <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">{metrics.map(key=><div key={key} className="min-w-0 rounded-xl border border-slate-100 bg-slate-50/70 p-3"><dt className="text-[10px] leading-relaxed text-slate-500">{t.metrics[key]}</dt><dd className="mt-1 font-semibold tabular-nums text-slate-800">{current?.metrics && state!=='unavailable' ? current.metrics[key].toFixed(3) : '—'} <span className="text-[10px] font-normal text-slate-500">{key==='eyeLineRollDegrees'?t.degreesUnit:t.ratioUnit}</span></dd></div>)}</dl>
      <div className="space-y-1 text-[10px] leading-relaxed text-slate-500"><p>{t.captureTime}: {timeText(current?.capturedAt??null,language,t.unknown)}</p><p>{t.completionTime}: {timeText(current?.completedAt??null,language,t.unknown)}</p><p>{t.samples}: {current?.sampleCount??0} · {t.samplingGap}: {current?.samplingGapMs == null?'—':Math.round(current.samplingGapMs)+' ms'}</p><p>{current?.temporalContinuity==='sparse'?t.sparseNotice:t.sampledNotice}</p></div>
      {!photo&&<details className="rounded-xl border border-slate-200 p-3"><summary className="cursor-pointer text-xs font-semibold text-slate-700">{t.baseline}: {t.baselineStatuses[current?.baseline.status??'off']}</summary><p className="mt-2 text-[11px] leading-relaxed text-slate-500">{current?.baseline.status==='ready'?t.baselineComparison:t.noBaseline}</p><p className="mt-2 text-[11px] text-slate-500">{t.baselineProgress}: {current?.baseline.sampleCount??0} · ≥{current?.baseline.requiredSamples??8}</p>{current?.baseline.reason==='tracking-reset'&&<p className="mt-2 text-xs text-amber-800">{t.baselineResetReason}</p>}{current?.baseline.reason==='unstable-samples'&&<p className="mt-2 text-xs text-amber-800">{t.baselineUnstable}</p>}
        <label className="mt-3 flex items-start gap-2 text-[11px] leading-relaxed text-slate-600"><input type="checkbox" checked={consent} onChange={event=>setConsent(event.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 accent-teal-700"/>{t.baselineConsent}</label>
        <div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={calibrate} disabled={!consent||!calibrationAllowed||current?.baseline.status==='collecting'} className="rounded-lg bg-teal-700 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40">{t.baselineStart}</button><button type="button" onClick={deleteCalibration} className="rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-600">{t.baselineReset}</button></div>
      </details>}
      {current?.history.length ? <details className="rounded-xl border border-slate-200 p-3"><summary className="cursor-pointer text-xs font-semibold text-slate-700">{t.timeline} · {current.history.length}</summary><ol className="mt-3 max-h-44 space-y-2 overflow-y-auto text-[11px] text-slate-600">{current.history.slice(-12).reverse().map(entry=><li key={entry.capturedAt} className="border-l-2 border-teal-200 pl-3"><time dateTime={entry.capturedAt} className="font-medium tabular-nums">{timeText(entry.capturedAt,language,t.unknown)}</time><p className="mt-0.5">{t.states[entry.state]}</p>{entry.changedMetrics.map(key=><p key={key} className="text-amber-800">{t.metrics[key]}</p>)}</li>)}</ol></details> : null}
      <div className="flex flex-wrap gap-2"><button type="button" onClick={downloadObservations} disabled={!current} className="inline-flex items-center gap-1.5 rounded-lg border border-teal-200 bg-teal-50 px-3 py-2 text-xs font-semibold text-teal-800 disabled:opacity-40"><FileText className="h-3.5 w-3.5"/>{t.downloadReport}</button><button type="button" onClick={clearObservations} className="rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-600">{t.clearSession}</button></div>
      {exportError&&<p role="alert" className="text-xs text-rose-800">{t.downloadFailed}</p>}
      <FaceMonitoringGuide language={language} active={active}/>
      <div className="border-t border-slate-100 pt-3 text-[11px] leading-relaxed text-slate-500"><p>{t.notHealth}</p><p className="mt-2 flex gap-2"><ShieldCheck className="h-4 w-4 shrink-0 text-teal-700"/>{t.privacy}</p></div>
    </div>
  </section>;
}
