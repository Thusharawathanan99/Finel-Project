export function localDateKey(date = new Date()) {
  return [date.getFullYear(), String(date.getMonth()+1).padStart(2,'0'), String(date.getDate()).padStart(2,'0')].join('-');
}
export function calendarDateKey(value) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? '' : localDateKey(value);
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:$|T| )/.exec(String(value || ''));
  if (!match) return '';
  const date = new Date(Number(match[1]), Number(match[2])-1, Number(match[3]));
  return localDateKey(date) === match.slice(1).join('-') ? match.slice(1).join('-') : '';
}
export function parseCalendarDate(value) {
  const key = calendarDateKey(value);
  if (!key) return null;
  const [year,month,day] = key.split('-').map(Number);
  return new Date(year,month-1,day);
}
export function appointmentInstant(appointment) {
  const date = parseCalendarDate(appointment.appointment_date);
  if (!date) return null;
  const match = /^(\d{1,2}):(\d{2})/.exec(appointment.appointment_time || '');
  if (match) date.setHours(Number(match[1]), Number(match[2]), 0, 0);
  else date.setHours(23,59,59,999);
  return date;
}
export function upcomingAppointments(appointments, now = new Date()) {
  return appointments.filter(item => ['scheduled','rescheduled'].includes(item.status) && appointmentInstant(item)?.getTime() >= now.getTime())
    .sort((a,b) => appointmentInstant(a)-appointmentInstant(b));
}
