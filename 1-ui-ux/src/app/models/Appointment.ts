export type AppointmentStatus = 'scheduled' | 'completed' | 'cancelled' | 'rescheduled';

export class Appointment {
  appointmentId: string;
  residentId: string;
  residentName: string;
  doctorName: string;
  specialization: string;
  appointmentDate: Date;
  appointmentTime: string;
  reason: string;
  status: AppointmentStatus;
  notes?: string;
  createdAt: Date;

  constructor(
    appointmentId: string,
    residentId: string,
    residentName: string,
    doctorName: string,
    specialization: string,
    appointmentDate: Date,
    appointmentTime: string,
    reason: string
  ) {
    this.appointmentId = appointmentId;
    this.residentId = residentId;
    this.residentName = residentName;
    this.doctorName = doctorName;
    this.specialization = specialization;
    this.appointmentDate = appointmentDate;
    this.appointmentTime = appointmentTime;
    this.reason = reason;
    this.status = 'scheduled';
    this.createdAt = new Date();
  }

  static fromApi(row: any): Appointment {
    const appointment = new Appointment(row.appointment_id, row.resident_id, row.resident_name || '', row.doctor_name || '', row.specialization || '', new Date(row.appointment_date), row.appointment_time || '', row.reason || '');
    appointment.status = row.status || 'scheduled';
    appointment.notes = row.notes || undefined;
    appointment.createdAt = row.created_at ? new Date(row.created_at) : new Date();
    return appointment;
  }

  getScheduledAt(): Date {
    const scheduled = new Date(this.appointmentDate);
    const time = this.appointmentTime.match(/^(\d{1,2}):(\d{2})(?:\:\d{2})?\s*(AM|PM)?$/i);
    if (time) {
      let hours = Number(time[1]);
      if (time[3]) hours = hours % 12 + (time[3].toUpperCase() === 'PM' ? 12 : 0);
      scheduled.setHours(hours, Number(time[2]), 0, 0);
    }
    return scheduled;
  }

  isUpcoming(now = new Date()): boolean {
    return (this.status === 'scheduled' || this.status === 'rescheduled') && this.getScheduledAt() >= now;
  }

  cancel(): void {
    this.status = 'cancelled';
  }

  complete(notes?: string): void {
    this.status = 'completed';
    this.notes = notes;
  }

  reschedule(newDate: Date, newTime: string): void {
    this.appointmentDate = newDate;
    this.appointmentTime = newTime;
    this.status = 'rescheduled';
  }
}
