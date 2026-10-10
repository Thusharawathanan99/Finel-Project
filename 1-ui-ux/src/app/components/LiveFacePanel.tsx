import { getLiveFaceCopy, getExpressionDisplay, getLiveExpressionSummary, LIVE_EXPRESSIONS, expressionEmoji } from '../../../../shared/liveFace';
import type { TrackedLiveFrame } from '../../../../shared/liveFace';
import { FacialObservationPanel } from './FacialObservationPanel';

export function FaceOverlay({frame,mirror=false,points=true}:{frame:TrackedLiveFrame|null;mirror?:boolean;points?:boolean}) {
  if(!frame)return null;
  return <div className="pointer-events-none absolute inset-0">
    {points && <svg aria-hidden="true" viewBox="0 0 1000 1000" preserveAspectRatio="none" className="absolute inset-0 h-full w-full opacity-65" style={{transform:mirror?'scaleX(-1)':undefined}}>
      {frame.faces.map(face=><g key={face.id} fill="#6ee7b7">{face.landmarks.map((point,index)=><circle key={index} cx={point.x*1000} cy={point.y*1000} r={1.5}/>)}</g>)}
    </svg>}
    {frame.faces.map((face,index)=><div key={face.id} className="absolute rounded-2xl border border-emerald-300/65 transition-[left,top,width,height] duration-100 motion-reduce:transition-none" style={{left:(mirror?1-face.box.x-face.box.width:face.box.x)*100+'%',top:face.box.y*100+'%',width:face.box.width*100+'%',height:face.box.height*100+'%'}}>
      <span className="absolute left-0 top-0 -translate-y-full whitespace-nowrap rounded-md bg-slate-950/85 px-2 py-1 text-xs font-medium tabular-nums text-emerald-100">{index+1} · {(face.detectionConfidence*100).toFixed(0)}%</span>
      <span className="absolute -left-px -top-px h-4 w-4 rounded-tl-xl border-l-2 border-t-2 border-emerald-300"/>
      <span className="absolute -bottom-px -right-px h-4 w-4 rounded-br-xl border-b-2 border-r-2 border-emerald-300"/>
    </div>)}
  </div>;
}

// Compact results stay beside the video even when the detailed cards are below the fold.
// Frequent numeric updates are visual; the detailed panel announces label changes only.
export function LiveResultStrip({frame,language,active,loading=false,stale=false,fps}:{frame:TrackedLiveFrame|null;language:string;active:boolean;loading?:boolean;stale?:boolean;fps?:number}) {
  const t=getLiveFaceCopy(language);
  const fresh=active&&!stale?frame:null;
  return <div className="border-t border-white/10 bg-[#0b1c24] px-4 py-3 text-white" aria-live="off">
    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
      <span className="font-semibold text-slate-200">{t.liveResults}</span>
      <span className={'flex items-center gap-1.5 '+(stale?'text-amber-300':'text-emerald-300')}><span className={'h-1.5 w-1.5 rounded-full '+(active&&!loading&&!stale?'bg-emerald-400':'bg-amber-400')}/>{loading?t.modelLoading:!active?t.paused:stale?t.waitingFresh:t.updating}</span>
    </div>
    <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
      {fresh?.faces.map((face,index)=>{const expression=getExpressionDisplay(face.expression,face.expression==='uncertain'?null:face.expressionConfidence,language);return <div key={face.id} className="flex w-52 shrink-0 items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2">
        <span className="shrink-0 text-2xl" aria-hidden="true">{expression.emoji}</span><div className="min-w-0 flex-1"><p className="text-[10px] text-slate-400">{t.face} {index+1}</p><p className="break-words text-xs font-semibold">{expression.label}</p></div><span className="text-xs font-semibold text-emerald-300">{expression.valueText}</span>
      </div>;})}
      {!fresh?.faces.length&&<p className="text-xs text-slate-400">{loading?t.modelLoading:!active?t.paused:stale?t.waitingFresh:t.noFaces}</p>}
    </div>
    {fresh&&<div className="mt-1 flex flex-wrap justify-between gap-x-3 gap-y-1 text-[10px] text-slate-400"><time dateTime={fresh.capturedAt}>{t.latestFrame}: {new Date(fresh.capturedAt).toLocaleTimeString(language==='ta'?'ta-LK':language==='si'?'si-LK':'en-GB')}</time><span>{t.updateRate}: {typeof fps==='number'&&Number.isFinite(fps)&&fps>0?fps.toFixed(1):'—'}</span></div>}
  </div>;
}

