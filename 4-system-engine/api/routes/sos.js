import { Router } from 'express';
import pool from '../db.js';
import { createHash } from 'node:crypto';
import { canonicalJSON, validText } from '../validation.js';
import { canAccessResident } from '../middleware/authorization.js';
import {createSosStream,sosChanges,sosSelect} from '../sosRealtime.js';
import {publishCareUpdate} from '../realtimeCare.js';

const router = Router();
const requestUUID = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const registered = req => Boolean(req.user?.uid && req.user?.profile);
const receipt = (alert, replayed) => ({ alertId: alert.id, saved: true, replayed,
  isResolved: alert.is_resolved === true || Number(alert.is_resolved) === 1, residentName: alert.resident_name });

// POST /api/sos-alerts — Create a new SOS emergency alert
router.post('/sos-alerts', async (req, res) => {
  let connection;
  try {
    if (!registered(req)) return res.status(401).json({ error: 'Authentication required' });
    const { residentId, message, requestId } = req.body || {};
    const isStaff = ['caretaker', 'admin'].includes(req.user?.role);
    if (!residentId && !isStaff) return res.status(400).json({ error: 'Provide a valid resident and optional message' });
    if (residentId && !validText(residentId, 50)) return res.status(400).json({ error: 'Provide a valid resident' });
    if (!validText(message, 5000, true)) return res.status(400).json({ error: 'Provide an optional message under 5000 characters' });
    if (requestId !== undefined && !requestUUID(requestId)) return res.status(400).json({ error: 'Provide a valid request UUID', errorCode: 'INVALID_REQUEST_ID' });
    if (residentId && !canAccessResident(req, residentId)) return res.status(403).json({ error: 'You do not have permission to request help for this resident' });
    const key = requestId?.toLowerCase() || null;
    const text = message?.trim() || (residentId ? 'Urgent help requested by the resident or care team' : 'Emergency Panic Alert broadcast by staff');
    const hash = createHash('sha256').update(canonicalJSON({ residentId: residentId || null, message: text })).digest('hex');
    connection = await pool.getConnection(); await connection.beginTransaction();

    let residentName = 'Facility Alert';
    if (residentId) {
      // Lock an existing resident row, including the first SOS with no alert row yet.
      const [rows] = await connection.execute('SELECT name FROM residents WHERE resident_id = ? FOR UPDATE', [residentId]);
      if (!rows.length) { await connection.rollback(); return res.status(404).json({ error: 'Resident not found' }); }
      residentName = rows[0].name;
    }

    if (key) {
      const [prior] = await connection.execute('SELECT id, resident_id, resident_name, request_hash, is_resolved FROM sos_alerts WHERE requested_by_uid = ? AND request_id = ? LIMIT 1 FOR UPDATE', [req.user.uid, key]);
      if (prior.length) {
        if (prior[0].resident_id !== (residentId || null) || prior[0].request_hash !== hash) {
          await connection.rollback();
          return res.status(409).json({ error: 'This request ID was already used for different help details', errorCode: 'REQUEST_CONFLICT' });
        }
        await connection.commit();
        return res.json({ ...receipt(prior[0], true), message: 'Help request was already saved' });
      }
    } else if (residentId) {
      // Preserve legacy cooldown behavior; keyed requests preserve every new report's actual details.
      const [recent] = await connection.execute(`SELECT id, resident_name, is_resolved FROM sos_alerts WHERE resident_id = ? AND is_resolved = FALSE AND created_at > DATE_SUB(NOW(), INTERVAL 30 SECOND) ORDER BY created_at DESC LIMIT 1 FOR UPDATE`, [residentId]);
      if (recent.length) {
        await connection.commit();
        return res.json({ ...receipt(recent[0], true), message: 'SOS alert already active', cooldown: true });
      }
    }
    const [result] = await connection.execute('INSERT INTO sos_alerts (resident_id, resident_name, message, requested_by_uid, request_id, request_hash) VALUES (?, ?, ?, ?, ?, ?)', [residentId || null, residentName, text, req.user.uid, key, hash]);
    await connection.commit();
    sosChanges.emit('change');void publishCareUpdate('emergency',residentId || 'facility');
    return res.status(201).json({ ...receipt({ id: result.insertId, resident_name: residentName, is_resolved: false }, false), message: 'Help request saved to the care dashboard' });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'This request ID was already used. Retry its original details.', errorCode: 'REQUEST_CONFLICT' });
    console.error('[SOS] Create error:', error.code || 'DATABASE_ERROR');
    return res.status(500).json({ error: 'The help request could not be confirmed. Retry the same request or contact your caretaker directly.' });
  } finally { connection?.release(); }
});

