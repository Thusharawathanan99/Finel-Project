import { createHash } from 'crypto';
import pool from '../db.js';
import { isEnabled } from '../monitoringConfig.js';

const windows = new Map();
const WINDOW_MS = 60_000;
const MAX_REQUESTS = 180;

export async function edgeAuthMiddleware(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const match = /^Bearer\s+([A-Za-z0-9_-]{32,})$/.exec(header);
    if (!match) return res.status(401).json({ error: 'A valid device bearer token is required' });
    const tokenHash = createHash('sha256').update(match[1]).digest('hex');
    const [rows] = await pool.execute(
      `SELECT device_id, name, enabled, status FROM monitoring_devices
       WHERE token_hash = ? LIMIT 1`,
      [tokenHash],
    );
    if (!rows.length || !isEnabled(rows[0].enabled) || rows[0].status === 'disabled') {
      return res.status(403).json({ error: 'Monitoring device is disabled or not registered' });
    }
    const now = Date.now();
    for(const [id,entry] of windows) if(now-entry.startedAt>=WINDOW_MS) windows.delete(id);
    const current = windows.get(rows[0].device_id);
    const bucket = !current || now - current.startedAt >= WINDOW_MS ? { startedAt: now, count: 0 } : current;
    bucket.count += 1;
    windows.set(rows[0].device_id, bucket);
    if (bucket.count > MAX_REQUESTS) return res.status(429).json({ error: 'Device request rate exceeded; retry shortly' });
    req.monitoringDevice = rows[0];
    return next();
  } catch (error) {
    console.error('[Edge auth] Verification failed:', error.message);
    return res.status(503).json({ error: 'Device identity could not be verified' });
  }
}

export function resetEdgeRateLimitsForTests() { windows.clear(); }
