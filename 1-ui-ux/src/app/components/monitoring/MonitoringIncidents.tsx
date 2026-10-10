import { useCallback, useRef, useState } from 'react';
import { Resident } from '../../models/Resident';
import { IncidentAction, monitoringApi, MonitoringIncident } from '../../services/monitoringApi';
import { useMonitoringFeed } from './useMonitoringFeed';

const actionLabels: Record<IncidentAction, string> = { acknowledged: 'Acknowledge and check resident', emergency_contacted: 'Record emergency contact made', false_alarm: 'Mark false alarm', resolved: 'Resolve after resident received help', resident_corrected: 'Correct resident assignment', note: 'Add care note' };
const readable = (text: string) => text.replaceAll('_', ' ');
function responseTime(item: MonitoringIncident) {
  const measured = item.response_time_seconds ?? (item.acknowledged_at ? (Date.parse(item.acknowledged_at) - Date.parse(item.detected_at)) / 1000 : null);
  return measured !== null && Number.isFinite(measured) ? `${Math.max(0, Math.round(Number(measured)))} seconds` : 'Not acknowledged yet';
}
export function MonitoringIncidents({ residents }: { residents: Resident[] }) {
  const [history, setHistory] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [historyId, setHistoryId] = useState<number | null>(null);
  const [action, setAction] = useState<IncidentAction>('acknowledged');
  const [notes, setNotes] = useState('');
  const [residentId, setResidentId] = useState('');
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const [actionError, setActionError] = useState('');
  const [notice, setNotice] = useState('');
  const fetchRows = useCallback((signal: AbortSignal) => monitoringApi.incidents(history, signal), [history]);
  const feed = useMonitoringFeed(fetchRows, 3000);
  const save = async (id: number) => {
    if (busy.current) return;
    if (!notes.trim()) { setActionError('Enter what you observed and the reason for this action.'); return; }
    if (action === 'resident_corrected' && !residentId) { setActionError('Select the correct resident.'); return; }
    busy.current = true; setPending(true); setActionError(''); setNotice('');
    try { await monitoringApi.incidentAction(id, action, notes.trim(), action === 'resident_corrected' ? residentId : undefined); setSelected(null); setNotes(''); setNotice('Incident action saved to the care history.'); await feed.reload(); }
    catch (error) { setActionError(error instanceof Error ? error.message : 'The incident action could not be saved.'); }
    finally { busy.current = false; setPending(false); }
  };
  return <section className="my-4 space-y-3" aria-label="Monitoring incidents">
    <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-lg font-bold">Activity and safety incidents</h2><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={history} disabled={pending} onChange={event => { setHistory(event.target.checked); setSelected(null); }} />Include resolved history</label></div>
    <p className="text-xs text-slate-600">Refreshes every 3 seconds while this page is visible. {feed.updatedAt ? `Last successful update: ${feed.updatedAt.toLocaleTimeString()}.` : 'Awaiting monitoring service.'} Observations require a human check before confirmation.</p>
    {feed.error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{feed.error} {feed.updatedAt && 'Displayed records may be out of date.'} <button type="button" className="underline" onClick={() => void feed.reload()}>Retry</button></p>}
    {feed.loading ? <p role="status" className="text-sm">Loading incidents…</p> : !feed.rows.length && !feed.error ? <p className="rounded-lg border bg-white p-3 text-sm text-slate-600">No {history ? 'recorded' : 'active'} incidents were returned.</p> : null}
    {notice && <p role="status" className="text-sm text-green-800">{notice}</p>}{actionError && <p role="alert" className="text-sm text-red-800">{actionError}</p>}
    {feed.rows.map(item => { const closed = item.status === 'resolved' || item.status === 'false_alarm'; const person = residents.find(resident => resident.residentId === (item.corrected_resident_id || item.resident_id)); return <article key={item.incident_id} className={`rounded-xl border-2 p-4 ${closed ? 'border-slate-200 bg-white' : item.severity === 'critical' ? 'border-red-500 bg-red-50' : 'border-orange-300 bg-orange-50'}`}>
      <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">{readable(item.incident_type)} — {person?.name || item.resident_name || 'Resident assignment pending'}</h3><span className="rounded bg-white px-2 py-1 text-xs font-semibold">{readable(item.status)} · {item.severity}</span></div>
      <p className="mt-2 text-sm">{item.reason}</p><p className="mt-1 text-sm font-medium">{item.recommended_action}</p>
      <div className="mt-2 space-y-1 text-xs text-slate-700"><p>{item.device_name || item.device_id}{item.location ? ` · ${item.location}` : ''} · Detected {new Date(item.detected_at).toLocaleString()}</p><p>Response time: {responseTime(item)}{item.confidence != null && Number.isFinite(Number(item.confidence)) ? ` · Observation score: ${Math.round(Number(item.confidence) * 100)}%` : ''}</p>{item.acknowledged_by_name && <p>Responsible caretaker: {item.acknowledged_by_name}</p>}{item.emergency_contacted_at && <p>Emergency contact recorded: {new Date(item.emergency_contacted_at).toLocaleString()}</p>}{item.resolution_notes && <p>Resolution: {item.resolution_notes}</p>}</div>
      <button type="button" className="mt-3 text-sm underline" onClick={() => setHistoryId(historyId === item.incident_id ? null : item.incident_id)}>{historyId === item.incident_id ? "Close care action history" : "View care action history"}</button>{historyId === item.incident_id && <IncidentActionHistory key={item.incident_id} incidentId={item.incident_id} />}
      {!closed && <button type="button" disabled={pending} className="mt-3 rounded-lg border border-slate-500 bg-white px-3 py-2 text-sm disabled:opacity-50" onClick={() => { setSelected(item.incident_id); setAction(item.status === 'open' ? 'acknowledged' : 'note'); setNotes(''); setResidentId(item.corrected_resident_id || item.resident_id || ''); setActionError(''); }}>Review and record action</button>}
      {selected === item.incident_id && <form className="mt-3 space-y-3 rounded-lg border bg-white p-3" onSubmit={event => { event.preventDefault(); void save(item.incident_id); }}>
        <label className="block text-sm">Action<select className="mt-1 block w-full rounded border p-2" disabled={pending} value={action} onChange={event => setAction(event.target.value as IncidentAction)}>{Object.entries(actionLabels).filter(([key]) => item.status === 'open' || key !== 'acknowledged').map(([key, value]) => <option key={key} value={key}>{value}</option>)}</select></label>
        {action === 'resident_corrected' && <label className="block text-sm">Correct resident<select required className="mt-1 block w-full rounded border p-2" disabled={pending} value={residentId} onChange={event => setResidentId(event.target.value)}><option value="">Select resident</option>{residents.map(resident => <option key={resident.residentId} value={resident.residentId}>{resident.name} · Room {resident.personalDetails.roomNumber || 'unassigned'}</option>)}</select></label>}
        <label className="block text-sm">Observation and reason<textarea required maxLength={2000} className="mt-1 block w-full rounded border p-2" disabled={pending} value={notes} onChange={event => setNotes(event.target.value)} /></label>
        {action === 'emergency_contacted' && <p className="text-xs text-slate-600">This records a contact you have already made. Contact the appropriate emergency service or guardian directly.</p>}
        <div className="flex gap-2"><button disabled={pending || !notes.trim()} type="submit" className="rounded-lg bg-teal-700 px-4 py-2 text-sm text-white disabled:opacity-50">{pending ? 'Saving…' : 'Save action'}</button><button disabled={pending} type="button" className="rounded border px-3 py-2 text-sm" onClick={() => setSelected(null)}>Cancel</button></div>
      </form>}
    </article>; })}
  </section>;
}

export function IncidentActionHistory({ incidentId }: { incidentId: number }) {
  const fetchRows = useCallback((signal: AbortSignal) => monitoringApi.incidentActions(incidentId, signal), [incidentId]);
  const feed = useMonitoringFeed(fetchRows, 30000);
  return <div className="mt-2 space-y-2 rounded border bg-white p-3 text-sm">
    {feed.error && <p role="alert" className="text-red-800">{feed.error} <button type="button" className="underline" onClick={() => void feed.reload()}>Retry history</button></p>}
    {feed.loading ? <p role="status">Loading care actions…</p> : !feed.error && !feed.rows.length ? <p>No care actions recorded.</p> : null}
    {feed.rows.map(record => <article key={record.action_id}><p>{readable(record.action)} · {record.actor_name || 'Recorded care staff'} · {new Date(record.created_at).toLocaleString([], { timeZone: 'Asia/Colombo' })}</p><p className="whitespace-pre-wrap">{record.notes}</p></article>)}
  </div>;
}
