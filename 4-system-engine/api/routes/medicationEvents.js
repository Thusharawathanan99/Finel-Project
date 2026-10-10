import { Router } from 'express';
import pool from '../db.js';
import { validDate } from '../validation.js';
import { canAccessResident } from '../middleware/authorization.js';
import { lockResidentMedication } from '../medicationScheduling.js';
const router = Router();
const allowed = (req, res) => {
  if (!req.user?.uid) { res.status(401).json({ error: 'Authentication required' }); return false; }
  if (!canAccessResident(req, req.params.residentId)) { res.status(403).json({ error: 'Resident access denied' }); return false; }
  return true;
};
router.get('/residents/:residentId/medication-events', async (req, res) => {
  if (!allowed(req, res)) return;
  try {
    if (req.query.day !== undefined && !validDate(req.query.day)) return res.status(400).json({ error: 'Invalid calendar day' });
    const [rows] = await pool.execute(`SELECT medication_id, event_day, status, recorded_by_uid, recorded_at FROM medication_events WHERE resident_id = ?${req.query.day ? ' AND event_day = ?' : ''} ORDER BY event_day DESC LIMIT 5000`,
      req.query.day ? [req.params.residentId, req.query.day] : [req.params.residentId]);
    return res.json(rows);
  } catch { return res.status(500).json({ error: 'Medication progress could not be loaded' }); }
});
router.post('/residents/:residentId/medication-events', async (req, res) => {
  if (!allowed(req, res)) return;
  let connection;
  try {
    const { medicationId, day, status } = req.body || {};
    if (!Number.isSafeInteger(medicationId) || medicationId < 1 || !validDate(day) || !['taken', 'skipped'].includes(status)) return res.status(400).json({ error: 'Provide a medication ID, calendar day and taken/skipped status' });
    connection = await pool.getConnection(); await connection.beginTransaction();
    const medication = await lockResidentMedication(connection, medicationId, req.params.residentId);
    if (!medication?.confirmed) { await connection.rollback(); return res.status(404).json({ error: 'Confirmed current medication not found for this resident' }); }
    const [schedules] = await connection.execute('SELECT schedule_id FROM medication_schedules WHERE medication_id = ? AND resident_id = ? AND enabled = TRUE LIMIT 1', [medicationId, req.params.residentId]);
    if (schedules.length) { await connection.rollback(); return res.status(409).json({ error: 'This medication has timed doses. Record taken or skipped on the individual dose reminder.' }); }
    await connection.execute('INSERT INTO medication_events (resident_id, medication_id, event_day, status, recorded_by_uid) VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE status = VALUES(status), recorded_by_uid = VALUES(recorded_by_uid), recorded_at = NOW()',
      [req.params.residentId, medicationId, day, status, req.user.uid]);
    await connection.commit();
    return res.json({ medication_id: medicationId, event_day: day, status, recorded_by_uid: req.user.uid });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    return res.status(500).json({ error: 'Medication progress could not be saved' });
  } finally { connection?.release(); }
});
export default router;
