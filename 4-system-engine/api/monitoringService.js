import { randomUUID, createHash } from 'crypto';
import { canonicalJSON } from './validation.js';
import { parseJSON, isEnabled } from './monitoringConfig.js';

const INCIDENT_RULES = Object.freeze({
  fall: { type: 'fall', severity: 'critical', minimum: 0.70, action: 'Check the resident immediately, assess for injury, and contact emergency services when needed.' },
  collapse: { type: 'collapse', severity: 'critical', minimum: 0.70, action: 'Check responsiveness immediately and contact emergency services when needed.' },
  inactivity: { type: 'prolonged_inactivity', severity: 'warning', minimum: 0.75, action: 'Check the resident and verify that the inactivity is expected.' },
  wandering: { type: 'wandering', severity: 'warning', minimum: 0.80, action: 'Locate the resident and verify their safety and intended destination.' },
  restricted_entry: { type: 'restricted_entry', severity: 'critical', minimum: 0.70, action: 'Check the restricted area immediately and guide the resident to safety.' },
  abnormal_movement: { type: 'abnormal_movement', severity: 'warning', minimum: 0.85, action: 'Observe the resident and verify whether assistance is required.' },
});

export const sha256 = value => createHash('sha256').update(value).digest('hex');

export function hasForbiddenEvidence(value) {
  if (typeof value === 'string') return /(?:data:\s*(?:image|video)\/|(?:blob|file):|(?:rtsps?|https?):\/\/)/i.test(value) ||
    /^(?:\/9j\/|iVBORw0KGgo|R0lGOD|UklGR)[A-Za-z0-9+/=\s]{12,}$/.test(value.trim());
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some(hasForbiddenEvidence);
  return Object.entries(value).some(([key, item]) =>
    /(image|frame|snapshot|base64|data.?url|video|photo)/i.test(key) || hasForbiddenEvidence(item));
}

export async function hasActiveConsent(connection, residentId, scope, at = new Date()) {
  const [rows] = await connection.execute(
    `SELECT status, expires_at FROM monitoring_consents
     WHERE resident_id = ? AND scope = ? AND effective_at <= ?
     ORDER BY effective_at DESC, consent_id DESC LIMIT 1`,
    [residentId, scope, at],
  );
  if (!rows.length || rows[0].status !== 'granted') return false;
  return !rows[0].expires_at || new Date(rows[0].expires_at).getTime() > at.getTime();
}

// Synchronization and identity correction share the same privacy boundary.
// A later regrant cannot restore permission for evidence invalidated by withdrawal.
export async function hasObservationConsent(connection, residentId, observedAt, now = new Date()) {
  for (const scope of ['camera', 'activity']) {
    if (!await hasActiveConsent(connection, residentId, scope, observedAt) ||
        !await hasActiveConsent(connection, residentId, scope, now)) return false;
    const [withdrawals] = await connection.execute(
      `SELECT consent_id FROM monitoring_consents WHERE resident_id=? AND scope=? AND status='withdrawn' AND effective_at>=? AND effective_at<=? LIMIT 1`,
      // Older databases used second precision; reject this boundary conservatively.
      [residentId, scope, new Date(Math.floor(observedAt.getTime() / 1000) * 1000), now],
    );
    if (withdrawals.length) return false;
  }
  return true;
}

