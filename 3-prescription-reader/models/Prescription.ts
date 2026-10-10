import { Medication } from './Medication';

export class Prescription {
  prescriptionId: string;
  dateIssued: Date;
  doctorName: string;
  patientName?: string;
  rawText?: string;
  medications: Medication[]; // Composition: medications cannot exist without prescription

  constructor(prescriptionId: string, dateIssued: Date, doctorName: string, patientName?: string, rawText?: string) {
    this.prescriptionId = prescriptionId;
    this.dateIssued = dateIssued;
    this.doctorName = doctorName;
    this.patientName = patientName;
    this.rawText = rawText;
    this.medications = [];
  }

  addMedication(medication: Medication): void {
    this.medications.push(medication);
  }

  removeMedication(drugName: string): void {
    this.medications = this.medications.filter(m => m.drugName !== drugName);
  }

  // When prescription is deleted, all medications are automatically removed (composition relationship)
  destroy(): void {
    this.medications = [];
  }
}
