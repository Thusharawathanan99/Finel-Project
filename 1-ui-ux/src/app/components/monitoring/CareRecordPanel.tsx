import { useCallback, useRef, useState } from 'react';
import { apiGet, apiPost, apiPut } from '../../services/apiService';
import { useMonitoringFeed } from './useMonitoringFeed';
import { ActivityObservationReview } from './ActivityObservationReview';

type CareRecord = {
  resident: { medical_history?: string; allergies?: string[] | string; emergency_contact_name?: string; emergency_contact_phone?: string };
  careNotes: { note_id: number; note: string; created_at: string }[];
  appointments: { appointment_id: string; doctor_name: string; appointment_date: string; status: string }[];
  medicationHistory: unknown[]; emergencies: unknown[];
};
type Baseline = { inactivitySeconds?: number; sleepStart?: string; sleepEnd?: string; nightActivityEnabled?: boolean; repeatWanderingCount?: number; distressCheckins?: number };
const field = 'mt-1 block w-full rounded-lg border p-2 text-sm';
const stamp = (value: string) => new Date(value).toLocaleString([], { timeZone: 'Asia/Colombo' });
export function CareRecordPanel({ residentId, staff = false }: { residentId: string; staff?: boolean }) {
  const base = `/monitoring/residents/${encodeURIComponent(residentId)}`;
  const fetchRecords = useCallback(async (signal: AbortSignal) => [await apiGet<CareRecord>(base + '/record', { signal })], [base]);
  const fetchBaseline = useCallback(async (signal: AbortSignal) => [await apiGet<{ baseline: Baseline | null }>(base + '/baseline', { signal })], [base]);
  const records = useMonitoringFeed(fetchRecords, 60000);
  const plans = useMonitoringFeed(fetchBaseline, 60000);
  const [note, setNote] = useState('');
  const [editing, setEditing] = useState(false);
  const [baseline, setBaseline] = useState<Baseline>({ inactivitySeconds: 300, sleepStart: '22:00', sleepEnd: '06:00', nightActivityEnabled: false, repeatWanderingCount: 3, distressCheckins: 3 });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const busy = useRef(false);
  const run = async (change: () => Promise<void>) => {
    if (busy.current) return;
    busy.current = true; setPending(true); setError(''); setMessage('');
    try { await change(); } catch (failure) { setError(failure instanceof Error ? failure.message : 'Care record could not be saved.'); }
    finally { await Promise.all([records.reload(), plans.reload()]); busy.current = false; setPending(false); }
  };
  const record = records.rows[0], plan = plans.rows[0]?.baseline;
  return <details className="rounded-xl border bg-white p-4">
    <summary className="cursor-pointer font-semibold">Care record and monitoring plan</summary>
    <div className="mt-3 space-y-4">
      {staff && <ActivityObservationReview key={residentId} residentId={residentId} />}
      {[records.error, plans.error, error].filter(Boolean).map((failure, index) => <p key={index} role="alert" className="text-sm text-red-800">{failure} <button type="button" className="underline" onClick={() => { void records.reload(); void plans.reload(); }}>Retry</button></p>)}
      {message && <p role="status" className="text-sm text-green-800">{message}</p>}
      {records.loading && <p className="text-sm">Loading care record…</p>}
      {record && <>
        <p className="whitespace-pre-wrap text-sm"><strong>Medical history:</strong> {record.resident.medical_history || 'No medical history recorded.'}</p>
        <p className="text-sm"><strong>Emergency contact:</strong> {record.resident.emergency_contact_name || 'Not recorded'} {record.resident.emergency_contact_phone || ''}</p>
        <p className="text-sm"><strong>Allergies:</strong> {Array.isArray(record.resident.allergies) ? record.resident.allergies.join(', ') || 'No allergies recorded' : record.resident.allergies || 'No allergies recorded'}</p>
        <p className="text-sm">{record.medicationHistory.length} recent medication check-ins · {record.emergencies.length} help requests in the retrieved history.</p>
        {record.appointments.length > 0 && <div><h4 className="text-sm font-semibold">Appointments and doctors</h4>{record.appointments.map(item => <p key={item.appointment_id} className="text-sm">{item.appointment_date?.slice(0, 10)} · {item.doctor_name} · {item.status}</p>)}</div>}
        <div className="space-y-2"><h4 className="text-sm font-semibold">Care notes</h4>{record.careNotes.length ? record.careNotes.map(item => <article key={item.note_id} className="rounded border bg-slate-50 p-2"><p className="whitespace-pre-wrap text-sm">{item.note}</p><p className="mt-1 text-xs text-slate-600">{stamp(item.created_at)}</p></article>) : <p className="text-sm text-slate-600">No care notes recorded.</p>}</div>
      </>}
      {staff && <form className="space-y-2" onSubmit={event => { event.preventDefault(); void run(async () => { if (!note.trim()) throw new Error('Write a care note.'); await apiPost(base + '/care-notes', { note: note.trim() }); setNote(''); setMessage('Care note saved.'); }); }}>
        <label className="block text-sm">New care note<textarea required maxLength={4000} disabled={pending} className={field} value={note} onChange={event => setNote(event.target.value)} /></label>
        <button disabled={pending || !note.trim()} className="rounded bg-teal-700 px-3 py-2 text-sm text-white disabled:opacity-50">Save care note</button>
      </form>}
      <div className="space-y-2 border-t pt-3"><h4 className="text-sm font-semibold">Personalized monitoring plan</h4><p className="text-xs text-slate-600">Care staff configure these observation rules from the agreed care plan. They are experimental rules; facial expressions do not diagnose health or establish a person's feelings.</p>
        <p className="text-sm">{plan ? `Inactivity: ${plan.inactivitySeconds ?? 'camera default'} seconds. Night movement checks: ${plan.nightActivityEnabled ? `${plan.sleepStart}–${plan.sleepEnd} (Sri Lanka time)` : 'disabled'}.` : 'No resident-specific plan recorded. Camera settings apply.'}</p>
        {staff && <button type="button" disabled={pending || plans.loading || !!plans.error} className="rounded border px-3 py-2 text-sm" onClick={() => { setBaseline({ inactivitySeconds: 300, sleepStart: '22:00', sleepEnd: '06:00', nightActivityEnabled: false, repeatWanderingCount: 3, distressCheckins: 3, ...plan }); setEditing(!editing); }}>Edit agreed care plan</button>}
        {staff && editing && <form className="space-y-3 rounded border bg-slate-50 p-3" onSubmit={event => { event.preventDefault(); void run(async () => { await apiPut(base + '/baseline', { baseline }); setEditing(false); setMessage('Personalized monitoring plan saved.'); }); }}>
          <div className="grid gap-3 sm:grid-cols-2"><label className="text-sm">Inactivity threshold (seconds)<input required type="number" min={30} max={86400} disabled={pending} className={field} value={baseline.inactivitySeconds} onChange={event => setBaseline(value => ({ ...value, inactivitySeconds: Number(event.target.value) }))} /></label><label className="text-sm">Verified wandering observations per hour<input required type="number" min={2} max={20} disabled={pending} className={field} value={baseline.repeatWanderingCount} onChange={event => setBaseline(value => ({ ...value, repeatWanderingCount: Number(event.target.value) }))} /></label><label className="text-sm">Negative self-reported check-ins per day<input required type="number" min={2} max={20} disabled={pending} className={field} value={baseline.distressCheckins} onChange={event => setBaseline(value => ({ ...value, distressCheckins: Number(event.target.value) }))} /></label></div>
          <label className="flex gap-2 text-sm"><input type="checkbox" disabled={pending} checked={!!baseline.nightActivityEnabled} onChange={event => setBaseline(value => ({ ...value, nightActivityEnabled: event.target.checked }))} />Check verified movement during the agreed sleep period</label>
          {baseline.nightActivityEnabled && <div className="grid gap-3 sm:grid-cols-2"><label className="text-sm">Sleep period starts<input required type="time" disabled={pending} className={field} value={baseline.sleepStart} onChange={event => setBaseline(value => ({ ...value, sleepStart: event.target.value }))} /></label><label className="text-sm">Sleep period ends<input required type="time" disabled={pending} className={field} value={baseline.sleepEnd} onChange={event => setBaseline(value => ({ ...value, sleepEnd: event.target.value }))} /></label></div>}
          <button disabled={pending} className="rounded bg-teal-700 px-3 py-2 text-sm text-white disabled:opacity-50">Save care plan</button>
        </form>}
      </div>
    </div>
  </details>;
}
