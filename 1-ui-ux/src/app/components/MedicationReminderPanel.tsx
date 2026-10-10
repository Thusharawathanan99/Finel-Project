import { useCallback, useEffect, useRef, useState } from 'react';
import { Resident } from '../models/Resident';
import { medicationSchedulesApi, MedicationSchedule } from '../services/medicationSchedulesApi';
import { useMonitoringFeed } from './monitoring/useMonitoringFeed';

const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const calendarDay = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
const doseTime = (instant: string) => new Date(instant).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Colombo' });
const dateField = (date?: string) => date?.slice(0, 10) || '';
const field = 'mt-1 block w-full rounded-lg border p-2 text-sm';
export function MedicationReminderPanel({ resident, onSchedulesChanged }: { resident: Resident; onSchedulesChanged?: (ids: number[] | null) => void }) {
  const [day, setDay] = useState(calendarDay);
  const [editing, setEditing] = useState(false);
  const [medicationId, setMedicationId] = useState('');
  const [times, setTimes] = useState(['']);
  const [selectedDays, setSelectedDays] = useState([0, 1, 2, 3, 4, 5, 6]);
  const [startDate, setStartDate] = useState(calendarDay);
  const [endDate, setEndDate] = useState('');
  const [foodInstruction, setFoodInstruction] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [confirmed, setConfirmed] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const busy = useRef(false);
  const fetchSchedules = useCallback((signal: AbortSignal) => medicationSchedulesApi.schedules(resident.residentId, signal), [resident.residentId]);
  const schedules = useMonitoringFeed(fetchSchedules, 30000);
  const fetchReminders = useCallback((signal: AbortSignal) => medicationSchedulesApi.reminders(resident.residentId, day, signal), [resident.residentId, day]);
  const reminders = useMonitoringFeed(fetchReminders, 10000);
  useEffect(() => { const timer = setInterval(() => setDay(calendarDay()), 30000); return () => clearInterval(timer); }, []);
  useEffect(() => { onSchedulesChanged?.(schedules.updatedAt && !schedules.error ? schedules.rows.filter(schedule => schedule.enabled).map(schedule => schedule.medication_id) : null); }, [schedules.rows, schedules.updatedAt, schedules.error, onSchedulesChanged]);
  const medications = resident.getAllMedications().filter(medication => medication.id);
  const selectedMedication = medications.find(medication => String(medication.id) === medicationId);
  const run = async (change: () => Promise<void>) => { if (busy.current) return; busy.current = true; setPending(true); setError(''); setMessage(''); try { await change(); } catch (failure) { setError(failure instanceof Error ? failure.message : 'Dose change could not be saved.'); } finally { await Promise.all([schedules.reload(), reminders.reload()]); busy.current = false; setPending(false); } };
  const edit = (schedule?: MedicationSchedule) => {
    setMedicationId(schedule ? String(schedule.medication_id) : ''); setTimes(schedule?.times || ['']); setSelectedDays(schedule?.weekdays || [0, 1, 2, 3, 4, 5, 6]); setStartDate(dateField(schedule?.start_date) || calendarDay()); setEndDate(dateField(schedule?.end_date)); setFoodInstruction(schedule?.food_instruction || ''); setEnabled(schedule?.enabled ?? true); setConfirmed(false); setEditing(true); setError('');
  };
  const save = () => void run(async () => {
    if (!selectedMedication?.id || !selectedMedication.verifiedByUser) throw new Error('Choose a confirmed prescription medication.');
    if (!confirmed) throw new Error('Confirm that these exact times match the prescription instructions.');
    if (!times.length || times.some(time => !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) || new Set(times).size !== times.length) throw new Error('Choose distinct, exact dose times.');
    if (!selectedDays.length) throw new Error('Choose at least one weekday.');
    await medicationSchedulesApi.save(resident.residentId, selectedMedication.id, { times, weekdays: selectedDays, timezone: 'Asia/Colombo', startDate, endDate: endDate || null, foodInstruction: foodInstruction.trim(), enabled }); setEditing(false); setMessage('Confirmed dose schedule saved.');
  });
  const activeDoses = reminders.rows.filter(dose => dose.status !== 'cancelled');
  return <section className="space-y-3 rounded-xl border border-teal-200 bg-white p-4" aria-label="Dose reminders">
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">Dose reminders · {day}</h3><button disabled={pending} className="rounded-lg border border-teal-600 px-3 py-2 text-sm text-teal-800 disabled:opacity-50" type="button" onClick={() => edit()}>Set confirmed dose times</button></div>
    <p className="text-xs text-slate-600">All dose times use Sri Lanka time (Asia/Colombo). Set exact times from the verified prescription or care plan. Reminders refresh while this page is active.</p>
    {[schedules.error, reminders.error, error].filter(Boolean).map((failure, index) => <p key={index} role="alert" className="text-sm text-red-800">{failure} <button type="button" className="underline" onClick={() => { void schedules.reload(); void reminders.reload(); }}>Refresh dose records</button></p>)}{message && <p role="status" className="text-sm text-green-800">{message}</p>}
    {reminders.loading ? <p role="status" className="text-sm">Loading dose reminders…</p> : !activeDoses.length && !reminders.error ? <p className="text-sm text-slate-600">No dose reminders for today. Review the confirmed schedules below.</p> : null}
    <div className="space-y-2">{activeDoses.map(dose => { const completed = dose.status === 'taken' || dose.status === 'skipped'; const upcoming = Date.parse(dose.scheduled_at) > Date.now(); return <article key={dose.reminder_id} className="rounded-lg border p-3"><div className="flex flex-wrap justify-between gap-2"><p className="text-sm font-semibold">{dose.drug_name} · {dose.dosage}</p><span className="text-sm">{doseTime(dose.scheduled_at)} · {dose.status}</span></div>{dose.is_overdue && !completed && <p role="status" className="mt-1 text-sm font-medium text-amber-800">Overdue by at least {dose.escalation_minutes ?? 30} minutes. Check the resident; notification delivery is tracked separately.</p>}{dose.food_instruction && <p className="mt-1 text-sm">{dose.food_instruction}</p>}{dose.status === 'snoozed' && <p className="mt-1 text-xs text-slate-600">Next reminder: {doseTime(dose.presentation_at)}</p>}{!completed && <div className="mt-2 flex flex-wrap gap-2"><button disabled={pending || upcoming} type="button" className="rounded bg-green-100 px-3 py-2 text-sm text-green-900 disabled:opacity-50" onClick={() => void run(async () => { await medicationSchedulesApi.action(resident.residentId, dose.reminder_id, 'taken'); setMessage('This dose was recorded as taken.'); })}>Taken</button><button disabled={pending || upcoming} type="button" className="rounded border px-3 py-2 text-sm disabled:opacity-50" onClick={() => void run(async () => { await medicationSchedulesApi.action(resident.residentId, dose.reminder_id, 'skipped'); setMessage('This dose was recorded as skipped.'); })}>Skipped</button><button disabled={pending || upcoming} type="button" className="rounded border px-3 py-2 text-sm disabled:opacity-50" onClick={() => void run(async () => { await medicationSchedulesApi.action(resident.residentId, dose.reminder_id, 'snoozed', dose.delivery_round); setMessage('This dose reminder was snoozed for 10 minutes.'); })}>Snooze 10 min</button>{upcoming && <span className="self-center text-xs text-slate-500">Scheduled for later</span>}</div>}</article>; })}</div>
    {schedules.rows.length > 0 && <details><summary className="cursor-pointer text-sm font-medium">Confirmed schedules ({schedules.rows.length})</summary><div className="mt-3 space-y-2">{schedules.rows.map(schedule => <div key={schedule.schedule_id} className="flex flex-wrap justify-between gap-2 rounded-lg bg-slate-50 p-3"><p className="text-sm">{schedule.drug_name} · {schedule.times.join(', ')} · {schedule.weekdays.map(index => weekdays[index]).join(', ')} · {schedule.enabled ? 'enabled' : 'disabled'}</p><button type="button" disabled={pending} className="text-sm text-teal-800 underline" onClick={() => edit(schedule)}>Edit schedule</button></div>)}</div></details>}
    {editing && <form className="space-y-3 rounded-xl border bg-slate-50 p-3" onSubmit={event => { event.preventDefault(); save(); }}>
      <label className="block text-sm">Confirmed prescription medication<select required disabled={pending} className={field} value={medicationId} onChange={event => { setMedicationId(event.target.value); setConfirmed(false); }}><option value="">Choose medication</option>{medications.map(medication => <option key={medication.id} value={medication.id} disabled={!medication.verifiedByUser}>{medication.drugName} · {medication.dosage}{!medication.verifiedByUser ? ' (prescription review required)' : ''}</option>)}</select></label>
      {selectedMedication && <p className="text-sm text-slate-700">Prescription frequency: {selectedMedication.frequency}. {selectedMedication.instructions}</p>}
      <fieldset><legend className="text-sm">Exact dose times</legend><div className="mt-2 flex flex-wrap gap-2">{times.map((time, index) => <div key={index} className="flex items-center gap-1"><input aria-label={`Dose time ${index + 1}`} required type="time" disabled={pending} className="rounded-lg border p-2" value={time} onChange={event => { setTimes(previous => previous.map((value, i) => i === index ? event.target.value : value)); setConfirmed(false); }} />{times.length > 1 && <button type="button" disabled={pending} aria-label={`Remove dose time ${index + 1}`} className="px-2" onClick={() => { setTimes(previous => previous.filter((_, i) => i !== index)); setConfirmed(false); }}>×</button>}</div>)}{times.length < 8 && <button type="button" disabled={pending} className="rounded border px-3 py-2 text-sm" onClick={() => { setTimes(previous => [...previous, '']); setConfirmed(false); }}>Add time</button>}</div></fieldset>
      <fieldset><legend className="text-sm">Weekdays</legend><div className="mt-2 flex flex-wrap gap-3">{weekdays.map((label, index) => <label key={label} className="flex gap-1 text-sm"><input type="checkbox" disabled={pending} checked={selectedDays.includes(index)} onChange={event => { setSelectedDays(previous => event.target.checked ? [...previous, index].sort() : previous.filter(value => value !== index)); setConfirmed(false); }} />{label}</label>)}</div></fieldset>
      <div className="grid gap-3 sm:grid-cols-2"><label className="text-sm">Start date<input required type="date" disabled={pending} className={field} value={startDate} onChange={event => { setStartDate(event.target.value); setConfirmed(false); }} /></label><label className="text-sm">End date (if prescribed)<input type="date" min={startDate} disabled={pending} className={field} value={endDate} onChange={event => { setEndDate(event.target.value); setConfirmed(false); }} /></label></div>
      <label className="block text-sm">Food instruction from prescription<input maxLength={500} disabled={pending} className={field} value={foodInstruction} onChange={event => { setFoodInstruction(event.target.value); setConfirmed(false); }} /></label><label className="flex gap-2 text-sm"><input type="checkbox" disabled={pending} checked={enabled} onChange={event => { setEnabled(event.target.checked); setConfirmed(false); }} />Enable this schedule</label><label className="flex items-start gap-2 text-sm"><input type="checkbox" disabled={pending} checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />I checked these times, weekdays, dates and food instructions against the verified prescription or care plan.</label><div className="flex gap-2"><button disabled={pending || !confirmed} className="rounded bg-teal-700 px-4 py-2 text-sm text-white disabled:opacity-50">{pending ? 'Saving…' : 'Save confirmed schedule'}</button><button type="button" disabled={pending} className="rounded border px-3 py-2 text-sm" onClick={() => setEditing(false)}>Cancel</button></div>
    </form>}
  </section>;
}
