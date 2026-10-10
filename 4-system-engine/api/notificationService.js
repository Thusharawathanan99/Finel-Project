import { materializeReminders, medicationEscalationMinutes } from './medicationScheduling.js';
import { createHash } from 'node:crypto';

const EXPO_BASE = 'https://exp.host/--/api/v2/push';
const RETRYABLE_ERRORS = new Set(['MessageRateExceeded', 'ExpoServerError']);
const MAX_ATTEMPTS = 5;
const after = (now, milliseconds) => new Date(now.getTime() + milliseconds);
const escalationDelay = () => medicationEscalationMinutes() * 60_000;

// Lock-screen text deliberately omits resident, medication and emotion details.
export function pushPayload(delivery, token) {
  const medication = delivery.source_type === 'medication';
  return {
    to: token,
    title: medication ? 'CareConnect reminder' : 'CareConnect care alert',
    body: medication ? 'A scheduled dose is due. Open CareConnect to review it.' : 'A care item needs attention. Open CareConnect to review it.',
    sound: 'default', channelId: medication ? 'medication' : 'care-alerts',
    priority: medication ? 'normal' : 'high', ttl: medication ? 3600 : 86400,
    data: { deliveryId: String(delivery.delivery_id), type: delivery.source_type, sourceId: String(delivery.source_id), ownerUid: delivery.owner_uid },
  };
}

export function classifyPushResult(result) {
  if (result?.status === 'ok' && typeof result.id === 'string' && result.id.length > 0 && result.id.length <= 128) return { status: 'ticket_accepted', ticket: result.id, error: null };
  const error = typeof result?.details?.error === 'string' ? result.details.error.slice(0, 100) : 'InvalidProviderResponse';
  return { status: RETRYABLE_ERRORS.has(error) ? 'retry' : 'failed', ticket: null, error };
}

async function expoRequest(path, payload, fetchImpl) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetchImpl(EXPO_BASE + path, {
      method: 'POST', signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(process.env.EXPO_ACCESS_TOKEN ? { Authorization: `Bearer ${process.env.EXPO_ACCESS_TOKEN}` } : {}) },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const error = new Error(`Expo HTTP ${response.status}`);
      error.code = `Http${response.status}`;
      error.retryable = response.status === 429 || response.status >= 500;
      throw error;
    }
    const data = await response.json();
    if (!data || data.errors?.length || !data.data) {
      const error = new Error('Invalid Expo response'); error.code = data?.errors?.[0]?.code || 'InvalidProviderResponse'; throw error;
    }
    return data.data;
  } finally { clearTimeout(timeout); }
}

const patientScope = `u.role = 'patient' AND u.resident_id = ?`;
const caretakerScope = `u.role = 'caretaker' AND EXISTS (SELECT 1 FROM caretakers c JOIN caretaker_residents cr ON cr.caretaker_id = c.caretaker_id WHERE c.is_active = TRUE AND LOWER(c.email) = LOWER(u.email) AND cr.resident_id = ?)`;
const recipientScope = (type, residentId) => type === 'medication' ? { sql: `${patientScope} OR ${caretakerScope}`, values: [residentId, residentId] }
  : { sql: type === 'notification' ? patientScope : caretakerScope, values: [residentId] };
// Version one preserves already persisted source identities across migration.
// Re-enabling a device creates a fresh generation; foreground refresh does not.
export const registrationKey = delivery => createHash('sha256').update(`${delivery.owner_uid}:${delivery.token_hash}${Number(delivery.registration_version || 1) > 1 ? `:${delivery.registration_version}` : ''}`).digest('hex').slice(0, 16);
export async function enqueue(connection, source, now) {
  const scope = recipientScope(source.type, source.residentId);
  await connection.execute(`INSERT IGNORE INTO push_deliveries
    (source_key, source_type, source_id, resident_id, device_id, owner_uid, token_hash, registration_version, next_attempt_at)
    SELECT CONCAT(?, ':', LEFT(SHA2(CONCAT(d.owner_uid, ':', d.token_hash, IF(d.registration_version > 1, CONCAT(':', d.registration_version), '')), 256), 16)), ?, ?, ?, d.device_id, d.owner_uid, d.token_hash, d.registration_version, ? FROM push_devices d
    JOIN users u ON BINARY u.id = BINARY d.owner_uid
    WHERE d.enabled = TRUE AND (${scope.sql})`,
  [source.key, source.type, source.id, source.residentId, now, ...scope.values]);
}

