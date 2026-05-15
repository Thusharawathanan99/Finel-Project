import { Router } from 'express';
import pool from '../db.js';

const router = Router();

// POST /api/sos-alerts — Create a new SOS emergency alert
router.post('/sos-alerts', async (req, res) => {
  try {
    const { residentId, residentName, message } = req.body;

    if (!residentId) {
      return res.status(400).json({ error: 'residentId is required' });
    }

    // Resolve name if not provided
    let name = residentName;
    if (!name) {
      const [rows] = await pool.execute('SELECT name FROM residents WHERE resident_id = ?', [residentId]);
      name = rows.length > 0 ? rows[0].name : 'Unknown Patient';
    }

    // Check for recent duplicate (30 second cooldown)
    const [recent] = await pool.execute(
      `SELECT id FROM sos_alerts 
       WHERE resident_id = ? AND is_resolved = FALSE AND created_at > DATE_SUB(NOW(), INTERVAL 30 SECOND)
       ORDER BY created_at DESC LIMIT 1`,
      [residentId]
    );

    if (recent.length > 0) {
      return res.json({ message: 'SOS alert already active', alertId: recent[0].id, cooldown: true });
    }

    const [result] = await pool.execute(
      `INSERT INTO sos_alerts (resident_id, resident_name, message) VALUES (?, ?, ?)`,
      [residentId, name, message || 'Emergency SOS triggered by patient']
    );

    console.log(`[SOS] 🚨 EMERGENCY ALERT from ${name} (${residentId})`);

    res.status(201).json({
      message: 'SOS alert created',
      alertId: result.insertId,
      residentName: name
    });
  } catch (error) {
    console.error('[SOS] Create error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/sos-alerts — Get all active (unresolved) SOS alerts
router.get('/sos-alerts', async (req, res) => {
  try {
    const showAll = req.query.all === 'true';
    const query = showAll
      ? 'SELECT * FROM sos_alerts ORDER BY created_at DESC LIMIT 100'
      : 'SELECT * FROM sos_alerts WHERE is_resolved = FALSE ORDER BY created_at DESC';

    const [rows] = await pool.execute(query);
    res.json(rows);
  } catch (error) {
    console.error('[SOS] List error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/sos-alerts/:id/resolve — Mark an SOS alert as resolved
router.put('/sos-alerts/:id/resolve', async (req, res) => {
  try {
    const { resolvedBy } = req.body;

    await pool.execute(
      `UPDATE sos_alerts SET is_resolved = TRUE, resolved_by = ?, resolved_at = NOW() WHERE id = ?`,
      [resolvedBy || 'Admin', req.params.id]
    );

    console.log(`[SOS] ✅ Alert ${req.params.id} resolved by ${resolvedBy || 'Admin'}`);
    res.json({ message: 'SOS alert resolved' });
  } catch (error) {
    console.error('[SOS] Resolve error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

export default router;
