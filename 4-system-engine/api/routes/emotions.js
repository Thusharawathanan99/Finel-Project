// Emotional States API routes
import { Router } from 'express';
import pool from '../db.js';
import { createFaceVisionHandler } from './faceVision.js';
import { createFaceVisionStatusHandler } from './faceVisionStatus.js';
import { validateObservation, persistObservation } from './wellnessPersistence.js';
import { publishEmotionObservation } from '../realtimeCare.js';

const router = Router();

// Authenticated, quota-limited descriptive face detection; never writes wellness data.
router.post('/emotions/analyze-image', createFaceVisionHandler());

// Registered-account setup metadata only; does not consume inference quota or
// establish that the provider is reachable or has analyzed an image.
router.get('/emotions/face-status', createFaceVisionStatusHandler());

// GET /api/residents/:residentId/emotions — Get emotional state history
router.get('/residents/:residentId/emotions', async (req, res) => {
  try {
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const [rows] = await pool.execute(
      'SELECT * FROM emotional_states WHERE resident_id = ? ORDER BY recorded_at DESC LIMIT ?',
      [req.params.residentId, limit]
    );
    res.json(rows);
  } catch (error) {
    console.error('[Emotions] List error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/emotions — Record a new emotional state
router.post('/emotions', async (req, res) => {
  const invalid = validateObservation(req.body);
  if (invalid) return res.status(400).json({ error: invalid });
  try {
    const result = await persistObservation(pool, req.body, true);
    if (result.status < 300) {
      const realtime = await publishEmotionObservation(req, result, { ...req.body,
        provenance: req.body.source || 'self-report', reviewRequired: req.body.source === 'experimental-assessment' });
      result.realtimePublished = realtime.published;
      result.realtimePending = !realtime.published;
    }
    return res.status(result.status).json(result);
  } catch (error) {
    console.error('[Emotions] Record error:', error.message);
    return res.status(500).json({ error: 'The observation and alert could not be saved. Please retry.' });
  }
});

// ── Wellness Alerts ──

/**
 * Resolve an ID that may be a caretaker_id ("CT001") or Firebase UID to the actual caretaker_id.
 */
async function resolveCaretakerId(id) {
  const [direct] = await pool.execute('SELECT caretaker_id FROM caretakers WHERE caretaker_id = ?', [id]);
  if (direct.length > 0) return direct[0].caretaker_id;

  const [userRows] = await pool.execute('SELECT email FROM users WHERE id = ?', [id]);
  if (userRows.length > 0) {
    const [ctRows] = await pool.execute('SELECT caretaker_id FROM caretakers WHERE email = ?', [userRows[0].email]);
    if (ctRows.length > 0) return ctRows[0].caretaker_id;
  }
  return null;
}

// POST /api/emotions/wellness-alert — Create a wellness alert for assigned caretakers
router.post('/emotions/wellness-alert', async (req, res) => {
  const invalid = validateObservation(req.body);
  if (invalid) return res.status(400).json({ error: invalid });
  try {
    // Compatibility endpoint: observations are recorded once through POST /emotions.
    const result = await persistObservation(pool, req.body, false);
    return res.status(result.status).json(result);
  } catch (error) {
    console.error('[Wellness] Create alert error:', error.message);
    return res.status(500).json({ error: 'The wellness alert could not be saved. Please retry.' });
  }
});

// GET /api/emotions/wellness-alerts/:caretakerId — Get alerts for a caretaker's assigned patients
router.get('/emotions/wellness-alerts', async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Administrator access required' });
    const [rows] = await pool.execute("SELECT * FROM wellness_alerts WHERE acknowledged = FALSE ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END, created_at DESC LIMIT 200");
    return res.json(rows);
  } catch { return res.status(500).json({ error: 'Wellness alerts could not be retrieved' }); }
});
router.get('/emotions/wellness-alerts/:caretakerId', async (req, res) => {
  try {
    const caretakerId = req.authorizedCaretakerId || await resolveCaretakerId(req.params.caretakerId);
    if (!caretakerId) {
      return res.status(404).json({ error: 'Caretaker not found' });
    }

    // Get assigned resident IDs
    const [assignments] = await pool.execute(
      'SELECT resident_id FROM caretaker_residents WHERE caretaker_id = ?',
      [caretakerId]
    );

    if (assignments.length === 0) {
      return res.json([]);
    }

    const residentIds = assignments.map(a => a.resident_id);
    const placeholders = residentIds.map(() => '?').join(',');

    // Fetch unacknowledged alerts for assigned residents (last 24 hours)
    const [alerts] = await pool.execute(
      `SELECT * FROM wellness_alerts 
       WHERE resident_id IN (${placeholders}) 
         AND acknowledged = FALSE
       ORDER BY 
         CASE severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,
         created_at DESC
       LIMIT 50`,
      residentIds
    );

    res.json(alerts);
  } catch (error) {
    console.error('[Wellness] Fetch alerts error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/emotions/wellness-alerts/:id/acknowledge — Acknowledge an alert
router.put('/emotions/wellness-alerts/:id/acknowledge', async (req, res) => {
  try {
    const acknowledgedBy = req.user.profile?.name || req.user.email || req.user.uid;

    await pool.execute(
      `UPDATE wellness_alerts SET acknowledged = TRUE, acknowledged_by = ?, acknowledged_by_uid = ?, acknowledged_at = NOW() WHERE id = ?`,
      [acknowledgedBy, req.user.uid, req.params.id]
    );

    res.json({ message: 'Alert acknowledged' });
  } catch (error) {
    console.error('[Wellness] Acknowledge error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

export default router;
