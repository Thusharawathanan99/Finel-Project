import { useEffect, useMemo, useRef, useState } from 'react';
import { assessExpressionFrame, combineExperimentalAssessment, experimentalObservation } from '../../../../shared/experimentalWellness';
import { VocalToneEngine, type VocalToneResult } from '../ml/audio/VocalToneEngine';
import { emotionsApi } from '../services/apiService';
import { auth } from '../firebase';
import type { Resident } from '../models/Resident';
import type { TrackedLiveFrame } from '../../../../shared/liveFace';

export function ExperimentalWellnessReview({ resident, frame, captured, onSaved }: { resident: Resident; frame: TrackedLiveFrame | null; captured: boolean; onSaved: () => void }) {
  const [voice, setVoice] = useState<VocalToneResult | null>(null);
  const [recording, setRecording] = useState(false), [saving, setSaving] = useState(false), [reviewed, setReviewed] = useState(false);
  const [note, setNote] = useState(''), [medicine, setMedicine] = useState(''), [message, setMessage] = useState(''), [error, setError] = useState('');
  const engine = useRef<VocalToneEngine | null>(null), abort = useRef<AbortController | null>(null), alive = useRef(true), busy = useRef(false);
  const observation = useRef<string | null>(null);
  const assessment = useMemo(() => combineExperimentalAssessment(assessExpressionFrame(frame), voice), [frame, voice]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; abort.current?.abort(); engine.current?.dispose(); }; }, []);
  useEffect(() => { abort.current?.abort(); engine.current?.dispose(); engine.current = null; setVoice(null); setReviewed(false); setMessage(''); observation.current = null; }, [captured, captured ? frame?.capturedAt : null, resident.residentId]);
  const record = async () => {
    if (!captured || busy.current) return;
    const uid = auth.currentUser?.uid; if (!uid) return;
    busy.current = true; setRecording(true); setError(''); setVoice(null); setReviewed(false); observation.current = null;
    const controller = new AbortController(); abort.current = controller;
    try { engine.current ||= new VocalToneEngine(); const result = await engine.current.recordAndAnalyze(5000, controller.signal);
      if (alive.current && !controller.signal.aborted && auth.currentUser?.uid === uid) setVoice(result);
    } catch (failure) { if (alive.current && !controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'Voice analysis unavailable.'); }
    finally { busy.current = false; if (alive.current) setRecording(false); }
  };
  const save = async () => {
    if (!captured || !assessment || !reviewed || busy.current) return;
    const uid = auth.currentUser?.uid; if (!uid) return;
    busy.current = true; setSaving(true); setError(''); const id = observation.current ||= crypto.randomUUID();
    try { const result = await emotionsApi.record({ ...experimentalObservation(assessment, note, medicine), residentId: resident.residentId, observationId: id });
      if (alive.current && auth.currentUser?.uid === uid) { setMessage('Reviewed experimental assessment saved.'); onSaved(); }
    } catch (failure) { if (alive.current && auth.currentUser?.uid === uid) setError(failure instanceof Error ? failure.message : 'Assessment could not be saved.'); }
    finally { busy.current = false; if (alive.current) setSaving(false); }
  };
  const edit = (change: () => void) => { change(); observation.current = null; setReviewed(false); setMessage(''); };
  return <section className="mt-5 space-y-3 rounded-2xl border border-amber-200 bg-white p-4" aria-label="Experimental expression and voice assessment">
    <h3 className="font-semibold text-slate-900">Experimental expression and voice assessment</h3>
    <p className="text-sm text-slate-600">Weighted expression score: happy 95, neutral 60, angry 10. Other expressions contribute their fixed weights. This engineering score does not establish how you feel or diagnose illness.</p>
    <p className="text-lg font-bold">{assessment ? `${assessment.stateScore}/100 · ${assessment.dominantExpression} expression${voice ? ' + voice' : ''}` : 'Uncertain — a clear, supported single face is required.'}</p>
    {!captured && <p className="text-sm">Capture a frame to freeze and review this estimate.</p>}
    <button type="button" disabled={!captured || recording || saving} onClick={() => void record()} className="rounded border px-3 py-2 text-sm disabled:opacity-50">{recording ? 'Recording voice for 5 seconds…' : 'Add optional 5-second voice recording'}</button>
    {voice && <p className="text-xs text-slate-600">Vocal stability {voice.stabilityScore}/100 · Acoustic distress proxy {voice.distressScore}/100. Jitter/shimmer are frame variation estimates; voice alone cannot establish distress.</p>}
    <label className="block text-sm">Related medicine (optional)<select className="mt-1 block w-full rounded border p-2" disabled={saving} value={medicine} onChange={event => edit(() => setMedicine(event.target.value))}><option value="">No association</option>{resident.getAllMedications().map((item, index) => <option key={index} value={item.drugName}>{item.drugName}</option>)}</select></label>
    <label className="block text-sm">Your note<textarea maxLength={4500} className="mt-1 block w-full rounded border p-2" disabled={saving} value={note} onChange={event => edit(() => setNote(event.target.value))} /></label>
    <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={reviewed} disabled={!captured || !assessment || recording || saving} onChange={event => setReviewed(event.target.checked)} />I reviewed the captured estimate and choose to share it with my care team. Raw face images and audio are not saved.</label>
    <button type="button" disabled={!captured || !assessment || !reviewed || recording || saving || !!message} onClick={() => void save()} className="rounded bg-teal-700 px-4 py-2 text-sm text-white disabled:opacity-50">{saving ? 'Saving…' : 'Save reviewed assessment'}</button>
    {error && <p role="alert" className="text-sm text-red-800">{error}</p>}{message && <p role="status" className="text-sm text-green-800">{message}</p>}
  </section>;
}
