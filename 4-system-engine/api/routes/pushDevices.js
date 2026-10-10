import { Router } from 'express';
import { createHash, timingSafeEqual } from 'node:crypto';
import pool from '../db.js';

const router = Router();
const uuid = value => typeof value === 'string' && /^[a-f\d]{8}-[a-f\d]{4}-[1-8][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i.test(value);
export const validPushToken = value => typeof value === 'string' && /^(Expo|Exponent)PushToken\[[A-Za-z\d_-]{16,200}\]$/.test(value);
export const installationHash = value => createHash('sha256').update(value).digest('hex');
export function matchingInstallation(secret, digest) {
  if (typeof secret !== 'string' || !/^[a-f\d]{64}$/i.test(secret) || typeof digest !== 'string' || !/^[a-f\d]{64}$/i.test(digest)) return false;
  return timingSafeEqual(Buffer.from(installationHash(secret), 'hex'), Buffer.from(digest, 'hex'));
}
const signedIn = (req, res) => {
  if (!req.user?.uid || !req.user.profile || !['patient', 'caretaker', 'admin'].includes(req.user.role)) { res.status(403).json({ error: 'A registered authenticated account is required' }); return false; }
  return true;
};

const revocationRequests = new Map();
// Possession of the random installation key authorizes disabling only. This
// endpoint also lets an app revoke stale registration after an offline logout.
export async function revokeInstallationHandler(req, res) {
  const now = Date.now();
  for (const [ip, bucket] of revocationRequests) if (bucket.expiresAt <= now) revocationRequests.delete(ip);
  const ip = String(req.ip || req.socket?.remoteAddress || 'unknown').slice(0, 100);
  if (!revocationRequests.has(ip) && revocationRequests.size >= 10_000) return res.status(429).json({ error: 'Please retry notification cleanup later' });
  const bucket = revocationRequests.get(ip) || { count: 0, expiresAt: now + 60_000 };
  bucket.count += 1; revocationRequests.set(ip, bucket);
  if (bucket.count > 20) { res.set?.('Retry-After', '60'); return res.status(429).json({ error: 'Please retry notification cleanup later' }); }
  const { installationId, installationKey } = req.body || {};
  if (!uuid(installationId) || typeof installationKey !== 'string' || !/^[a-f\d]{64}$/i.test(installationKey)) return res.status(400).json({ error: 'Invalid notification installation' });
  let connection;
  try {
    connection = await pool.getConnection(); await connection.beginTransaction();
    const [rows] = await connection.execute('SELECT device_id, installation_key_hash FROM push_devices WHERE installation_id = ? FOR UPDATE', [installationId]);
    if (rows[0] && matchingInstallation(installationKey, rows[0].installation_key_hash)) {
      await connection.execute('UPDATE push_devices SET enabled = FALSE WHERE device_id = ?', [rows[0].device_id]);
      await connection.execute("UPDATE push_deliveries SET status = 'cancelled' WHERE device_id = ? AND status IN ('pending', 'retry', 'sending')", [rows[0].device_id]);
    }
    await connection.commit();
    // Same response for absent installations or wrong proof; no account/token
    // information is exposed through the possession endpoint.
    return res.json({ unregistered: true });
  } catch { if (connection) await connection.rollback().catch(() => {}); return res.status(503).json({ error: 'Notification cleanup could not complete' }); }
  finally { connection?.release(); }
}

router.get('/push-devices', async (req, res) => {
  if (!signedIn(req, res)) return;
  try {
    const [rows] = await pool.execute('SELECT device_id, installation_id, platform, project_id, enabled, last_error, last_seen_at FROM push_devices WHERE owner_uid = ? ORDER BY device_id', [req.user.uid]);
    return res.json({ sendingEnabled: process.env.PUSH_NOTIFICATIONS_ENABLED === 'true', devices: rows });
  } catch { return res.status(500).json({ error: 'Notification device status could not be loaded' }); }
});

router.post('/push-devices', async (req, res) => {
  if (!signedIn(req, res)) return;
  const { installationId, installationKey, token, platform, projectId } = req.body || {};
  if (!uuid(installationId) || typeof installationKey !== 'string' || !/^[a-f\d]{64}$/i.test(installationKey) || !validPushToken(token) || !['android', 'ios'].includes(platform) || !uuid(projectId)) return res.status(400).json({ error: 'Invalid notification device registration' });
  const allowedProjects = (process.env.EXPO_PUSH_PROJECT_IDS || '').split(',').map(item => item.trim()).filter(Boolean);
  if (allowedProjects.length && !allowedProjects.includes(projectId)) return res.status(400).json({ error: 'This mobile application is not enabled on this server' });
  let connection;
  try {
    connection = await pool.getConnection(); await connection.beginTransaction();
    const tokenHash = installationHash(token);
    const [rows] = await connection.execute('SELECT * FROM push_devices WHERE installation_id = ? OR token_hash = ? FOR UPDATE', [installationId, tokenHash]);
    const installation = rows.find(row => row.installation_id === installationId);
    if (rows.some(row => row.installation_id !== installationId) || installation && !matchingInstallation(installationKey, installation.installation_key_hash)) {
      await connection.rollback(); return res.status(409).json({ error: 'This notification device is registered to another installation' });
    }
    if (!installation || installation.owner_uid !== req.user.uid || !installation.enabled) {
      const [devices] = await connection.execute('SELECT device_id FROM push_devices WHERE owner_uid = ? AND enabled = TRUE FOR UPDATE', [req.user.uid]);
      if (devices.length >= 10) { await connection.rollback(); return res.status(409).json({ error: 'Remove an existing notification device before adding another' }); }
    }
    const renewal = installation && (!installation.enabled || installation.owner_uid !== req.user.uid || installation.token_hash !== tokenHash);
    if (renewal) {
      await connection.execute("UPDATE push_deliveries SET status = 'cancelled' WHERE device_id = ? AND status IN ('pending', 'retry', 'sending')", [installation.device_id]);
    }
    const [result] = await connection.execute(`INSERT INTO push_devices
      (owner_uid, installation_id, installation_key_hash, push_token, token_hash, project_id, platform)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE registration_version = registration_version + ?, owner_uid = VALUES(owner_uid), push_token = VALUES(push_token), token_hash = VALUES(token_hash),
       project_id = VALUES(project_id), platform = VALUES(platform), enabled = TRUE, last_error = NULL, last_seen_at = NOW()`,
    [req.user.uid, installationId, installationHash(installationKey), token, tokenHash, projectId, platform, renewal ? 1 : 0]);
    await connection.commit();
    return res.json({ registered: true, deviceId: installation?.device_id || result.insertId, sendingEnabled: process.env.PUSH_NOTIFICATIONS_ENABLED === 'true' });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    return res.status(error.code === 'ER_DUP_ENTRY' ? 409 : 500).json({ error: 'Notification device registration could not be saved' });
  } finally { connection?.release(); }
});

router.delete('/push-devices', async (req, res) => {
  if (!signedIn(req, res)) return;
  const { installationId, installationKey } = req.body || {};
  if (!uuid(installationId) || typeof installationKey !== 'string' || !/^[a-f\d]{64}$/i.test(installationKey)) return res.status(400).json({ error: 'Invalid notification installation' });
  let connection;
  try {
    connection = await pool.getConnection(); await connection.beginTransaction();
    const [rows] = await connection.execute('SELECT * FROM push_devices WHERE installation_id = ? AND owner_uid = ? FOR UPDATE', [installationId, req.user.uid]);
    if (rows[0] && !matchingInstallation(installationKey, rows[0].installation_key_hash)) { await connection.rollback(); return res.status(403).json({ error: 'Notification installation could not be verified' }); }
    if (rows[0]) {
      await connection.execute('UPDATE push_devices SET enabled = FALSE WHERE device_id = ?', [rows[0].device_id]);
      await connection.execute("UPDATE push_deliveries SET status = 'cancelled' WHERE device_id = ? AND status IN ('pending', 'retry', 'sending')", [rows[0].device_id]);
    }
    await connection.commit();
    return res.status(200).json({ unregistered: true });
  } catch { if (connection) await connection.rollback().catch(() => {}); return res.status(500).json({ error: 'Notification device could not be removed' }); }
  finally { connection?.release(); }
});

export default router;
