import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Modal, ScrollView, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { apiFetch } from '../apiHelper';
import { cancelLocalDoseReminder, syncLocalDoseReminders } from '../pushNotifications';

const today = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const doseTime = value => new Date(new Date(value).getTime() + 330 * 60_000).toISOString().slice(11, 16);
const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
async function readResponse(response) {
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Care records could not be saved.');
  return data;
}

export default function DoseReminders({ residentId, medications = [], onSchedulesLoaded }) {
  const [schedules, setSchedules] = useState([]);
  const [reminders, setReminders] = useState([]);
  const [day, setDay] = useState(today);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(null);
  const [editor, setEditor] = useState(null);
  const requestGeneration = useRef(0);
  const mutationBusy = useRef(false);
  const callback = useRef(onSchedulesLoaded); callback.current = onSchedulesLoaded;
  const medicationKey = medications.map(med => `${med.id}:${med.confirmed}`).join(',');

  const load = useCallback(async () => {
    if (!residentId) return;
    const run = ++requestGeneration.current;
    setLoading(true);
    try {
      const base = `/residents/${encodeURIComponent(residentId)}`;
      const [nextSchedules, nextReminders] = await Promise.all([
        apiFetch(base + '/medication-schedules').then(readResponse),
        apiFetch(base + '/medication-reminders?day=' + encodeURIComponent(day)).then(readResponse),
      ]);
      if (run !== requestGeneration.current) return;
      setSchedules(nextSchedules); setReminders(nextReminders); setError('');
      callback.current?.(nextSchedules);
      await syncLocalDoseReminders(residentId);
    } catch (failure) { if (run === requestGeneration.current) setError(failure.message || 'Dose reminders could not be loaded.'); }
    finally { if (run === requestGeneration.current) setLoading(false); }
  }, [residentId, day]);
  useEffect(() => {
    void load();
    const timer = setInterval(() => { if (AppState.currentState === 'active') void load(); }, 60_000);
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') void load(); });
    return () => { requestGeneration.current += 1; clearInterval(timer); subscription.remove(); };
  }, [load, medicationKey]);

  const edit = med => {
    const schedule = schedules.find(item => Number(item.medication_id) === Number(med.id));
    setEditor({ medicationId: med.id, name: med.drugName || med.drug_name, times: schedule?.times?.join(', ') || '', startDate: schedule?.start_date || today(), endDate: schedule?.end_date || '', weekdays: schedule?.weekdays || [0, 1, 2, 3, 4, 5, 6], foodInstruction: schedule?.food_instruction || '', enabled: schedule ? schedule.enabled : true });
    setError('');
  };
  const save = async () => {
    if (mutationBusy.current || !editor) return;
    mutationBusy.current = true;
    setBusy('schedule');
    try {
      await readResponse(await apiFetch(`/residents/${encodeURIComponent(residentId)}/medication-schedules/${editor.medicationId}`, { method: 'PUT', body: JSON.stringify({ times: editor.times.split(',').map(value => value.trim()).filter(Boolean), startDate: editor.startDate.trim(), endDate: editor.endDate.trim() || null, weekdays: editor.weekdays, foodInstruction: editor.foodInstruction, timezone: 'Asia/Colombo', enabled: editor.enabled }) }));
      await cancelLocalDoseReminder();
      setEditor(null); await load();
    } catch (failure) { setError(failure.message); }
    finally { mutationBusy.current = false; setBusy(null); }
  };
  const action = async (reminder, status) => {
    if (mutationBusy.current) return;
    mutationBusy.current = true;
    setBusy(reminder.reminder_id);
    try {
      await readResponse(await apiFetch(`/residents/${encodeURIComponent(residentId)}/medication-reminders/${reminder.reminder_id}/action`, { method: 'POST', body: JSON.stringify({ status, minutes: 10, ...(status === 'snoozed' ? { deliveryRound: reminder.delivery_round } : {}) }) }));
      await cancelLocalDoseReminder(reminder.reminder_id);
      await load();
    } catch (failure) { setError(failure.message); }
    finally { mutationBusy.current = false; setBusy(null); }
  };
  const changeDay = amount => setDay(current => new Date(Date.parse(`${current}T00:00:00Z`) + amount * 86_400_000).toISOString().slice(0, 10));
  const completed = reminders.filter(item => ['taken', 'skipped'].includes(item.status)).length;
  const visibleReminders = reminders.filter(item => item.status !== 'cancelled');

  return <View style={styles.panel}>
    <Text style={styles.heading}>Dose reminders</Text>
    <Text style={styles.help}>Exact times in Sri Lanka (Asia/Colombo). Set times confirmed by the prescription or care team.</Text>
    <View style={styles.row}>
      <TouchableOpacity accessibilityLabel="Previous day" onPress={() => changeDay(-1)} style={styles.smallButton}><Text>‹</Text></TouchableOpacity>
      <TouchableOpacity onPress={() => setDay(today())} style={styles.day}><Text style={styles.bold}>{day}</Text><Text style={styles.help}>{completed} of {visibleReminders.length} doses recorded</Text></TouchableOpacity>
      <TouchableOpacity accessibilityLabel="Next day" onPress={() => changeDay(1)} style={styles.smallButton}><Text>›</Text></TouchableOpacity>
    </View>
    {error && !editor ? <TouchableOpacity onPress={load}><Text accessibilityRole="alert" style={styles.error}>{error} Tap to retry.</Text></TouchableOpacity> : null}
    {loading && !reminders.length ? <ActivityIndicator color="#6D38FF" /> : null}
    {!loading && !error && !visibleReminders.length ? <Text style={styles.help}>No scheduled doses for this day.</Text> : null}
    {visibleReminders.map(reminder => {
      const actionable = ['pending', 'snoozed'].includes(reminder.status) && new Date(reminder.scheduled_at).getTime() <= Date.now();
      return <View key={reminder.reminder_id} style={styles.dose}>
        <Text style={styles.bold}>{doseTime(reminder.scheduled_at)} · {reminder.drug_name}</Text>
        <Text style={styles.help}>{reminder.dosage || 'See prescription'}{reminder.food_instruction ? ` · ${reminder.food_instruction}` : ''}</Text>
        <Text style={styles.status}>{reminder.status === 'snoozed' ? `Snoozed until ${doseTime(reminder.presentation_at)}` : reminder.status}</Text>
        {reminder.is_overdue ? <Text style={styles.error}>Overdue — no taken or skipped action has been recorded. Verify with the resident and follow the prescribed instructions.</Text> : null}
        {actionable ? <View style={styles.row}>{[['taken', 'Taken'], ['skipped', 'Skipped'], ['snoozed', 'Snooze 10m']].map(([value, label]) => <TouchableOpacity key={value} accessibilityRole="button" disabled={busy !== null} onPress={() => action(reminder, value)} style={[styles.button, busy !== null && styles.disabled]}><Text style={styles.buttonText}>{busy === reminder.reminder_id ? 'Saving…' : label}</Text></TouchableOpacity>)}</View> : null}
      </View>;
    })}
    <Text style={styles.subheading}>Confirmed medications</Text>
    {medications.map(med => {
      const confirmed = med.confirmed === true || med.confirmed === 1;
      const schedule = schedules.find(item => Number(item.medication_id) === Number(med.id));
      return <View key={med.id} style={styles.dose}><Text style={styles.bold}>{med.drugName || med.drug_name}</Text><Text style={styles.help}>{schedule ? `${schedule.enabled ? 'Active' : 'Paused'}: ${schedule.times.join(', ')}` : 'No dose times configured'}</Text><TouchableOpacity disabled={!confirmed} onPress={() => edit(med)} style={[styles.button, !confirmed && styles.disabled]}><Text style={styles.buttonText}>{confirmed ? schedule ? 'Edit dose times' : 'Set dose times' : 'Confirm prescription first'}</Text></TouchableOpacity></View>;
    })}
    <Modal visible={Boolean(editor)} transparent animationType="slide" onRequestClose={() => { if (!busy) setEditor(null); }}>
      <View style={styles.overlay}><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.modal}>
        <Text style={styles.heading}>{editor?.name}</Text>
        <Text style={styles.help}>Enter the approved regimen. Reminder times do not determine the prescribed dose.</Text>
        {editor ? <>
          {[['times', 'Dose times, comma separated (24-hour HH:MM)', '08:00, 20:00'], ['startDate', 'Start date (YYYY-MM-DD)', 'YYYY-MM-DD'], ['endDate', 'End date (optional YYYY-MM-DD)', 'YYYY-MM-DD'], ['foodInstruction', 'Food instruction from prescription (optional)', 'Prescribed instruction']].map(([key, label, placeholder]) => <View key={key}><Text style={styles.label}>{label}</Text><TextInput accessibilityLabel={label} value={editor[key]} placeholder={placeholder} autoCapitalize="none" onChangeText={value => setEditor(current => ({ ...current, [key]: value }))} style={styles.input} /></View>)}
          <Text style={styles.label}>Repeat on</Text><View style={styles.weekdays}>{weekdays.map((label, index) => <TouchableOpacity key={label} accessibilityRole="checkbox" accessibilityState={{ checked: editor.weekdays.includes(index) }} onPress={() => setEditor(current => ({ ...current, weekdays: current.weekdays.includes(index) ? current.weekdays.filter(value => value !== index) : [...current.weekdays, index] }))} style={[styles.weekday, editor.weekdays.includes(index) && styles.selected]}><Text style={editor.weekdays.includes(index) ? styles.buttonText : styles.help}>{label}</Text></TouchableOpacity>)}</View>
          <View style={styles.row}><Text style={styles.label}>Reminders enabled</Text><Switch value={editor.enabled} onValueChange={enabled => setEditor(current => ({ ...current, enabled }))} /></View>
        </> : null}
        {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
        <TouchableOpacity disabled={busy !== null} onPress={save} style={[styles.button, busy !== null && styles.disabled]}><Text style={styles.buttonText}>{busy === 'schedule' ? 'Saving…' : 'Save schedule'}</Text></TouchableOpacity>
        <TouchableOpacity disabled={busy !== null} onPress={() => { setEditor(null); setError(''); }} style={styles.smallButton}><Text>Cancel</Text></TouchableOpacity>
      </ScrollView></View>
    </Modal>
  </View>;
}