export function LiveFaceResults({frame:receivedFrame,language,loading=false,photo=false,stale=false,fps,active=false}:{frame:TrackedLiveFrame|null;language:string;loading?:boolean;photo?:boolean;stale?:boolean;fps?:number;active?:boolean}) {
  const t=getLiveFaceCopy(language);
  const frame=photo||!stale?receivedFrame:null;
  const announcement=loading?t.modelLoading:stale&&!photo?t.waitingFresh:!frame?.faces.length?t.noFaces:frame.faces.map((face,index)=>t.face+' '+(index+1)+': '+getExpressionDisplay(face.expression,null,language).label).join('. ');
  return <div className="space-y-4">
    <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">{announcement}</p>
    <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="text-lg font-bold tracking-tight text-slate-900">{photo?t.localPhoto:t.liveResults}</h3><span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[10px] font-semibold text-emerald-800">{t.localProcessing}</span></div>
    <div className={'grid overflow-hidden rounded-2xl border border-[#18343e] bg-[#0d222c] '+(photo?'grid-cols-2':'grid-cols-3')}>
      <div className="min-w-0 border-r border-white/10 p-3"><span className="text-2xl font-semibold tabular-nums tracking-tight text-white sm:text-3xl">{frame?.faces.length??'—'}</span><p className="mt-2 break-words text-[10px] leading-relaxed text-slate-300">{t.faces}</p></div>
      <div className="min-w-0 border-r border-white/10 p-3"><span className="text-2xl font-semibold tabular-nums tracking-tight text-white sm:text-3xl">{frame?Math.round(frame.processingTimeMs):'—'}</span>{frame&&<span className="ml-1 inline-block text-[10px] text-slate-300">ms</span>}<p className="mt-2 break-words text-[10px] leading-relaxed text-slate-300">{t.processingTime}</p></div>
      {!photo&&<div className="min-w-0 p-3"><span className="text-2xl font-semibold tabular-nums tracking-tight text-emerald-300 sm:text-3xl">{frame&&typeof fps==='number'&&Number.isFinite(fps)&&fps>0?fps.toFixed(1):'—'}</span><p className="mt-2 break-words text-[10px] leading-relaxed text-slate-300">{t.updateRate}</p></div>}
    </div>
    {!frame?.faces.length && <p className="rounded-xl border border-dashed border-slate-200 p-5 text-center text-sm text-slate-500">{loading?t.modelLoading:stale&&!photo?t.waitingFresh:t.noFaces}</p>}
    {frame?.faces.map((face,index)=>{
      const expression=getExpressionDisplay(face.expression,face.expression==='uncertain'?null:face.expressionConfidence,language);
      const summary=getLiveExpressionSummary(face,language);
      return <article key={face.id} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="p-4"><div className="flex items-center gap-3"><span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-emerald-100 bg-gradient-to-br from-emerald-50 to-white text-4xl" aria-hidden="true">{expression.emoji}</span><div className="min-w-0 flex-1"><p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{t.face} {index+1}</p><h4 className="mt-1 text-base font-bold text-slate-900">{expression.label}</h4></div><span className="text-sm font-bold tabular-nums text-emerald-800">{expression.valueText}</span></div>
        <div className="my-4 h-1 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-emerald-500 transition-[width] duration-100 motion-reduce:transition-none" style={{width:(face.expression==='uncertain'?0:face.expressionConfidence*100)+'%'}}/></div>
        <div className="flex flex-wrap justify-between gap-2 text-[11px] text-slate-500"><span>{t.confidence}: {(face.detectionConfidence*100).toFixed(1)}%</span><span className={'rounded-full px-2 py-0.5 '+(face.stable?'bg-emerald-50 text-emerald-800':'bg-amber-50 text-amber-900')}>{face.stable?t.stable:t.uncertain}</span></div></div>
        {summary.scoreEntries.length>0&&<div className="border-t border-slate-100 bg-slate-50/60 p-4"><p className="text-xs font-semibold text-slate-700">{t.rawModelScores}</p>{!summary.supported&&<p className="mt-2 text-[11px] leading-relaxed text-amber-900">{t.notConfirmed}{summary.leading&&<> · {t.highestModelScore}: {summary.leading.emoji} {summary.leading.label} {summary.leading.valueText}</>}</p>}{summary.explanation&&<p className="mt-2 text-[11px] leading-relaxed text-slate-600">{summary.explanation}</p>}<div className="mt-3 space-y-2">{LIVE_EXPRESSIONS.map(key=>{const entry=summary.scoreEntries.find(item=>item.expression===key);return entry?<div key={key} className="text-[11px]"><div className="mb-1 flex justify-between gap-2 text-slate-600"><span>{entry.emoji} {entry.label}</span><span className="shrink-0 font-medium tabular-nums">{entry.valueText}</span></div><div className="h-1 rounded-full bg-slate-200"><div className="h-1 rounded-full bg-teal-600 transition-[width] duration-100 motion-reduce:transition-none" style={{width:entry.score*100+'%'}}/></div></div>:null;})}</div></div>}
        {LIVE_EXPRESSIONS.every(key=>Number.isFinite(face.smoothedScores[key]))&&<details open={photo} className="border-t border-slate-100 bg-slate-50/60 px-4 py-3"><summary className="cursor-pointer text-xs font-semibold text-slate-600">{t.signalProfile}</summary><div className="mt-3 space-y-2">{LIVE_EXPRESSIONS.map(key=><div key={key} className="text-[11px]"><div className="mb-1 flex justify-between gap-2 text-slate-600"><span>{expressionEmoji[key]} {t.expressions[key]}</span><span className="shrink-0 font-medium tabular-nums">{(face.smoothedScores[key]*100).toFixed(1)}%</span></div><div className="h-1 rounded-full bg-slate-200"><div className={'h-1 rounded-full '+(face.expression===key?'bg-emerald-500':'bg-slate-400')} style={{width:face.smoothedScores[key]*100+'%'}}/></div></div>)}</div><p className="mt-3 text-[10px] leading-relaxed text-slate-500">{t.smoothedScores} · {t.probabilityHelp}</p></details>}
      </article>;
    })}
    <FacialObservationPanel frame={loading?null:frame} language={language} photo={photo} active={active||loading}/>
    <p className="text-xs leading-relaxed text-slate-500">{t.probabilityHelp}</p>
  </div>;
}
