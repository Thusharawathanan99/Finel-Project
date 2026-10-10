import { useRef, useState } from 'react';
import { apiGet } from '../../services/apiService';

export function MonitoringReports() {
  const [pending, setPending] = useState(false), [error, setError] = useState('');
  const busy = useRef(false);
  const download = async (kind: 'report' | 'audit') => {
    if (busy.current) return; busy.current = true; setPending(true); setError('');
    try {
      const data = await apiGet(`/monitoring/${kind}`);
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
      const link = document.createElement('a'); link.href = url; link.download = `careconnect-${kind}.json`; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Report could not be exported.'); }
    finally { busy.current = false; setPending(false); }
  };
  return <section className="space-y-2 rounded-xl border bg-white p-4"><h3 className="font-semibold">Incident response and audit reports</h3><p className="text-sm text-slate-600">Export stored incident counts, caretaker response times or recent access records. Model accuracy requires a separate labeled evaluation.</p>{error && <p role="alert" className="text-sm text-red-800">{error}</p>}<div className="flex flex-wrap gap-2"><button type="button" disabled={pending} className="rounded border px-3 py-2 text-sm" onClick={() => void download('report')}>Export response report</button><button type="button" disabled={pending} className="rounded border px-3 py-2 text-sm" onClick={() => void download('audit')}>Export recent audit records</button></div></section>;
}