export async function appendAudit(connection, {
  actorType, actorId, action, resourceType, resourceId = null, residentId = null, details = null,
}) {
  await connection.execute(
    `INSERT INTO audit_events (actor_type, actor_id, action, resource_type, resource_id, resident_id, details)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [actorType, actorId, action, resourceType, resourceId, residentId, details ? JSON.stringify(details) : null],
  );
}

function incidentReason(activity, evidence) {
  const duration = Number(evidence?.durationMs || 0);
  if (activity === 'fall') return 'A rapid standing-to-floor transition was detected from pose measurements. A caretaker must verify the event.';
  if (activity === 'collapse') return 'A rapid vertical collapse was detected from pose measurements. A caretaker must verify the event.';
  if (activity === 'inactivity') return `No meaningful movement was measured${duration ? ` for approximately ${Math.round(duration / 60000)} minute(s)` : ''}.`;
  if (activity === 'wandering') return 'Repeated movement across the monitored area exceeded the configured wandering threshold.';
  if (activity === 'restricted_entry') return `A tracked person entered${evidence?.zoneName ? ` the restricted zone “${String(evidence.zoneName).slice(0, 100)}”` : ' a restricted zone'}.`;
  return 'Movement differed from the configured activity baseline and requires human review.';
}

export async function recordActivityEvent(pool, device, payload) {
  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const [devices] = await connection.execute(
      'SELECT device_id, enabled, status, camera_state, settings FROM monitoring_devices WHERE device_id = ? FOR UPDATE',
      [device.device_id],
    );
    if (!devices.length || !isEnabled(devices[0].enabled) || devices[0].status === 'disabled' || devices[0].camera_state !== 'running') {
      await connection.rollback();
      return { status: 403, body: { error: 'Monitoring device is stopped, paused, disabled or no longer registered' } };
    }

    const requestHash = sha256(canonicalJSON(payload));
    const [duplicate] = await connection.execute(
      'SELECT event_id, resident_id, activity, confidence, request_hash FROM activity_events WHERE device_id = ? AND request_id = ? LIMIT 1',
      [device.device_id, payload.requestId],
    );
    if (duplicate.length) {
      if (duplicate[0].request_hash !== requestHash) {
        await connection.rollback();return {status:409,body:{error:'This event request ID was used for different evidence'}};
      }
      await connection.commit();
      const { request_hash, ...saved } = duplicate[0];
      return { status: 200, body: { ...saved, replayed: true } };
    }

    const [assignments] = await connection.execute(
      `SELECT resident_id, assigned_at FROM monitoring_device_residents
       WHERE device_id = ? AND unassigned_at IS NULL ORDER BY assigned_at DESC`,
      [device.device_id],
    );
    let residentId = payload.residentId || null;
    if (residentId && !assignments.some(row => row.resident_id === residentId)) {
      await connection.rollback();
      return { status: 403, body: { error: 'Resident is not assigned to this monitoring device' } };
    }
    const anonymous = payload.activity === 'unknown' && payload.residentId == null;
    if (!residentId && assignments.length === 1 && !anonymous) residentId = assignments[0].resident_id;
    if (!residentId && !anonymous || anonymous && !assignments.length) {
      await connection.rollback();
      return { status: 409, body: { error: 'The event cannot be linked safely. Assign exactly one resident or provide an assigned resident ID.' } };
    }

    const observedAt = new Date(payload.observedAt);
    const consentResidents = anonymous ? assignments.map(row=>row.resident_id) : [residentId];
    for (const id of consentResidents) {
      const assignment = assignments.find(row=>row.resident_id===id);
      if (assignment?.assigned_at && new Date(assignment.assigned_at).getTime()>observedAt.getTime()) {
        await connection.rollback();return {status:403,body:{error:'The resident was not assigned to this device at capture'}};
      }
      if (!await hasObservationConsent(connection, id, observedAt)) {
        await connection.rollback();return {status:403,body:{error:'Active camera and activity consent are required at capture and synchronization; withdrawal invalidates queued observations'}};
      }
    }
    const settings=parseJSON(devices[0].settings)||{};
    if (settings.enabledActivities && !settings.enabledActivities.includes(payload.activity)) {
      await connection.rollback();return {status:403,body:{error:'This activity type has been disabled by the administrator'}};
    }

    const eventId = randomUUID();
    const evidence = payload.evidence || null;
    await connection.execute(
      `INSERT INTO activity_events
       (event_id, device_id, resident_id, request_id, request_hash, activity, confidence, observed_at, ended_at, duration_ms, model_version, evidence)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [eventId, device.device_id, residentId, payload.requestId, requestHash, payload.activity, payload.confidence,
        observedAt, payload.endedAt ? new Date(payload.endedAt) : null, payload.durationMs ?? null,
        payload.modelVersion, evidence ? JSON.stringify(evidence) : null],
    );

    let incidentId = null;
    const rule = INCIDENT_RULES[payload.activity];
    if (rule && payload.confidence >= rule.minimum) {
      const [created] = await connection.execute(
        `INSERT INTO monitoring_incidents
         (event_id, resident_id, device_id, incident_type, severity, reason, confidence, recommended_action, detected_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [eventId, residentId, device.device_id, rule.type, rule.severity,
          incidentReason(payload.activity, evidence), payload.confidence, rule.action, observedAt],
      );
      incidentId = created.insertId;
    }

    await appendAudit(connection, {
      actorType: 'device', actorId: device.device_id, action: 'activity_event_recorded',
      resourceType: 'activity_event', resourceId: eventId, residentId,
      details: { activity: payload.activity, confidence: payload.confidence, incidentId },
    });
    await connection.execute(
      `UPDATE monitoring_devices SET last_seen_at = NOW(), status = 'online' WHERE device_id = ?`,
      [device.device_id],
    );
    await connection.commit();
    return { status: 201, body: { eventId, residentId, incidentId, requiresHumanReview: Boolean(incidentId), replayed: false } };
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    throw error;
  } finally {
    connection?.release?.();
  }
}

export { INCIDENT_RULES };
