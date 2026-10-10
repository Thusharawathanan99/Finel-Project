import { Router } from 'express';
import pool from '../db.js';
import { validDate } from '../validation.js';
import { canAccessResident } from '../middleware/authorization.js';
import { appendAudit } from '../monitoringService.js';
import { calendarDay, doseInstant, lockResidentMedication, materializeReminders, normalizeSchedule, reminderWithTiming, shiftDay } from '../medicationScheduling.js';

const router = Router();
const identifier = value => /^\d+$/.test(String(value)) && Number.isSafeInteger(Number(value)) && Number(value) > 0;
const allowed = (req, res) => {
  if (!req.user?.uid) { res.status(401).json({ error: 'Authentication required' }); return false; }
  if (!canAccessResident(req, req.params.residentId)) { res.status(403).json({ error: 'Resident access denied' }); return false; }
  return true;
};
const decoded = value => typeof value === 'string' ? JSON.parse(value) : value;

router.get('/residents/:residentId/medication-schedules', async (req, res) => {
  if (!allowed(req, res)) return;
  try {
    const [rows] = await pool.execute(`SELECT s.*, m.drug_name, m.dosage FROM medication_schedules s JOIN medications m ON m.id = s.medication_id WHERE s.resident_id = ? ORDER BY s.schedule_id`, [req.params.residentId]);
    return res.json(rows.map(row => ({ ...row, times: decoded(row.times), weekdays: decoded(row.weekdays), enabled: Boolean(row.enabled) })));
  } catch { return res.status(500).json({ error: 'Medication schedules could not be loaded' }); }
});

router.put('/residents/:residentId/medication-schedules/:medicationId', async (req, res) => {
  if (!allowed(req, res)) return;
  if (!identifier(req.params.medicationId)) return res.status(400).json({ error: 'Invalid medication ID' });
  let schedule;
  try { schedule = normalizeSchedule(req.body); }
  catch (error) { return res.status(400).json({ error: error.message }); }
  let connection;
  try {
    connection = await pool.getConnection(); await connection.beginTransaction();
    const medication = await lockResidentMedication(connection, req.params.medicationId, req.params.residentId);
    if (!medication) { await connection.rollback(); return res.status(404).json({ error: 'Current medication not found' }); }
    if (!medication.confirmed) { await connection.rollback(); return res.status(409).json({ error: 'Confirm the prescription medication before setting dose reminders' }); }
    const [currentRows] = await connection.execute('SELECT * FROM medication_schedules WHERE medication_id = ? AND resident_id = ? FOR UPDATE', [req.params.medicationId, req.params.residentId]);
    const current = currentRows[0];
    if (current && JSON.stringify(normalizeSchedule({ times: decoded(current.times), weekdays: decoded(current.weekdays), timezone: current.timezone,
      startDate: current.start_date, endDate: current.end_date, foodInstruction: current.food_instruction || '', enabled: Boolean(current.enabled) })) === JSON.stringify(schedule)) {
      // A lost acknowledgement or unchanged editor save must not restart a
      // snoozed dose or generate another delivery round.
      await connection.commit();
      return res.json({ medication_id: Number(req.params.medicationId), ...schedule, replayed: true });
    }
    await connection.execute(`INSERT INTO medication_schedules
      (resident_id, medication_id, times, weekdays, timezone, start_date, end_date, food_instruction, enabled, created_by_uid)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE times = VALUES(times), weekdays = VALUES(weekdays), timezone = VALUES(timezone),
       start_date = VALUES(start_date), end_date = VALUES(end_date), food_instruction = VALUES(food_instruction), enabled = VALUES(enabled), created_by_uid = VALUES(created_by_uid)`,
    [req.params.residentId, Number(req.params.medicationId), JSON.stringify(schedule.times), JSON.stringify(schedule.weekdays), schedule.timezone, schedule.startDate, schedule.endDate, schedule.foodInstruction || null, schedule.enabled, req.user.uid]);
    // Past completed doses stay immutable when a schedule is changed.
    await connection.execute(`UPDATE medication_reminders SET status = 'cancelled' WHERE resident_id = ? AND medication_id = ? AND status IN ('pending', 'snoozed')`, [req.params.residentId, req.params.medicationId]);
    await materializeReminders(connection, new Date(), { residentId: req.params.residentId, medicationId: Number(req.params.medicationId) });
    await connection.execute(`UPDATE notifications n JOIN medication_reminders r ON r.notification_id = n.notification_id
      SET n.is_read = TRUE WHERE r.resident_id = ? AND r.medication_id = ? AND (r.status IN ('cancelled', 'taken', 'skipped') OR r.presentation_at > ?)`, [req.params.residentId, req.params.medicationId, new Date()]);
    await appendAudit(connection, { actorType: 'user', actorId: req.user.uid, action: 'medication_schedule_updated', resourceType: 'medication', resourceId: String(req.params.medicationId), residentId: req.params.residentId, details: schedule });
    await connection.commit();
    return res.json({ medication_id: Number(req.params.medicationId), ...schedule });
  } catch { if (connection) await connection.rollback().catch(() => {}); return res.status(500).json({ error: 'Medication schedule could not be saved' }); }
  finally { connection?.release(); }
});