async function prepareReminders(connection, now) {
  await materializeReminders(connection, now);
  await connection.execute(`UPDATE medication_reminders r LEFT JOIN medication_schedules s ON s.schedule_id = r.schedule_id
    LEFT JOIN medications m ON m.id = r.medication_id SET r.status = 'cancelled'
    WHERE r.status IN ('pending', 'snoozed') AND (s.schedule_id IS NULL OR s.enabled = FALSE OR m.id IS NULL OR m.confirmed = FALSE)`);
  await connection.execute(`UPDATE notifications n JOIN medication_reminders r ON r.notification_id = n.notification_id
    SET n.is_read = TRUE WHERE n.is_read = FALSE AND r.status IN ('cancelled', 'taken', 'skipped')`);
  const [reminders] = await connection.execute(`SELECT * FROM medication_reminders
    WHERE status IN ('pending', 'snoozed') AND presentation_at <= ? AND presentation_at >= ? ORDER BY presentation_at LIMIT 1000`, [now, after(now, -86_400_000)]);
  for (const reminder of reminders) {
    if (reminder.notified_round < reminder.delivery_round) {
      await connection.beginTransaction();
      try {
        const [locked] = await connection.execute("SELECT * FROM medication_reminders WHERE reminder_id = ? AND status IN ('pending', 'snoozed') FOR UPDATE", [reminder.reminder_id]);
        const current = locked[0];
        if (current && current.notified_round < current.delivery_round && new Date(current.presentation_at) <= now) {
          if (!current.notification_id) {
            const [created] = await connection.execute(`INSERT INTO notifications (resident_id, title, message, type, related_id) VALUES (?, ?, ?, 'medication_reminder', ?)`, [current.resident_id, 'Scheduled dose reminder', 'A scheduled dose is due. Review your medication schedule.', String(current.reminder_id)]);
            await connection.execute('UPDATE medication_reminders SET notification_id = ?, notified_round = delivery_round WHERE reminder_id = ?', [created.insertId, current.reminder_id]);
          } else {
            await connection.execute('UPDATE notifications SET is_read = FALSE WHERE notification_id = ?', [current.notification_id]);
            await connection.execute('UPDATE medication_reminders SET notified_round = delivery_round WHERE reminder_id = ?', [current.reminder_id]);
          }
        }
        await connection.commit();
      } catch (error) { await connection.rollback(); throw error; }
    }
    await enqueue(connection, { key: `medication:${reminder.reminder_id}:${reminder.delivery_round}`, type: 'medication', id: reminder.reminder_id, residentId: reminder.resident_id }, now);
    if (new Date(reminder.presentation_at).getTime() <= now.getTime() - escalationDelay()) {
      await enqueue(connection, { key: `medication_overdue:${reminder.reminder_id}:${reminder.delivery_round}`, type: 'medication_overdue', id: reminder.reminder_id, residentId: reminder.resident_id }, now);
    }
  }
}

