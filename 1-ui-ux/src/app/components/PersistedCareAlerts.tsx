import { useEffect, useRef, useState } from 'react';
import { emotionsApi, sosApi } from '../services/apiService';
import { auth } from '../firebase';

function validSosFeed(rows: unknown): rows is any[] {
  return Array.isArray(rows) && rows.every(row => row && typeof row === 'object' && !Array.isArray(row) &&
    Number.isSafeInteger(row.id) && row.id > 0 && typeof row.resident_id === 'string' && row.resident_id.trim() && row.resident_id.length <= 50 &&
    typeof row.resident_name === 'string' && row.resident_name.trim() && row.resident_name.length <= 100 &&
    typeof row.message === 'string' && row.message.trim() && row.message.length <= 5000 &&
    (typeof row.created_at === 'string' || row.created_at instanceof Date) && Number.isFinite(new Date(row.created_at).getTime()));
}

export function PersistedCareAlerts({ caretakerId, includeSos = true }: { caretakerId?: string; includeSos?: boolean }) {
  const [wellness, setWellness] = useState<any[]>([]);
  const [sos, setSos] = useState<any[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<string | null>(null);
  const active = useRef(true);
  const busy = useRef(false);
  const loading = useRef(false);
  const [lastRefresh, setLastRefresh] = useState<number | null>(null);
  const generation = useRef(0);
  const request = useRef<AbortController | null>(null);
  const actionRequest = useRef<AbortController | null>(null);
  const accountUid = auth.currentUser?.uid;
  const refresh = async () => {
    if (loading.current || !active.current || typeof document === 'undefined' || document.visibilityState !== 'visible') return;
    const uid = auth.currentUser?.uid, epoch = generation.current;
    if (!uid) return;
    loading.current = true;
    const controller = new AbortController(); request.current = controller;
    let timedOut = false;
    const deadline = new Promise<never>((_, reject) => controller.signal.addEventListener('abort', () => reject(new Error(timedOut ? 'Alert refresh timed out. Please retry.' : 'Alert refresh canceled.')), { once: true }));
    const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, 8000);
    const current = () => active.current && generation.current === epoch && auth.currentUser?.uid === uid;
    const requests = [
      { key: 'wellness', fetch: () => emotionsApi.getWellnessAlerts(caretakerId, { signal: controller.signal }), publish: setWellness },
      ...(includeSos ? [{ key: 'sos', fetch: () => sosApi.getActive({ signal: controller.signal }), publish: setSos }] : []),
    ];
    try {
      await Promise.all(requests.map(async item => {
        try {
          const rows = await Promise.race([item.fetch(), deadline]);
          if (!Array.isArray(rows)) throw new Error('Unexpected alert response.');
          if (item.key === 'sos' && !validSosFeed(rows)) throw new Error('The emergency alert feed is invalid. Please retry.');
          if (current() && !controller.signal.aborted) { item.publish(rows); setLastRefresh(Date.now()); setErrors(previous => ({ ...previous, [item.key]: '' })); }
        } catch (error) {
          if (current()) setErrors(previous => ({ ...previous, [item.key]: error instanceof Error ? error.message : 'Alerts could not be loaded.' }));
        }
      }));
    } finally {
      clearTimeout(timeout);
      if (request.current === controller) { request.current = null; loading.current = false; }
    }
  };
  useEffect(() => {
    generation.current++;
    active.current = true;
    setWellness([]); setSos([]); setErrors({}); setPending(null); setLastRefresh(null);
    void refresh();
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh();
      else { generation.current++; request.current?.abort(); request.current = null; loading.current = false; actionRequest.current?.abort(); actionRequest.current = null; busy.current = false; setPending(null); }
    };
    const timer = setInterval(onVisible, 2000);
    window.addEventListener('focus', onVisible);
    document.addEventListener('visibilitychange', onVisible);
    return () => { active.current = false; generation.current++; request.current?.abort(); request.current = null; loading.current = false; actionRequest.current?.abort(); actionRequest.current = null; busy.current = false; clearInterval(timer); window.removeEventListener('focus', onVisible); document.removeEventListener('visibilitychange', onVisible); };
  }, [caretakerId, includeSos, accountUid]);
  const acknowledge = async (kind: 'sos' | 'wellness', id: number) => {
    if (busy.current) return;
    busy.current = true;
    const uid = auth.currentUser?.uid, epoch = generation.current;
    const controller = new AbortController(); actionRequest.current = controller;
    let timedOut = false;
    const deadline = new Promise<never>((_, reject) => controller.signal.addEventListener('abort', () => reject(new Error(timedOut ? 'This action could not be confirmed in time. Please retry; the alert stays visible until confirmed.' : 'Alert action canceled.')), { once: true }));
    const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, 10000);
    setPending(`${kind}:${id}`);
    try {
      await Promise.race([kind === 'sos' ? sosApi.resolve(id, undefined, { signal: controller.signal }) : emotionsApi.acknowledgeWellness(id, { signal: controller.signal }), deadline]);
      if (active.current && auth.currentUser?.uid === uid && generation.current === epoch) {
        // An older feed response must not restore an alert resolved by this action.
        generation.current++; request.current?.abort(); request.current = null; loading.current = false;
        (kind === 'sos' ? setSos : setWellness)(previous => previous.filter(item => item.id !== id));
        setErrors(previous => ({ ...previous, action: '' }));
        void refresh();
      }
    } catch (error) {
      if (active.current && auth.currentUser?.uid === uid && generation.current === epoch) setErrors(previous => ({ ...previous, action: error instanceof Error ? error.message : 'The alert could not be acknowledged. Please retry.' }));
    } finally { clearTimeout(timeout); if (actionRequest.current === controller) { actionRequest.current = null; busy.current = false; if (active.current) setPending(null); } }
  };
  return <section className="my-4 space-y-3" aria-label="Care alerts">
    <p className="text-xs text-slate-600" role="status">Alerts refresh every 2 seconds while this page is active. {lastRefresh ? `Last updated: ${new Date(lastRefresh).toLocaleTimeString()}.` : 'Waiting for an alert update.'}</p>
    {sos.length > 0 && <p className="text-sm text-red-900">Check on the resident and confirm they have received help before resolving an urgent request.</p>}
    {Object.entries(errors).filter(([,message]) => message).map(([key, message]) => <div key={key} role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-900">{key === 'sos' ? 'Emergency alerts: ' : key === 'wellness' ? 'Wellness alerts: ' : ''}{message}<button type="button" className="ml-3 underline" onClick={() => void refresh()}>Retry loading alerts</button></div>)}
    {sos.map(item => <article key={`sos:${item.id}`} className="rounded-xl border-2 border-red-500 bg-red-50 p-4"><h3 className="font-bold text-red-900">SOS emergency — {item.resident_name}</h3><p>{item.message}</p><p className="mt-1 text-xs">{new Date(item.created_at).toLocaleString()}</p><button type="button" disabled={pending !== null} className="mt-2 rounded-lg bg-red-600 px-4 py-2 text-white disabled:opacity-50" onClick={() => acknowledge('sos', item.id)}>Resolve emergency</button></article>)}
    {wellness.map(item => <article key={`wellness:${item.id}`} className="rounded-xl border border-orange-300 bg-orange-50 p-4"><h3 className="font-bold">{item.severity === 'critical' ? 'Critical wellness alert' : 'Wellness alert'} — {item.resident_name}</h3><p>{item.note || item.message || 'Please check on this resident.'}</p><p>Wellness score: {item.state_score ?? 'Unavailable'} / 100</p><p className="mt-1 text-xs">{new Date(item.created_at).toLocaleString()}</p><button type="button" disabled={pending !== null} className="mt-2 rounded-lg border border-orange-400 px-4 py-2 disabled:opacity-50" onClick={() => acknowledge('wellness', item.id)}>Acknowledge wellness alert</button></article>)}
  </section>;
}
