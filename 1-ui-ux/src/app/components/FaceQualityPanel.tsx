import type { TrackedLiveFrame } from '../../../../shared/liveFace';
import { summarizeLiveFaceQuality, getLiveFaceQualityCopy } from '../../../../shared/liveFaceQuality';
import { useFaceFrameClock } from './useFaceFrameClock';

export function FaceQualityPanel({frame,language,fps,backend,photo=false,now}:{frame:TrackedLiveFrame|null;language:string;fps?:number;backend?:string;photo?:boolean;now?:number}) {
  const t=getLiveFaceQualityCopy(language);
  const clock=useFaceFrameClock(now===undefined&&!photo&&!!frame);
  const quality=summarizeLiveFaceQuality(frame,{mode:photo?'photo':'live',completedRateHz:fps,backend:backend==='cpu'||backend==='webgl'||backend==='webgl2'?backend:undefined,...(!photo?{now:now??clock}:{})});
  const observed=quality.state==='observed';
  return <section className="rounded-2xl border border-slate-200 bg-white p-4" aria-label={t.title}>
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-bold text-slate-900">{t.title}</h3><span className={'rounded-full px-2.5 py-1 text-[11px] font-semibold '+(observed?'bg-emerald-50 text-emerald-800':'bg-amber-50 text-amber-900')}>{t.states[quality.state]}</span></div>
    <div className="mt-3 grid grid-cols-2 gap-3"><div className="rounded-xl bg-slate-50 p-3"><p className="text-xl font-bold tabular-nums text-slate-900">{quality.stableCount??'—'}</p><p className="mt-1 text-[11px] text-slate-500">{t.stable}</p></div><div className="rounded-xl bg-slate-50 p-3"><p className="text-xl font-bold tabular-nums text-slate-900">{quality.uncertainCount??'—'}</p><p className="mt-1 text-[11px] text-slate-500">{t.uncertain}</p></div></div>
    {quality.reasonCodes.length>0&&<ul className="mt-3 space-y-2 text-xs leading-relaxed text-slate-600">{quality.reasonCodes.map(code=><li key={code} className="flex gap-2"><span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-amber-500"/><span>{t.issues[code]} {t.tips[code]}</span></li>)}</ul>}
    <p className="mt-3 border-t border-slate-100 pt-3 text-[11px] leading-relaxed text-slate-500">{quality.evidenceMode==='single-frame'?t.singleFrameNotice:t.evidenceNotice} {t.notHealth}</p>
  </section>;
}
