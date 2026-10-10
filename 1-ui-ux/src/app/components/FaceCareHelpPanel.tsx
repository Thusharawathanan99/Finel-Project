import { useEffect, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, FileText, Loader2, Phone, Send } from 'lucide-react';
import { auth } from '../firebase';
import { sosApi } from '../services/apiService';
import { createUrgentRequestId } from '../../../../shared/urgentRequestId';
import { getLiveFaceCopy } from '../../../../shared/liveFace';
import { getFaceCareCopy, URGENT_HELP_NOTE_MAX_LENGTH, SRI_LANKA_AMBULANCE_TEL, FACE_CARE_SOURCES } from '../../../../shared/faceCare';
import { PATIENT_SYMPTOM_KEYS, getPatientSymptomsCopy, evaluatePatientSymptoms, buildPatientSymptomHelpMessage, buildPatientSymptomReport } from '../../../../shared/patientSymptoms';

// Urgent reports are deliberate patient/observer requests. Facial predictions
// never select symptoms, trigger this handler or identify the person on camera.
export function FaceCareHelpPanel({residentId,residentName,language}:{residentId:string;residentName:string;language:string}) {
  const [selected,setSelected]=useState<Array<typeof PATIENT_SYMPTOM_KEYS[number]>>([]);
  const [note,setNote]=useState('');
  const [state,setState]=useState<'idle'|'sending'|'saved'|'resolved'|'failed'>('idle');
  const [alertId,setAlertId]=useState<number|null>(null);
  const [reportError,setReportError]=useState(false);
  const mounted=useRef(true),lock=useRef(false),abort=useRef<AbortController|null>(null);
  const attempt=useRef<{session:string;message:string;requestId:string}|null>(null);
  const session=(auth.currentUser?.uid||'')+':'+residentId,owner=useRef(session);owner.current=session;
  const selectionOwner=useRef(session);
  const t=getFaceCareCopy(language);
  const symptomsCopy=getPatientSymptomsCopy(language);
  const assessment=evaluatePatientSymptoms(selected,language);
  const reportedAt=useRef<string|null>(null);
  useEffect(()=>{
    mounted.current=true;selectionOwner.current=session;setSelected([]);setNote('');setState('idle');setAlertId(null);setReportError(false);reportedAt.current=null;attempt.current=null;
    return()=>{mounted.current=false;abort.current?.abort();};
  },[session]);
  function changeSymptoms(key:typeof PATIENT_SYMPTOM_KEYS[number]) {
    if(lock.current)return;
    setSelected(previous=>previous.includes(key)?previous.filter(item=>item!==key):[...previous,key]);setState('idle');setAlertId(null);reportedAt.current=new Date().toISOString();setReportError(false);
  }
  function startNewUrgentHelp(){if(lock.current)return;attempt.current=null;setState('idle');setAlertId(null);}
  async function sendUrgentHelp() {
    if(lock.current||state==='saved'||state==='resolved')return;
    if(selectionOwner.current!==session||session!==(auth.currentUser?.uid||'')+':'+residentId){setSelected([]);setNote('');setAlertId(null);setState('idle');reportedAt.current=null;attempt.current=null;return;}
    if(!auth.currentUser?.uid){setState('failed');return;}
    const startedSession=session;
    const current=()=>mounted.current&&owner.current===startedSession&&startedSession===(auth.currentUser?.uid||'')+':'+residentId;
    lock.current=true;setState('sending');setAlertId(null);
    const controller=new AbortController();abort.current=controller;
    const timeout=setTimeout(()=>controller.abort(),15000);
    try {
      const message=buildPatientSymptomHelpMessage(selected,language,note);
      if(!reportedAt.current)reportedAt.current=new Date().toISOString();
      if(attempt.current?.session!==startedSession||attempt.current?.message!==message)attempt.current={session:startedSession,message,requestId:createUrgentRequestId()};
      // Bound the entire request, including token retrieval and response parsing.
      const deadline=new Promise<never>((_,reject)=>controller.signal.addEventListener('abort',()=>reject(Error('URGENT_REQUEST_TIMEOUT')),{once:true}));
      const response=await Promise.race([sosApi.create({residentId,message,requestId:attempt.current.requestId},{signal:controller.signal}),deadline]);
      if(!Number.isSafeInteger(response?.alertId)||response.alertId<1||response.saved!==true)throw Error('INVALID_SOS_RECEIPT');
      if(current()){setAlertId(response.alertId);setState(response.isResolved===true?'resolved':'saved');}
    } catch {if(current())setState('failed');}
    finally {clearTimeout(timeout);lock.current=false;if(abort.current===controller)abort.current=null;}
  }
  function downloadSymptomReport(){
    if(selectionOwner.current!==session||session!==(auth.currentUser?.uid||'')+':'+residentId){setSelected([]);setNote('');setAlertId(null);setState('idle');reportedAt.current=null;attempt.current=null;return;}
    try{
      const receipt=(state==='saved'||state==='resolved')&&alertId?{saved:true as const,alertId}:null;
      const text=buildPatientSymptomReport(selected,language,note,reportedAt.current,receipt)+(state==='resolved'?'\n'+symptomsCopy.resolvedMessage:'');
      const url=URL.createObjectURL(new Blob(['\ufeff'+text],{type:'text/plain;charset=utf-8'}));
      try{const anchor=document.createElement('a');anchor.href=url;anchor.download='CareConnect-Patient-Symptoms-'+language+'.txt';document.body.appendChild(anchor);try{anchor.click();}finally{anchor.remove();}}
      finally{setTimeout(()=>URL.revokeObjectURL(url),1000);}
      setReportError(false);
    }catch{setReportError(true);}
  }
  return <section className="overflow-hidden rounded-2xl border border-rose-200 bg-white" aria-label={t.title}>
    <div className="flex items-start gap-3 border-b border-rose-100 bg-rose-50/70 p-4"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-rose-100 text-rose-700"><AlertCircle className="h-5 w-5"/></span><div className="min-w-0"><h3 className="font-bold text-slate-900">{t.title}</h3><p className="mt-1 text-xs leading-relaxed text-slate-600">{t.description}</p></div></div>
    <div className="space-y-4 p-4">
      <p className="text-xs font-semibold text-slate-600">{residentName}</p>
      <p className="rounded-xl bg-slate-50 p-3 text-xs leading-relaxed text-slate-600">{symptomsCopy.notDiagnosis}</p>
      <a href={SRI_LANKA_AMBULANCE_TEL} className="flex items-center justify-center gap-2 rounded-xl bg-rose-700 px-4 py-3 text-sm font-bold text-white hover:bg-rose-800"><Phone className="h-4 w-4"/>{t.call1990}</a>
      <div data-testid="patient-symptom-guidance" role={assessment.urgent?'alert':'note'} className={'rounded-xl border p-3 text-xs leading-relaxed '+(assessment.urgent?'border-rose-200 bg-rose-50 text-rose-900':'border-slate-200 bg-slate-50 text-slate-600')}>{assessment.urgent&&<strong className="mb-1 block">{symptomsCopy.urgentTitle}</strong>}{assessment.guidance}</div>
      <details><summary className="cursor-pointer text-sm font-semibold text-slate-800">{symptomsCopy.title}</summary><p className="mt-2 text-xs text-slate-500">{symptomsCopy.description}</p>
        <div className="mt-3 space-y-2">{PATIENT_SYMPTOM_KEYS.map(key=><label key={key} className={'flex cursor-pointer items-start gap-3 rounded-xl border p-3 text-xs leading-relaxed '+(selected.includes(key)?'border-rose-300 bg-rose-50 text-rose-900':'border-slate-200 text-slate-700')}><input type="checkbox" disabled={state==='sending'} checked={selected.includes(key)} onChange={()=>changeSymptoms(key)} className="mt-0.5 h-4 w-4 shrink-0 accent-rose-700"/>{symptomsCopy.symptoms[key]}</label>)}</div>
        <label className="mt-3 block text-xs text-slate-600">{symptomsCopy.note}<textarea value={note} disabled={state==='sending'} maxLength={URGENT_HELP_NOTE_MAX_LENGTH} onChange={event=>{setNote(event.target.value);setState('idle');setAlertId(null);reportedAt.current=new Date().toISOString();}} placeholder={symptomsCopy.notePlaceholder} rows={2} className="mt-1 block w-full rounded-xl border border-slate-200 bg-white p-3"/></label>
      </details>
      <button type="button" onClick={sendUrgentHelp} disabled={state==='sending'||state==='saved'||state==='resolved'} className="flex w-full items-center justify-center gap-2 rounded-xl border border-rose-300 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-800 hover:bg-rose-100 disabled:opacity-60">{state==='sending'?<Loader2 className="h-4 w-4 animate-spin"/>:state==='saved'||state==='resolved'?<CheckCircle2 className="h-4 w-4"/>:<Send className="h-4 w-4"/>}{state==='sending'?t.sending:state==='resolved'?t.resolvedTitle:state==='saved'?t.savedTitle:state==='failed'?t.retry:t.action}</button>
      {state==='saved'&&<div role="status" className="rounded-xl bg-emerald-50 p-3 text-xs leading-relaxed text-emerald-900"><strong>{t.savedTitle} · #{alertId}</strong><p className="mt-1">{t.savedMessage}</p></div>}
      {state==='resolved'&&<div role="status" className="rounded-xl bg-amber-50 p-3 text-xs leading-relaxed text-amber-900"><strong>{t.resolvedTitle} · #{alertId}</strong><p className="mt-1">{t.resolvedMessage}</p><button type="button" onClick={startNewUrgentHelp} className="mt-2 font-semibold underline">{t.newRequest}</button></div>}
      {state==='failed'&&<div role="alert" className="rounded-xl bg-rose-50 p-3 text-xs leading-relaxed text-rose-900"><strong>{t.failedTitle}</strong><p className="mt-1">{auth.currentUser?.uid?t.failedMessage:t.signInRequired}</p></div>}
      <button type="button" onClick={downloadSymptomReport} disabled={state==='sending'} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 disabled:opacity-50"><FileText className="h-4 w-4"/>{getLiveFaceCopy(language).downloadReport}</button>
      {reportError&&<p role="alert" className="text-xs text-rose-800">{symptomsCopy.shareFailed}</p>}
      <p className="text-[11px] leading-relaxed text-slate-500">{t.privacy}</p>
      <details className="text-[10px] text-slate-500"><summary className="cursor-pointer">{t.sourcesLabel}</summary><ul className="mt-2 space-y-1">{FACE_CARE_SOURCES.map((source,index)=><li key={source.url}><a href={source.url} target="_blank" rel="noreferrer" className="underline">{t.sourceTitles[index]}</a></li>)}</ul></details>
    </div>
  </section>;
}
