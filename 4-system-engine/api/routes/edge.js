import { Router } from 'express';
import pool from '../db.js';
import { edgeAuthMiddleware } from '../middleware/edgeAuth.js';
import { hasForbiddenEvidence, recordActivityEvent, appendAudit, hasActiveConsent } from '../monitoringService.js';
import { DEFAULT_SETTINGS, parseJSON, isEnabled, validInstant } from '../monitoringConfig.js';

const router = Router();
router.use(edgeAuthMiddleware);

const ACTIVITIES = new Set(['walking', 'sitting', 'standing', 'lying', 'resting', 'inactivity', 'wandering', 'collapse', 'fall', 'abnormal_movement', 'restricted_entry', 'unknown']);
const finiteRange = (value, minimum, maximum) => Number.isFinite(value) && value >= minimum && value <= maximum;
const timestamp = validInstant;

router.get('/config', async (req, res) => {
  try {
    const [devices] = await pool.execute('SELECT device_id,enabled,camera_state,settings,updated_at FROM monitoring_devices WHERE device_id=?', [req.monitoringDevice.device_id]);
    if (!devices.length) return res.status(404).json({error:'Device not found'});
    const device = devices[0];
    const [assignments] = await pool.execute('SELECT resident_id FROM monitoring_device_residents WHERE device_id=? AND unassigned_at IS NULL', [device.device_id]);
    const residents=[];
    for (const row of assignments) residents.push({residentId:row.resident_id,
      cameraConsent:await hasActiveConsent(pool,row.resident_id,'camera'), activityConsent:await hasActiveConsent(pool,row.resident_id,'activity')});
    const settings={...DEFAULT_SETTINGS,...parseJSON(device.settings)};
    if(residents.length===1){
      const [baselines]=await pool.execute('SELECT baseline FROM activity_baselines WHERE resident_id=?',[residents[0].residentId]);
      const baseline=parseJSON(baselines[0]?.baseline);
      if(baseline?.inactivitySeconds)settings.inactivitySeconds=baseline.inactivitySeconds;
    }
    const [zones] = await pool.execute('SELECT zone_id,name,zone_type,polygon,enabled FROM monitoring_zones WHERE device_id=?', [device.device_id]);
    res.set('Cache-Control','no-store');
    return res.json({deviceId:device.device_id,enabled:isEnabled(device.enabled),cameraState:device.camera_state,
      configVersion:String(device.updated_at),configValidForSeconds:30,settings,residents,
      zones:zones.map(row=>({zoneId:row.zone_id,name:row.name,zoneType:row.zone_type,polygon:parseJSON(row.polygon),enabled:isEnabled(row.enabled)}))});
  } catch (error) {console.error('[Edge config]',error.code||'READ_FAILED');return res.status(503).json({error:'Monitoring configuration unavailable; stop capture until configuration is restored'});}
});

router.post('/events', async (req, res) => {
  try {
    const body = req.body || {};
    const evidenceSize = body.evidence === undefined ? 0 : Buffer.byteLength(JSON.stringify(body.evidence));
    if (typeof body.requestId !== 'string' || !/^[A-Za-z0-9._:-]{8,80}$/.test(body.requestId) ||
        !ACTIVITIES.has(body.activity) || !finiteRange(body.confidence, 0, 1) || !timestamp(body.observedAt) ||
        typeof body.modelVersion !== 'string' || !/^[A-Za-z0-9._:-]{1,80}$/.test(body.modelVersion) ||
        body.residentId !== undefined && body.residentId !== null && (typeof body.residentId !== 'string' || !body.residentId.length || body.residentId.length > 50) ||
        body.endedAt !== undefined && !timestamp(body.endedAt) ||
        body.durationMs !== undefined && (!Number.isSafeInteger(body.durationMs) || body.durationMs < 0 || body.durationMs > 86_400_000) ||
        Date.parse(body.observedAt) > Date.now()+300_000 || Date.parse(body.observedAt) < Date.now()-86_400_000 ||
        body.endedAt !== undefined && Date.parse(body.endedAt) < Date.parse(body.observedAt) ||
        evidenceSize > 8_000 || hasForbiddenEvidence(body)) {
      return res.status(400).json({ error: 'Invalid activity event or prohibited raw-image evidence' });
    }
    const result = await recordActivityEvent(pool, req.monitoringDevice, body);
    return res.status(result.status).json(result.body);
  } catch (error) {
    console.error('[Edge monitoring] Event failed:', error.message);
    return res.status(500).json({ error: 'Activity event could not be saved; the device should retry with the same request ID' });
  }
});

router.post('/health', async (req, res) => {
  let connection;
  try {
    const body = req.body || {};
    if (!timestamp(body.capturedAt) || Math.abs(Date.parse(body.capturedAt)-Date.now()) > 300_000 || typeof body.cameraAvailable !== 'boolean' ||
        body.cpuPercent !== undefined && !finiteRange(body.cpuPercent, 0, 100) ||
        body.memoryPercent !== undefined && !finiteRange(body.memoryPercent, 0, 100) ||
        body.temperatureC !== undefined && !finiteRange(body.temperatureC, -40, 150) ||
        body.queueDepth !== undefined && (!Number.isSafeInteger(body.queueDepth) || body.queueDepth < 0 || body.queueDepth > 1_000_000) ||
        body.softwareVersion !== undefined && (typeof body.softwareVersion !== 'string' || body.softwareVersion.length > 80)) {
      return res.status(400).json({ error: 'Invalid device health sample' });
    }
    connection = await pool.getConnection(); await connection.beginTransaction();
    const [devices]=await connection.execute('SELECT enabled,status FROM monitoring_devices WHERE device_id=? FOR UPDATE',[req.monitoringDevice.device_id]);
    if(!devices.length||!isEnabled(devices[0].enabled)||devices[0].status==='disabled'){
      await connection.rollback();return res.status(403).json({error:'Monitoring device is disabled or no longer registered'});
    }
    const health = {
      cpuPercent: body.cpuPercent ?? null, memoryPercent: body.memoryPercent ?? null,
      temperatureC: body.temperatureC ?? null, cameraAvailable: body.cameraAvailable,
      queueDepth: body.queueDepth || 0, softwareVersion: body.softwareVersion || null,
    };
    await connection.execute(
      `INSERT INTO monitoring_device_health
       (device_id, captured_at, cpu_percent, memory_percent, temperature_c, camera_available, queue_depth, software_version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.monitoringDevice.device_id, new Date(body.capturedAt), health.cpuPercent, health.memoryPercent,
        health.temperatureC, health.cameraAvailable, health.queueDepth, health.softwareVersion],
    );
    await connection.execute(
      `UPDATE monitoring_devices SET status = ?, last_seen_at = NOW(), last_health = ? WHERE device_id = ?`,
      [body.cameraAvailable ? 'online' : 'maintenance', JSON.stringify(health), req.monitoringDevice.device_id],
    );
    await appendAudit(connection, { actorType: 'device', actorId: req.monitoringDevice.device_id,
      action: 'device_health_recorded', resourceType: 'monitoring_device', resourceId: req.monitoringDevice.device_id,
      details: { cameraAvailable: body.cameraAvailable, queueDepth: health.queueDepth } });
    await connection.commit();
    return res.status(202).json({ accepted: true });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    console.error('[Edge monitoring] Health failed:', error.message);
    return res.status(500).json({ error: 'Device health could not be saved' });
  } finally { connection?.release?.(); }
});

export default router;
