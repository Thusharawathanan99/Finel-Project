import { Dashboard } from '../models/Dashboard';
import { Resident } from '../models/Resident';
import { Prescription } from '../models/Prescription';
import { Medication } from '../models/Medication';
import { EmotionalState } from '../models/EmotionalState';
import { Caretaker, LeaveRequest } from '../models/Caretaker';
import { SystemComponent } from '../models/SystemComponent';
import { Appointment } from '../models/Appointment';
import { User } from '../models/User';
import { residentsApi, caretakersApi, systemApi, appointmentsApi } from './apiService';

function list(value: unknown): any[] | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  const parsed = typeof value === 'string' ? JSON.parse(value) : value;
  if (!Array.isArray(parsed)) throw new Error('A saved resident list has an invalid format.');
  return parsed;
}

function date(value: any): Date | undefined {
  return value ? new Date(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00` : value) : undefined;
}

/** Load into a private snapshot so failed or superseded requests cannot publish partial data. */
export async function loadDashboardSnapshot(user: User): Promise<Dashboard> {
  const snapshot = new Dashboard();
  const rows = await residentsApi.getAll();
  const residents = await Promise.all(rows.map(async row => {
    const full = await residentsApi.getById(row.resident_id);
    const resident = new Resident(full.resident_id, full.name, full.age || 0);
    resident.accountEmail = full.account_email || row.account_email || undefined;
    resident.updatePersonalDetails({
      dateOfBirth: date(full.date_of_birth), address: full.address || undefined,
      city: full.city || undefined, state: full.state || undefined, zipCode: full.zip_code || undefined,
      emergencyContactName: full.emergency_contact_name || undefined,
      emergencyContactPhone: full.emergency_contact_phone || undefined,
      emergencyContactRelation: full.emergency_contact_relation || undefined,
      children: list(full.children), roomNumber: full.room_number || undefined,
      floorNumber: full.floor_number || undefined, admissionDate: date(full.admission_date),
      medicalHistory: full.medical_history || undefined, allergies: list(full.allergies),
      dietaryRestrictions: list(full.dietary_restrictions),
    });
    for (const rx of full.prescriptions || []) {
      const prescription = new Prescription(rx.prescription_id, date(rx.date_issued) || new Date(NaN), rx.doctor_name || '');
      for (const med of rx.medications || []) {
        const medication = new Medication(med.drug_name, med.dosage || 'Needs Review', med.frequency || 'Needs Review', med.id, med.duration, med.instructions, med.confidence, Boolean(med.needs_review));
        medication.reviewReasons = list(med.review_reasons) || [];
        medication.conflictingFields = list(med.conflicting_fields) || [];
        medication.sourceDetails = typeof med.source_details === 'string' ? JSON.parse(med.source_details) : med.source_details;
        medication.verifiedByUser = Boolean(med.confirmed || med.verified_by_user);
        prescription.addMedication(medication);
      }
      resident.addPrescription(prescription);
    }
    for (const state of full.emotionalStates || []) {
      resident.addEmotionalState(new EmotionalState(new Date(state.recorded_at), state.state_score));
    }
    resident.finishedMedications = (full.finishedMedications || []).map((med: any) => ({
      id: med.id, residentId: med.resident_id, prescriptionId: med.prescription_id,
      drugName: med.drug_name, dosage: med.dosage || '', frequency: med.frequency || '',
      finishedAt: new Date(med.finished_at),
    }));
    return resident;
  }));
  residents.forEach(resident => snapshot.addResident(resident));
  if (user.role === 'patient' && !snapshot.getResident(user.residentId || '')) {
    throw new Error('Your patient record could not be loaded. Please retry or contact your administrator.');
  }

  const [caretakers, appointments, components] = await Promise.all([
    caretakersApi.getAll(), appointmentsApi.getAll(), systemApi.getComponents(),
  ]);
  for (const row of caretakers) {
    const caretaker = new Caretaker(row.caretaker_id, row.name, row.email || '', row.phone || '', row.specialization || '');
    caretaker.assignedResidents = (list(row.assigned_residents) || []).filter(Boolean);
    caretaker.isActive = row.is_active !== false && row.is_active !== 0;
    snapshot.addCaretaker(caretaker);
  }
  snapshot.appointments = appointments.map(Appointment.fromApi);
  for (const row of components) {
    snapshot.addSystemComponent(new SystemComponent(row.component_id, row.name, row.version || '', row.description || '', row.status || 'online'));
  }
  if (user.role !== 'patient') {
    const requests = user.role === 'admin'
      ? await caretakersApi.getAllLeaveRequests()
      : await caretakersApi.getLeaveRequests(user.userId);
    for (const row of requests) {
      const caretaker = snapshot.getCaretaker(row.caretaker_id);
      if (!caretaker) continue;
      const request = new LeaveRequest(row.request_id, row.caretaker_id, row.caretaker_name || caretaker.name, date(row.start_date) || new Date(NaN), date(row.end_date) || new Date(NaN), row.reason || '');
      request.status = row.status;
      request.requestDate = new Date(row.request_date);
      request.reviewedBy = row.reviewed_by || undefined;
      request.reviewDate = date(row.review_date);
      request.temporaryReplacement = row.temporary_replacement_name || row.temporary_replacement || undefined;
      caretaker.addLeaveRequest(request);
    }
  }
  snapshot.refreshAlerts();
  return snapshot;
}

export function publishDashboardSnapshot(target: Dashboard, snapshot: Dashboard): void {
  target.residents = snapshot.residents.map(resident => {
    const existing = target.getResident(resident.residentId);
    if (existing) { Object.assign(existing, resident); return existing; }
    return resident;
  });
  target.caretakers = snapshot.caretakers.map(caretaker => {
    const existing = target.getCaretaker(caretaker.caretakerId);
    if (existing) { Object.assign(existing, caretaker); return existing; }
    return caretaker;
  });
  target.appointments = snapshot.appointments;
  target.systemComponents = snapshot.systemComponents;
  const acknowledged = new Set(target.alerts.filter(alert => alert.acknowledged).map(alert => alert.severityLevel + ':' + alert.message));
  target.alerts = snapshot.alerts.map(alert => {
    if (acknowledged.has(alert.severityLevel + ':' + alert.message)) alert.acknowledged = true;
    return alert;
  });
  target.emergencyAlerts = snapshot.emergencyAlerts;
}
