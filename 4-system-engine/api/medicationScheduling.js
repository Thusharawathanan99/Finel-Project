import { validDate } from './validation.js';

export const SCHEDULE_TIMEZONE = 'Asia/Colombo';
const OFFSET_MS = 330 * 60_000;
const decode = value => typeof value === 'string' ? JSON.parse(value) : value;
export const calendarDay = (now = new Date()) => new Date(new Date(now).getTime() + OFFSET_MS).toISOString().slice(0, 10);
export const shiftDay = (day, amount) => new Date(Date.parse(`${day}T00:00:00Z`) + amount * 86_400_000).toISOString().slice(0, 10);
export const doseInstant = (day, time) => new Date(`${day}T${time}:00+05:30`);

// Match prescription completion's parent-first locks. The lookup only locates
// the parent; both approval and ownership are checked again by locking reads.
export async function lockResidentMedication(connection, medicationId, residentId) {
  const [references] = await connection.execute('SELECT prescription_id FROM medications WHERE id = ?', [medicationId]);
  if (!references[0]) return null;
  const prescriptionId = references[0].prescription_id;
  const [prescriptions] = await connection.execute('SELECT prescription_id FROM prescriptions WHERE prescription_id = ? AND resident_id = ? FOR UPDATE', [prescriptionId, residentId]);
  if (!prescriptions.length) return null;
  const [medications] = await connection.execute('SELECT m.id, m.confirmed FROM medications m WHERE m.id = ? AND m.prescription_id = ? FOR UPDATE', [medicationId, prescriptionId]);
  return medications[0] || null;
}

export function medicationEscalationMinutes(value = process.env.MEDICATION_ESCALATION_MINUTES) {
  const minutes = Number(value ?? 30);
  return Number.isFinite(minutes) && minutes >= 5 && minutes <= 1440 ? minutes : 30;
}

// Overdue describes an unrecorded dose; it does not infer whether a resident
// actually took medication or recommend changing the prescribed regimen.
export function reminderWithTiming(reminder, now = new Date()) {
  const minutes = medicationEscalationMinutes();
  return { ...reminder, escalation_minutes: minutes,
    is_overdue: ['pending', 'snoozed'].includes(reminder.status)
      && new Date(reminder.presentation_at).getTime() <= now.getTime() - minutes * 60_000 };
}

export function normalizeSchedule(body = {}) {
  const { times, startDate, endDate = null, weekdays = [0, 1, 2, 3, 4, 5, 6], timezone = SCHEDULE_TIMEZONE, foodInstruction = '', enabled = true } = body;
  if (!Array.isArray(times) || times.length < 1 || times.length > 8 || times.some(time => typeof time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time))) throw new Error('Choose one to eight exact dose times in HH:MM format');
  if (new Set(times).size !== times.length) throw new Error('Dose times must be distinct');
  if (!validDate(startDate) || endDate !== null && (!validDate(endDate) || endDate < startDate)) throw new Error('Provide valid schedule start/end dates');
  if (!Array.isArray(weekdays) || !weekdays.length || weekdays.length > 7 || weekdays.some(day => !Number.isInteger(day) || day < 0 || day > 6) || new Set(weekdays).size !== weekdays.length) throw new Error('Choose valid distinct weekdays, Sunday = 0');
  if (timezone !== SCHEDULE_TIMEZONE) throw new Error('This installation supports Asia/Colombo schedules');
  if (typeof foodInstruction !== 'string' || foodInstruction.length > 500 || typeof enabled !== 'boolean') throw new Error('Invalid food instruction or schedule status');
  return { times: [...times].sort(), startDate, endDate, weekdays: [...weekdays].sort(), timezone, foodInstruction: foodInstruction.trim(), enabled };
}

export function scheduleDoses(schedule, days) {
  if (!schedule.enabled) return [];
  const times = decode(schedule.times), weekdays = decode(schedule.weekdays);
  return days.flatMap(day => {
    if (day < schedule.start_date || schedule.end_date && day > schedule.end_date || !weekdays.includes(new Date(`${day}T00:00:00Z`).getUTCDay())) return [];
    return times.map(time => ({ day, time, at: doseInstant(day, time) }));
  });
}

export async function materializeReminders(connection, now = new Date(), { residentId, medicationId, day } = {}) {
  const today = calendarDay(now);
  const days = day ? [day] : [shiftDay(today, -1), today, shiftDay(today, 1)];
  const [schedules] = await connection.execute(
    `SELECT s.*, m.drug_name, m.dosage FROM medication_schedules s
     JOIN medications m ON m.id = s.medication_id JOIN prescriptions p ON p.prescription_id = m.prescription_id
     WHERE s.enabled = TRUE AND m.confirmed = TRUE AND p.resident_id = s.resident_id${residentId ? ' AND s.resident_id = ?' : ''}${medicationId ? ' AND s.medication_id = ?' : ''}`,
    [...(residentId ? [residentId] : []), ...(medicationId ? [medicationId] : [])],
  );
  for (const schedule of schedules) {
    for (const dose of scheduleDoses(schedule, days)) {
      await connection.execute(
        `INSERT INTO medication_reminders
         (schedule_id, resident_id, medication_id, drug_name, dosage, food_instruction, event_day, scheduled_at, presentation_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           drug_name = IF(status IN ('taken', 'skipped'), drug_name, VALUES(drug_name)),
           dosage = IF(status IN ('taken', 'skipped'), dosage, VALUES(dosage)),
           food_instruction = IF(status IN ('taken', 'skipped'), food_instruction, VALUES(food_instruction)),
           schedule_id = VALUES(schedule_id),
           presentation_at = IF(status = 'cancelled', VALUES(presentation_at), presentation_at),
           delivery_round = delivery_round + IF(status = 'cancelled', 1, 0),
           status = IF(status = 'cancelled', 'pending', status)`,
        [schedule.schedule_id, schedule.resident_id, schedule.medication_id, schedule.drug_name, schedule.dosage,
          schedule.food_instruction || null, dose.day, dose.at, dose.at],
      );
    }
  }
}