async function prepareAlerts(connection, now) {
  const sources = [
    { type: 'incident', query: `SELECT incident_id AS id, COALESCE(corrected_resident_id, resident_id) AS resident_id FROM monitoring_incidents WHERE status = 'open' AND COALESCE(corrected_resident_id, resident_id) IS NOT NULL
      UNION SELECT i.incident_id AS id, a.resident_id FROM monitoring_incidents i JOIN monitoring_device_residents a ON a.device_id = i.device_id AND a.unassigned_at IS NULL
      WHERE i.status = 'open' AND i.incident_type = 'device_offline' AND i.resident_id IS NULL AND i.corrected_resident_id IS NULL` },
    { type: 'sos', query: 'SELECT id, resident_id FROM sos_alerts WHERE is_resolved = FALSE' },
    { type: 'wellness', query: "SELECT id, resident_id FROM wellness_alerts WHERE acknowledged = FALSE AND severity IN ('warning', 'critical')" },
    { type: 'notification', query: "SELECT notification_id AS id, resident_id FROM notifications WHERE is_read = FALSE AND type <> 'medication_reminder' AND created_at >= ?" },
  ];
  for (const source of sources) {
    const [rows] = await connection.execute(source.query + ' ORDER BY id DESC LIMIT 1000', source.type === 'notification' ? [after(now, -86_400_000)] : []);
    for (const row of rows) await enqueue(connection, { key: `${source.type}:${row.id}:${createHash('sha256').update(row.resident_id).digest('hex').slice(0, 16)}`, type: source.type, id: row.id, residentId: row.resident_id }, now);
  }
}

// Recheck recipient assignments and source status immediately before sending.
export async function deliveryStillRelevant(connection, delivery, now) {
  const scope = recipientScope(delivery.source_type, delivery.resident_id);
  const [owners] = await connection.execute(`SELECT d.push_token, d.project_id FROM push_devices d JOIN users u ON BINARY u.id = BINARY d.owner_uid
    WHERE d.device_id = ? AND BINARY d.owner_uid = BINARY ? AND d.token_hash = ? AND d.registration_version = ? AND d.enabled = TRUE AND (${scope.sql})`,
  [delivery.device_id, delivery.owner_uid, delivery.token_hash, Number(delivery.registration_version || 1), ...scope.values]);
  if (!owners.length) return null;
  let sql, values = [delivery.source_id, delivery.resident_id];
  if (delivery.source_type === 'medication' || delivery.source_type === 'medication_overdue') {
    sql = `SELECT r.reminder_id, r.delivery_round FROM medication_reminders r JOIN medication_schedules s ON s.schedule_id = r.schedule_id
      JOIN medications m ON m.id = r.medication_id WHERE r.reminder_id = ? AND r.resident_id = ? AND r.status IN ('pending', 'snoozed')
      AND s.enabled = TRUE AND m.confirmed = TRUE AND r.presentation_at <= ? AND r.presentation_at >= ?`;
    values.push(delivery.source_type === 'medication_overdue' ? after(now, -escalationDelay()) : now, after(now, -86_400_000));
  } else if (delivery.source_type === 'incident') sql = `SELECT i.incident_id FROM monitoring_incidents i WHERE i.incident_id = ? AND i.status = 'open'
    AND (COALESCE(i.corrected_resident_id, i.resident_id) = ? OR i.incident_type = 'device_offline' AND i.resident_id IS NULL AND i.corrected_resident_id IS NULL
      AND EXISTS (SELECT 1 FROM monitoring_device_residents a WHERE a.device_id = i.device_id AND a.resident_id = ? AND a.unassigned_at IS NULL))`;
  else if (delivery.source_type === 'sos') sql = 'SELECT id FROM sos_alerts WHERE id = ? AND resident_id = ? AND is_resolved = FALSE';
  else if (delivery.source_type === 'wellness') sql = 'SELECT id FROM wellness_alerts WHERE id = ? AND resident_id = ? AND acknowledged = FALSE';
  else if (delivery.source_type === 'notification') sql = 'SELECT notification_id FROM notifications WHERE notification_id = ? AND resident_id = ? AND is_read = FALSE';
  else return null;
  if (delivery.source_type === 'incident') values.push(delivery.resident_id);
  const [sources] = await connection.execute(sql, values);
  if (!sources.length || ['medication', 'medication_overdue'].includes(delivery.source_type) && delivery.source_key !== `${delivery.source_type}:${delivery.source_id}:${sources[0].delivery_round}:${registrationKey(delivery)}`) return null;
  return owners[0];
}