const styles = StyleSheet.create({
  panel: { backgroundColor: '#FFFFFF', borderRadius: 24, padding: 18, marginBottom: 22, borderColor: '#E6E1FB', borderWidth: 1 },
  heading: { fontSize: 21, fontWeight: '800', color: '#171459', marginBottom: 8 },
  subheading: { fontSize: 16, fontWeight: '700', color: '#171459', marginTop: 20 },
  help: { color: '#615C87', fontSize: 12, lineHeight: 19 },
  bold: { fontWeight: '700', color: '#171459', fontSize: 14, lineHeight: 21 },
  status: { color: '#5355B7', fontSize: 12, marginTop: 4, marginBottom: 8, textTransform: 'capitalize' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6, marginTop: 10 },
  day: { alignItems: 'center', flex: 1 },
  dose: { borderTopColor: '#EEE9FF', borderTopWidth: 1, paddingTop: 12, marginTop: 12 },
  button: { minHeight: 44, paddingHorizontal: 10, paddingVertical: 12, borderRadius: 12, backgroundColor: '#6D38FF', alignItems: 'center', justifyContent: 'center', marginTop: 5 },
  buttonText: { color: '#FFFFFF', fontSize: 12, fontWeight: '700' },
  smallButton: { minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center', padding: 10 },
  disabled: { opacity: 0.45 }, error: { color: '#A12B24', fontSize: 13, lineHeight: 20, marginTop: 8 },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 20 },
  modal: { backgroundColor: '#FFFFFF', padding: 22, borderRadius: 20 },
  input: { minHeight: 46, borderWidth: 1, borderColor: '#D9D3F0', borderRadius: 10, padding: 10, color: '#171459' },
  label: { fontSize: 12, fontWeight: '700', color: '#171459', marginTop: 14, marginBottom: 7 },
  weekdays: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  weekday: { minWidth: 40, minHeight: 44, padding: 9, borderRadius: 10, backgroundColor: '#EEE9FF', alignItems: 'center', justifyContent: 'center' }, selected: { backgroundColor: '#6D38FF' },
});
