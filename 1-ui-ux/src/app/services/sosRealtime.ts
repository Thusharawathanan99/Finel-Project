import { getIdToken } from './firebaseAuthService';
import { API_URL } from './apiConfig';
import { auth } from '../firebase';

export function readAlertFrames(buffer: string): { remaining: string; rows: unknown[][] } {
  const records = buffer.replace(/\r\n/g, '\n').split('\n\n');
  const remaining = records.pop() || '';
  const rows: unknown[][] = [];
  for (const record of records) {
    const lines = record.split('\n');
    if (!lines.some(line => line.trim() === 'event: alerts')) continue;
    const data = lines.filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
    const value = JSON.parse(data);
    if (!Array.isArray(value)) throw new Error('Unexpected emergency update.');
    rows.push(value);
  }
  return { remaining, rows };
}

/** Bearer credentials stay in headers. Streams stop with visibility/session changes. */
export function subscribeSosAlerts(publish: (rows: any[]) => void, report: (message: string) => void): () => void {
  const uid = auth.currentUser?.uid;
  if (!uid) return () => {};
  let active = true, controller: AbortController | null = null, retry: ReturnType<typeof setTimeout> | undefined;
  let delay = 1000;
  const current = () => active && auth.currentUser?.uid === uid;
  const connect = async () => {
    if (!current() || document.visibilityState === 'hidden' || controller) return;
    const request = new AbortController(); controller = request;
    try {
      const token = await getIdToken();
      if (!current() || request.signal.aborted) return;
      if (!token) throw new Error('Sign in again to receive emergency updates.');
      const response = await fetch(`${API_URL}/sos-alerts/stream`, { headers: { Authorization: `Bearer ${token}`, Accept: 'text/event-stream' }, signal: request.signal });
      if (!response.ok || !response.body) throw new Error('Live emergency updates are unavailable; the dashboard will retry.');
      const reader = response.body.getReader(), decoder = new TextDecoder(); let buffer = '';
      report(''); delay = 1000;
      try {
        while (current() && !request.signal.aborted) {
          const chunk = await reader.read(); if (chunk.done) break;
          buffer += decoder.decode(chunk.value, { stream: true });
          if (buffer.length > 2_000_000) throw new Error('Emergency update exceeded the size limit.');
          const frames = readAlertFrames(buffer); buffer = frames.remaining;
          for (const rows of frames.rows) if (current() && !request.signal.aborted) publish(rows);
        }
      } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    } catch (failure) {
      if (current() && !request.signal.aborted) report(failure instanceof Error ? failure.message : 'Live emergency updates are unavailable.');
    } finally {
      if (controller === request) controller = null;
      if (current() && (document.visibilityState as string) !== 'hidden') { retry = setTimeout(() => void connect(), delay); delay = Math.min(30000, delay * 2); }
    }
  };
  const visible = () => { clearTimeout(retry); if (document.visibilityState === 'hidden') controller?.abort(); else void connect(); };
  document.addEventListener('visibilitychange', visible); void connect();
  return () => { active = false; clearTimeout(retry); controller?.abort(); document.removeEventListener('visibilitychange', visible); };
}