async function saveResult(connection, delivery, result, now) {
  const status = result.status === 'retry' && delivery.attempts + 1 >= MAX_ATTEMPTS ? 'failed' : result.status;
  const retryAt = after(now, Math.min(60 * 60_000, 30_000 * 2 ** delivery.attempts));
  await connection.execute(`UPDATE push_deliveries SET status = ?, expo_ticket_id = ?, provider_error = ?, next_attempt_at = ? WHERE delivery_id = ? AND status = 'sending'`,
    [status, result.ticket || null, result.error || null, status === 'ticket_accepted' ? after(now, 15 * 60_000) : retryAt, delivery.delivery_id]);
  if (result.error === 'DeviceNotRegistered') await connection.execute('UPDATE push_devices SET enabled = FALSE, last_error = ? WHERE device_id = ? AND token_hash = ?', [result.error, delivery.device_id, delivery.token_hash]);
  else if (result.error) await connection.execute('UPDATE push_devices SET last_error = ? WHERE device_id = ? AND token_hash = ?', [result.error, delivery.device_id, delivery.token_hash]);
}

async function dispatchPending(connection, now, fetchImpl) {
  // A process crash or an ambiguous transport failure cannot prove delivery.
  // Preserve "unknown" instead of silently resending an already accepted push.
  await connection.execute("UPDATE push_deliveries SET status = 'unknown', provider_error = 'InterruptedDispatch' WHERE status = 'sending' AND last_attempt_at < ?", [after(now, -5 * 60_000)]);
  const [rows] = await connection.execute("SELECT * FROM push_deliveries WHERE status IN ('pending', 'retry') AND next_attempt_at <= ? AND attempts < ? ORDER BY delivery_id LIMIT 100", [now, MAX_ATTEMPTS]);
  const groups = new Map();
  for (const row of rows) {
    const recipient = await deliveryStillRelevant(connection, row, now);
    if (!recipient) { await connection.execute("UPDATE push_deliveries SET status = 'cancelled' WHERE delivery_id = ? AND status IN ('pending', 'retry')", [row.delivery_id]); continue; }
    const [claimed] = await connection.execute("UPDATE push_deliveries SET status = 'sending', attempts = attempts + 1, last_attempt_at = ? WHERE delivery_id = ? AND status IN ('pending', 'retry')", [now, row.delivery_id]);
    if (!claimed.affectedRows) continue;
    const group = groups.get(recipient.project_id) || []; group.push({ row, payload: pushPayload(row, recipient.push_token) }); groups.set(recipient.project_id, group);
  }
  // Expo rejects requests containing tokens from different projects.
  for (const prepared of groups.values()) {
    const group = [];
    for (const item of prepared) {
      // A dose action, token rotation or account switch can happen while another
      // group is sending. Verify the claim and source again at the send boundary.
      const [claim] = await connection.execute("SELECT delivery_id FROM push_deliveries WHERE delivery_id = ? AND status = 'sending'", [item.row.delivery_id]);
      const recipient = claim.length && await deliveryStillRelevant(connection, item.row, now);
      if (recipient) group.push({ ...item, payload: pushPayload(item.row, recipient.push_token) });
      else await connection.execute("UPDATE push_deliveries SET status = 'cancelled' WHERE delivery_id = ? AND status = 'sending'", [item.row.delivery_id]);
    }
    if (!group.length) continue;
    let tickets;
    try { tickets = await expoRequest('/send', group.map(item => item.payload), fetchImpl); }
    catch (error) {
      for (const { row } of group) await saveResult(connection, row, { status: error.retryable ? 'retry' : error.code ? 'failed' : 'unknown', error: error.code || 'TransportOutcomeUnknown' }, now);
      continue;
    }
    if (!Array.isArray(tickets) || tickets.length !== group.length) {
      for (const { row } of group) await saveResult(connection, row, { status: 'unknown', error: 'UnexpectedTicketCount' }, now);
      continue;
    }
    for (let index = 0; index < group.length; index += 1) await saveResult(connection, group[index].row, classifyPushResult(tickets[index]), now);
  }
}

