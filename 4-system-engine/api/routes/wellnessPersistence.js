import { createHash } from 'crypto';
import { canonicalJSON, validText } from '../validation.js';

export function validateObservation(body) {
  if (!body || !validText(body.residentId, 50) || typeof body.stateScore !== 'number' ||
      !Number.isInteger(body.stateScore) || body.stateScore < 0 || body.stateScore > 100) return 'residentId and an integer stateScore from 0 to 100 are required';
  if (!validText(body.emotionLabel, 50, true) || !validText(body.relatedMedicine, 255, true) ||
      !validText(body.note, 5000, true) || !validText(body.observationId, 80, true) ||
      body.category != null && !['positive', 'neutral', 'negative', 'side-effect'].includes(body.category)) return 'Invalid emotion details';
  if (body.source != null && !['self-report', 'experimental-assessment'].includes(body.source)) return 'Invalid observation source';
  if (body.source === 'experimental-assessment') {
    const a = body.assessment;
    const score = value => Number.isInteger(value) && value >= 0 && value <= 100;
    if (body.reviewed !== true || !a || a.version !== 'experimental-expression-audio-v1' ||
        !['happy','surprised','neutral','sad','fearful','disgusted','angry'].includes(a.dominantExpression) ||
        typeof a.capturedAt !== 'string' || !Number.isFinite(Date.parse(a.capturedAt)) ||
        Date.parse(a.capturedAt) > Date.now() + 300000 || Date.parse(a.capturedAt) < Date.now() - 86400000 ||
        !score(a.facialScore) || a.vocalScore != null && !score(a.vocalScore) ||
        a.vocalStabilityScore != null && !score(a.vocalStabilityScore) || a.vocalDistressScore != null && !score(a.vocalDistressScore) ||
        (a.vocalScore != null) !== (a.vocalStabilityScore != null && a.vocalDistressScore != null) ||
        body.stateScore !== Math.round(a.vocalScore == null ? a.facialScore : (a.facialScore + a.vocalScore) / 2) ||
        body.emotionLabel !== 'Expression: ' + a.dominantExpression) return 'Capture a supported expression and explicitly review the experimental assessment before saving';
  }
  const label = (body.emotionLabel || '').toLowerCase();
  if (/^(happy|content)$/.test(label) && (body.stateScore <= 50 || body.category && body.category !== 'positive') ||
      /^(sad|angry|in pain|anxious)$/.test(label) && (body.stateScore > 50 || body.category === 'positive')) return 'Emotion label and wellness score are inconsistent';
  return null;
}

export async function persistObservation(pool, body, recordHistory = true) {
  const experimental = body.source === 'experimental-assessment';
  const a = experimental ? body.assessment : null;
  const observationNote = experimental ? `[Experimental assessment; reviewed by patient; not a clinical diagnosis] Captured: ${a.capturedAt}. Expression: ${a.dominantExpression}. Facial score: ${a.facialScore}/100.${a.vocalScore == null ? '' : ` Vocal stability: ${a.vocalStabilityScore}/100; acoustic distress proxy: ${a.vocalDistressScore}/100.`}${body.note ? '\n' + body.note : ''}` : body.note || null;
  const data = { residentId: body.residentId, stateScore: body.stateScore, emotionLabel: body.emotionLabel || null,
    category: body.category || null, relatedMedicine: body.relatedMedicine || null, note: observationNote };
  const digest = createHash('sha256').update(canonicalJSON(data)).digest('hex');
  const severity = data.stateScore <= 30 && !experimental ? 'critical' : data.stateScore <= 50 ? 'warning' : 'info';
  let connection;
  try {
    connection = await pool.getConnection(); await connection.beginTransaction();
    // All observation and SOS writers lock this same resident row before deduplication.
    const [residents] = await connection.execute('SELECT name FROM residents WHERE resident_id = ? FOR UPDATE', [data.residentId]);
    if (!residents.length) { await connection.rollback(); return { status: 404, error: 'Resident not found' }; }
    if (recordHistory && body.observationId) {
      const [existing] = await connection.execute('SELECT id, observation_hash, wellness_alert_id FROM emotional_states WHERE resident_id = ? AND observation_id = ? FOR UPDATE', [data.residentId, body.observationId]);
      if (existing.length) {
        await connection.rollback();
        return existing[0].observation_hash === digest ? { status: 200, ...data, id: existing[0].id, alertId: existing[0].wellness_alert_id,
          severity, alertCreated: false, escalated: false, cooldown: true, existing: true } : { status: 409, error: 'Observation ID already belongs to different data' };
      }
    }
    let id = null;
    if (recordHistory) {
      const [result] = await connection.execute('INSERT INTO emotional_states (resident_id, state_score, emotion_label, category, related_medicine, note, observation_id, observation_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [data.residentId, data.stateScore, data.emotionLabel, data.category, data.relatedMedicine, data.note, body.observationId || null, digest]);
      id = result.insertId;
    }
    let alertId = null, alertCreated = false, escalated = false, cooldown = false;
    if (severity !== 'info') {
      const [recent] = await connection.execute(`SELECT id, severity FROM wellness_alerts WHERE resident_id = ? AND acknowledged = FALSE AND created_at > DATE_SUB(NOW(), INTERVAL 2 MINUTE) ORDER BY created_at DESC LIMIT 1 FOR UPDATE`, [data.residentId]);
      if (recent.length) {
        alertId = recent[0].id;
        if (severity === 'critical' && recent[0].severity !== 'critical') {
          await connection.execute('UPDATE wellness_alerts SET severity = ?, state_score = ?, emotion_label = ?, category = ?, note = ?, acknowledged = FALSE, acknowledged_by = NULL, acknowledged_by_uid = NULL, acknowledged_at = NULL, created_at = NOW() WHERE id = ?',
            [severity, data.stateScore, data.emotionLabel, data.category, data.note, alertId]);
          escalated = true;
        } else cooldown = true;
      } else {
        const [alert] = await connection.execute('INSERT INTO wellness_alerts (resident_id, resident_name, emotion_label, state_score, category, note, severity) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [data.residentId, residents[0].name, data.emotionLabel, data.stateScore, data.category, data.note, severity]);
        alertId = alert.insertId; alertCreated = true;
      }
    }
    if (id && alertId) await connection.execute('UPDATE emotional_states SET wellness_alert_id = ? WHERE id = ?', [alertId, id]);
    await connection.commit();
    return { status: recordHistory || alertCreated ? 201 : 200, ...data, id, residentName: residents[0].name,
      alertId, severity, alertCreated, escalated, cooldown, message: recordHistory ? 'Emotional state recorded' : alertCreated ? 'Wellness alert created' : escalated ? 'Wellness alert escalated' : 'Wellness assessment recorded' };
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    throw error;
  } finally { connection?.release(); }
}
