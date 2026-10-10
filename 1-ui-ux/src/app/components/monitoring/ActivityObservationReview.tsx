import { useCallback, useRef, useState } from 'react';
import { monitoringApi } from '../../services/monitoringApi';
import { useMonitoringFeed } from './useMonitoringFeed';

export function ActivityObservationReview({ residentId }: { residentId: string }) {
  const fetchRows = useCallback((signal: AbortSignal) => monitoringApi.observations(residentId, signal), [residentId]);
  const feed = useMonitoringFeed(fetchRows, 30000);
  const [selected, setSelected] = useState('');
  const [notes, setNotes] = useState('');
  const [decision, setDecision] = useState<'confirmed' | 'false_positive'>('confirmed');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const busy = useRef(false);
  const save = async () => {
    if (busy.current) return;
    if (!notes.trim()) { setError('Describe how you verified the resident and activity.'); return; }
    busy.current = true; setPending(true); setError(''); setMessage('');
    try {
      await monitoringApi.reviewObservation(residentId, selected, decision, notes.trim());
      setSelected(''); setNotes(''); setMessage('Observation review saved.'); await feed.reload();
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Observation review could not be saved.'); }
    finally { busy.current = false; setPending(false); }
  };
  return <details className="space-y-3 rounded border p-3">
    <summary className="cursor-pointer text-sm font-semibold">Review recent activity observations</summary>
    <p className="mt-3 text-xs text-slate-600">Confirm only what you independently checked. Verified movement supports the agreed night and wandering rules. Review emergency observations in Activity and safety incidents.</p>
    {[feed.error, error].filter(Boolean).map((failure, index) => <p key={index} role="alert" className="text-sm text-red-800">{failure}</p>)}
    {feed.error && <button type="button" className="text-sm underline" onClick={() => void feed.reload()}>Retry observations</button>}
    {message && <p role="status" className="text-sm text-green-800">{message}</p>}
    {feed.loading ? <p role="status">Loading observations…</p> : !feed.rows.length && !feed.error ? <p className="text-sm text-slate-600">No activity observations returned.</p> : null}
    {feed.rows.slice(0, 30).map(item => <article key={item.event_id} className="space-y-2 border-t pt-2 text-sm">
      <p>{item.activity.replaceAll('_', ' ')} · {new Date(item.observed_at).toLocaleString([], { timeZone: 'Asia/Colombo' })} · {item.review_status.replaceAll('_', ' ')}</p>
      <p className="text-xs text-slate-600">Observation score: {Number.isFinite(Number(item.confidence)) ? `${Math.round(Number(item.confidence) * 100)}%` : 'Unavailable'}. This is not a validated probability of harm.</p>
      {item.incident_id ? <p className="text-xs">Use the incident workflow to review this safety observation.</p> : <button type="button" disabled={pending} className="rounded border px-3 py-2" onClick={() => { setSelected(item.event_id); setNotes(''); setDecision('confirmed'); setError(''); }}>Review observation</button>}
      {selected === item.event_id && <form className="space-y-2" onSubmit={event => { event.preventDefault(); void save(); }}>
        <label className="block">Review decision<select disabled={pending} className="mt-1 block w-full rounded border p-2" value={decision} onChange={event => setDecision(event.target.value as typeof decision)}><option value="confirmed">I verified this activity</option><option value="false_positive">Incorrect activity observation</option></select></label>
        <label className="block">Verification notes<textarea required maxLength={2000} disabled={pending} className="mt-1 block w-full rounded border p-2" value={notes} onChange={event => setNotes(event.target.value)} /></label>
        <div className="flex gap-2"><button disabled={pending || !notes.trim()} className="rounded bg-teal-700 px-3 py-2 text-white">{pending ? 'Saving…' : 'Save observation review'}</button><button type="button" disabled={pending} className="rounded border px-3 py-2" onClick={() => setSelected('')}>Cancel</button></div>
      </form>}
    </article>)}
    {feed.rows.length > 30 && <p className="text-xs text-slate-600">Showing the 30 most recent observations.</p>}
  </details>;
}