router.get('/residents/:residentId/medication-reminders', async (req, res) => {
  if (!allowed(req, res)) return;
  const day = req.query.day || calendarDay();
  if (!validDate(day)) return res.status(400).json({ error: 'Invalid calendar day' });
  let connection;
  try {
    connection = await pool.getConnection(); await connection.beginTransaction();
    await materializeReminders(connection, new Date(), { residentId: req.params.residentId, day });
    const [rows] = await connection.execute(`SELECT * FROM medication_reminders WHERE resident_id = ?
      AND (event_day = ? OR status = 'snoozed' AND presentation_at >= ? AND presentation_at < ?)
      ORDER BY scheduled_at, reminder_id`, [req.params.residentId, day, doseInstant(day, '00:00'), doseInstant(shiftDay(day, 1), '00:00')]);
    await connection.commit();
    const now = new Date();
    return res.json(rows.map(row => reminderWithTiming(row, now)));
  } catch { if (connection) await connection.rollback().catch(() => {}); return res.status(500).json({ error: 'Dose reminders could not be loaded' }); }
  finally { connection?.release(); }
});

router.post('/residents/:residentId/medication-reminders/:reminderId/action', async (req, res) => {
  if (!allowed(req, res)) return;
  const { status, minutes = 10, deliveryRound } = req.body || {};
  if (!identifier(req.params.reminderId) || !['taken', 'skipped', 'snoozed'].includes(status) || status === 'snoozed' && (!Number.isInteger(minutes) || minutes < 5 || minutes > 120 || !Number.isSafeInteger(deliveryRound) || deliveryRound < 0)) return res.status(400).json({ error: 'Use taken, skipped, or snoozed with 5–120 minutes and the current deliveryRound' });
  let connection;
  try {
    connection = await pool.getConnection(); await connection.beginTransaction();
    // Locate immutable keys without taking a reminder lock. Schedule editing
    // and prescription completion must acquire their parent locks first.
    const [references] = await connection.execute('SELECT * FROM medication_reminders WHERE reminder_id = ? AND resident_id = ?', [req.params.reminderId, req.params.residentId]);
    if (!references[0]) { await connection.rollback(); return res.status(404).json({ error: 'Dose reminder not found' }); }
    const medication = await lockResidentMedication(connection, references[0].medication_id, req.params.residentId);
    const [schedules] = await connection.execute(`SELECT schedule_id, enabled FROM medication_schedules
      WHERE schedule_id = ? AND resident_id = ? AND medication_id = ? FOR UPDATE`, [references[0].schedule_id ?? null, req.params.residentId, references[0].medication_id]);
    const [rows] = await connection.execute('SELECT * FROM medication_reminders WHERE reminder_id = ? AND resident_id = ? FOR UPDATE', [req.params.reminderId, req.params.residentId]);
    const reminder = rows[0];
    if (!reminder) { await connection.rollback(); return res.status(404).json({ error: 'Dose reminder not found' }); }
    if (reminder.status === status && status !== 'snoozed') { await connection.commit(); return res.json({ ...reminder, replayed: true }); }
    if (status === 'snoozed' && Number(reminder.delivery_round) !== deliveryRound) {
      const [actions] = await connection.execute('SELECT action, actor_uid, snooze_minutes FROM medication_reminder_actions WHERE reminder_id = ? ORDER BY action_id DESC LIMIT 1', [reminder.reminder_id]);
      if (reminder.status === 'snoozed' && Number(reminder.delivery_round) === deliveryRound + 1 && actions[0]?.action === status && actions[0]?.actor_uid === req.user.uid && Number(actions[0]?.snooze_minutes) === minutes) {
        await connection.commit(); return res.json({ ...reminder, replayed: true });
      }
      await connection.rollback(); return res.status(409).json({ error: 'This dose reminder has changed. Refresh it before snoozing.' });
    }
    if (['taken', 'skipped', 'cancelled'].includes(reminder.status)) { await connection.rollback(); return res.status(409).json({ error: 'This dose has already been completed or cancelled' }); }
    if (!medication?.confirmed || !schedules[0]?.enabled || Number(schedules[0].schedule_id) !== Number(reminder.schedule_id)
      || Number(medication.id) !== Number(reminder.medication_id)) {
      await connection.rollback(); return res.status(409).json({ error: 'This dose schedule is no longer active. Refresh the medication reminders.' });
    }
    const now = new Date();
    if (new Date(reminder.scheduled_at).getTime() > now.getTime()) { await connection.rollback(); return res.status(409).json({ error: 'This dose is scheduled for a later time' }); }
    const presentationAt = status === 'snoozed' ? new Date(now.getTime() + minutes * 60_000) : reminder.presentation_at;
    await connection.execute(`UPDATE medication_reminders SET status = ?, presentation_at = ?, delivery_round = delivery_round + ?, recorded_by_uid = ?, recorded_at = ? WHERE reminder_id = ?`, [status, presentationAt, status === 'snoozed' ? 1 : 0, req.user.uid, now, reminder.reminder_id]);
    await connection.execute(`UPDATE push_deliveries SET status = 'cancelled' WHERE source_type IN ('medication', 'medication_overdue') AND source_id = ? AND status IN ('pending', 'retry')`, [reminder.reminder_id]);
    if (reminder.notification_id) await connection.execute('UPDATE notifications SET is_read = TRUE WHERE notification_id = ?', [reminder.notification_id]);
    await connection.execute('INSERT INTO medication_reminder_actions (reminder_id, action, actor_uid, snooze_minutes) VALUES (?, ?, ?, ?)', [reminder.reminder_id, status, req.user.uid, status === 'snoozed' ? minutes : null]);
    await appendAudit(connection, { actorType: 'user', actorId: req.user.uid, action: `medication_dose_${status}`, resourceType: 'medication_reminder', resourceId: String(reminder.reminder_id), residentId: req.params.residentId, details: { medicationId: reminder.medication_id, scheduledAt: reminder.scheduled_at, snoozeMinutes: status === 'snoozed' ? minutes : null } });
    await connection.commit();
    return res.json({ reminder_id: reminder.reminder_id, status, presentation_at: presentationAt, delivery_round: Number(reminder.delivery_round) + (status === 'snoozed' ? 1 : 0) });
  } catch { if (connection) await connection.rollback().catch(() => {}); return res.status(500).json({ error: 'Dose action could not be saved' }); }
  finally { connection?.release(); }
});

export default router;
