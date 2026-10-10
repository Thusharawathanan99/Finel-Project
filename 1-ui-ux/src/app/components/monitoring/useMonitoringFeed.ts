import { useCallback, useEffect, useRef, useState } from 'react';

/** Keep the last successful feed visible and make stale/unavailable data explicit. */
export function useMonitoringFeed<T>(fetchRows: (signal: AbortSignal) => Promise<T[]>, intervalMs = 10000) {
  const [rows, setRows] = useState<T[]>([]);
  const [error, setError] = useState('');
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [loading, setLoading] = useState(true);
  const controller = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const alive = useRef(true);
  const reload = useCallback(async (force = true) => {
    if (!alive.current) return;
    if (!force && controller.current) return;
    const epoch = ++generation.current;
    controller.current?.abort();
    const request = new AbortController(); controller.current = request;
    const timeout = setTimeout(() => request.abort(), 10000);
    try {
      const result = await fetchRows(request.signal);
      if (!Array.isArray(result)) throw new Error('Unexpected response from the monitoring service.');
      if (alive.current && epoch === generation.current) { setRows(result); setError(''); setUpdatedAt(new Date()); }
    } catch (failure) {
      if (alive.current && epoch === generation.current) setError(failure instanceof Error && failure.name !== 'AbortError' ? failure.message : 'Monitoring update timed out. Please retry.');
    } finally {
      clearTimeout(timeout);
      if (epoch === generation.current) { controller.current = null; if (alive.current) setLoading(false); }
    }
  }, [fetchRows]);
  useEffect(() => {
    alive.current = true; setRows([]); setUpdatedAt(null); setError(''); setLoading(true);
    void reload();
    const onVisible = () => { if (document.visibilityState === 'visible') void reload(false); };
    const timer = setInterval(onVisible, intervalMs);
    window.addEventListener('focus', onVisible); document.addEventListener('visibilitychange', onVisible);
    return () => { alive.current = false; ++generation.current; controller.current?.abort(); clearInterval(timer); window.removeEventListener('focus', onVisible); document.removeEventListener('visibilitychange', onVisible); };
  }, [reload, intervalMs]);
  return { rows, error, updatedAt, loading, reload };
}
