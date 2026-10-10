import { useState } from 'react';
import { getFaceGuideCopy } from '../../../../shared/faceGuide';

// Educational assets are never camera observations. Mount photos only after a
// deliberate expansion with the camera stopped, keeping inference resources free.
export function FaceMonitoringGuide({language,active=false}:{language:string;active?:boolean}){
  const [expanded,setExpanded]=useState(false);
  const t=getFaceGuideCopy(language);
  return <details data-testid="face-monitoring-guide" className="overflow-hidden rounded-xl border border-slate-200 bg-slate-50" onToggle={event=>setExpanded(event.currentTarget.open)}>
    <summary className="cursor-pointer p-3 text-xs font-semibold text-slate-700">{t.title}</summary>
    {expanded&&<div className="space-y-3 px-3 pb-3"><p className="text-[11px] leading-relaxed text-slate-500">{t.notice}</p>{active?<p className="rounded-lg bg-teal-50 p-3 text-xs text-teal-800">{t.cameraOffGuide}</p>:<>
      {[
        {file:'facial-movement.png',title:t.movement,text:t.movementText},
        {file:'rest.png',title:t.rest,text:t.restText},
        {file:'care-support.png',title:t.support,text:t.supportText},
      ].map(card=><figure key={card.file} className="overflow-hidden rounded-xl border border-slate-200 bg-white"><img src={'/face-guide/'+card.file} alt={card.title+' — '+t.notice} loading="lazy" decoding="async" width="640" height="480" className="aspect-[4/3] w-full object-cover"/><figcaption className="p-3"><h4 className="text-xs font-semibold text-slate-800">{card.title}</h4><p className="mt-1 text-[11px] leading-relaxed text-slate-600">{card.text}</p></figcaption></figure>)}
      <figure className="rounded-xl border border-slate-200 bg-white p-3"><svg viewBox="0 0 300 210" role="img" aria-label={t.asymmetry+' — '+t.notice} className="mx-auto h-44 w-full max-w-xs"><ellipse cx="150" cy="98" rx="68" ry="83" fill="#eff8fa" stroke="#087f8c" strokeWidth="2"/><path d="M102 76Q116 69 130 76M169 76Q183 69 197 76M145 83L140 116L155 118M112 143Q150 153 191 134" fill="none" stroke="#123c46" strokeWidth="3" strokeLinecap="round"/><path d="M111 146H192M150 20V181" stroke="#087f8c" strokeDasharray="4 5" opacity=".5"/><circle cx="113" cy="144" r="5" fill="#18b7c9"/><circle cx="191" cy="134" r="5" fill="#18b7c9"/><path d="M213 134V146M208 134H218M208 146H218" stroke="#087f8c" strokeWidth="2"/></svg><figcaption><h4 className="text-xs font-semibold text-slate-800">{t.asymmetry}</h4><p className="mt-1 text-[11px] leading-relaxed text-slate-600">{t.asymmetryText}</p></figcaption></figure>
    </>}</div>}
  </details>;
}