async function checkReceipts(connection, now, fetchImpl) {
  const [rows] = await connection.execute("SELECT * FROM push_deliveries WHERE status = 'ticket_accepted' AND next_attempt_at <= ? ORDER BY delivery_id LIMIT 100", [now]);
  if (!rows.length) return;
  let receipts;
  try { receipts = await expoRequest('/getReceipts', { ids: rows.map(row => row.expo_ticket_id) }, fetchImpl); }
  catch {
    await connection.execute("UPDATE push_deliveries SET next_attempt_at = ? WHERE status = 'ticket_accepted' AND next_attempt_at <= ?", [after(now, 5 * 60_000), now]);
    return;
  }
  for (const row of rows) {
    const receipt = receipts[row.expo_ticket_id];
    if (!receipt) {
      const expired = new Date(row.last_attempt_at).getTime() < now.getTime() - 23 * 60 * 60_000;
      await connection.execute('UPDATE push_deliveries SET status = ?, provider_error = ?, next_attempt_at = ?, receipt_checked_at = ? WHERE delivery_id = ? AND status = \'ticket_accepted\'', [expired ? 'unknown' : 'ticket_accepted', expired ? 'ReceiptUnavailable' : null, after(now, 5 * 60_000), now, row.delivery_id]);
      continue;
    }
    const error = receipt.status === 'ok' ? null : typeof receipt.details?.error === 'string' ? receipt.details.error.slice(0, 100) : 'ProviderDeliveryFailed';
    const status = receipt.status === 'ok' ? 'provider_accepted' : RETRYABLE_ERRORS.has(error) && row.attempts < MAX_ATTEMPTS ? 'retry' : 'failed';
    await connection.execute('UPDATE push_deliveries SET status = ?, provider_error = ?, next_attempt_at = ?, receipt_checked_at = ? WHERE delivery_id = ? AND status = \'ticket_accepted\'', [status, error, after(now, 60_000), now, row.delivery_id]);
    if (error === 'DeviceNotRegistered') await connection.execute('UPDATE push_devices SET enabled = FALSE, last_error = ? WHERE device_id = ? AND token_hash = ?', [error, row.device_id, row.token_hash]);
    else if (error) await connection.execute('UPDATE push_devices SET last_error = ? WHERE device_id = ? AND token_hash = ?', [error, row.device_id, row.token_hash]);
  }
}

export async function runNotificationCycle(pool, { now = new Date(), fetchImpl = fetch, sendingEnabled = process.env.PUSH_NOTIFICATIONS_ENABLED === 'true' } = {}) {
  const connection = await pool.getConnection();
  let locked = false;
  try {
    const [lock] = await connection.execute("SELECT GET_LOCK('careconnect_notifications_v1', 0) AS acquired");
    locked = Number(lock[0]?.acquired) === 1;
    if (!locked) return { skipped: true };
    await prepareReminders(connection, now);
    await prepareAlerts(connection, now);
    if (sendingEnabled) { await dispatchPending(connection, now, fetchImpl); await checkReceipts(connection, now, fetchImpl); }
    return { skipped: false, sendingEnabled };
  } finally {
    if (locked) await connection.execute("SELECT RELEASE_LOCK('careconnect_notifications_v1')").catch(() => {});
    connection.release();
  }
}

export function notificationWorkerInterval(value = process.env.NOTIFICATION_WORKER_INTERVAL_MS) {
  const parsed = Number(value ?? 30_000);
  return Number.isFinite(parsed) ? Math.min(300_000, Math.max(5000, parsed)) : 30_000;
}

export function startNotificationWorker(pool, { intervalMs = process.env.NOTIFICATION_WORKER_INTERVAL_MS, ...options } = {}) {
  let stopped = false, running = false;
  const tick = async () => {
    if (stopped || running) return;
    running = true;
    try { await runNotificationCycle(pool, options); }
    catch (error) { console.error('[Notifications] Worker cycle failed:', error.code || error.message); }
    finally { running = false; }
  };
  const timer = setInterval(tick, notificationWorkerInterval(intervalMs)); timer.unref?.();
  void tick();
  return () => { stopped = true; clearInterval(timer); };
}
