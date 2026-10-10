export function wellnessScore(record) {
  const value = record?.state_score ?? record?.wellness_score;
  return value != null && value !== '' && Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= 100 ? Number(value) : null;
}
export function wellnessStyle(score) {
  return score == null ? { color: '#64748B', background: '#F1F5F9', label: 'Not recorded' }
    : score >= 70 ? { color: '#166534', background: '#DCFCE7', label: 'Good' }
    : score >= 50 ? { color: '#854D0E', background: '#FEF9C3', label: 'Moderate' }
    : { color: '#9A3412', background: '#FFEDD5', label: 'Concern' };
}
export const colomboDay = (date = new Date()) => new Date(new Date(date).getTime() + 330 * 60_000).toISOString().slice(0, 10);
export function sevenDayWellness(records = [], now = new Date()) {
  const end = Date.parse(colomboDay(now) + 'T00:00:00Z');
  return Array.from({ length: 7 }, (_, index) => {
    const day = new Date(end - (6 - index) * 86400000).toISOString().slice(0, 10);
    const values = records.filter(record => record.recorded_at && colomboDay(record.recorded_at) === day).map(wellnessScore).filter(value => value != null);
    return { day, score: values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : null };
  });
}
export function doseCountdown(reminders = [], now = Date.now()) {
  const next = reminders.filter(row => ['pending', 'snoozed'].includes(row.status) && new Date(row.presentation_at).getTime() > now)
    .sort((a, b) => new Date(a.presentation_at) - new Date(b.presentation_at))[0];
  if (!next) return { next: null, text: 'No upcoming dose time configured' };
  const seconds = Math.max(0, Math.ceil((new Date(next.presentation_at).getTime() - now) / 1000));
  return { next, text: Math.floor(seconds / 3600) + 'h ' + Math.floor(seconds % 3600 / 60) + 'm ' + seconds % 60 + 's' };
}