// GET /api/sos-alerts — Get all active (unresolved) SOS alerts
router.get('/sos-alerts', async (req, res) => {
  try {
    if (!registered(req)) return res.status(401).json({ error: 'Authentication required' });
    const showAll = req.query.all === 'true';
    const scope = req.user?.role === 'admin' ? null : (req.residentScope || []);
    if (scope && !scope.length) return res.json([]);
    const conditions = showAll ? [] : ['a.is_resolved = FALSE'];
    if (scope) conditions.push(`a.resident_id IN (${scope.map(() => '?').join(',')})`);
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const query = `${sosSelect} ${where} ORDER BY a.created_at DESC LIMIT 100`;
    const [rows] = await pool.execute(query, scope || []);
    res.json(rows);
  } catch (error) {
    console.error('[SOS] List error:', error.message);
    res.status(500).json({ error: 'SOS alerts could not be updated or retrieved. Please retry.' });
  }
});
router.get('/sos-alerts/stream',createSosStream(pool));

// PUT /api/sos-alerts/:id/resolve — Mark an SOS alert as resolved
router.put('/sos-alerts/:id/resolve', async (req, res) => {
  try {
    if (!registered(req)) return res.status(401).json({ error: 'Authentication required' });
    if (!['caretaker', 'admin'].includes(req.user.role)) return res.status(403).json({ error: 'Only assigned care staff can resolve a help request' });
    const id = Number(req.params.id);
    if (!/^\d+$/.test(req.params.id) || !Number.isSafeInteger(id) || id < 1 || id > 2147483647) return res.status(400).json({ error: 'Invalid alert ID' });
    const [rows] = await pool.execute('SELECT resident_id, is_resolved FROM sos_alerts WHERE id = ? LIMIT 1', [id]);
    if (!rows.length) return res.status(404).json({ error: 'Help request not found' });
    if (!canAccessResident(req, rows[0].resident_id)) return res.status(403).json({ error: 'This resident is not assigned to your care' });
    const resolvedBy = req.user.profile?.name || req.user.email || req.user.uid;

    const alreadyResolved = rows[0].is_resolved === true || Number(rows[0].is_resolved) === 1;
    if (!alreadyResolved) await pool.execute(
      `UPDATE sos_alerts SET is_resolved = TRUE, resolved_by = ?, resolved_by_uid = ?, resolved_at = NOW() WHERE id = ? AND resident_id = ? AND is_resolved = FALSE`,
      [resolvedBy, req.user.uid, id, rows[0].resident_id]);

    const [resolved] = await pool.execute('SELECT resolved_by, resolved_by_uid, resolved_at, is_resolved FROM sos_alerts WHERE id = ? LIMIT 1', [id]);
    if (!resolved.length) return res.status(404).json({ error: 'Help request not found' });
    if (!(resolved[0].is_resolved === true || Number(resolved[0].is_resolved) === 1)) return res.status(503).json({ error: 'Resolution could not be confirmed. Please retry.' });
    sosChanges.emit('change');void publishCareUpdate('emergency',rows[0].resident_id);
    res.json({ message: 'Help request resolved', alertId: id, isResolved: true,
      resolvedBy: resolved[0]?.resolved_by, resolvedByUid: resolved[0]?.resolved_by_uid, resolvedAt: resolved[0]?.resolved_at });
  } catch (error) {
    console.error('[SOS] Resolve error:', error.message);
    res.status(500).json({ error: 'SOS alerts could not be updated or retrieved. Please retry.' });
  }
});

export default router;
