import { Prescription } from './Prescription';
import { EmotionalState } from './EmotionalState';
import { WeeklyMealPlan } from '../ml/meal-plan/MealPlan';

export interface PersonalDetails {
  dateOfBirth?: Date;
  address?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  emergencyContactRelation?: string;
  children?: string[];
  roomNumber?: string;
  floorNumber?: string;
  admissionDate?: Date;
  medicalHistory?: string;
  allergies?: string[];
  dietaryRestrictions?: string[];  // vegetarian, vegan, halal, gluten-free, etc.
}

export interface FinishedMedicationRecord {
  id?: number;
  residentId: string;
  prescriptionId: string;
  drugName: string;
  dosage: string;
  frequency: string;
  finishedAt: Date;
}

export class Resident {
  residentId: string;
  name: string;
  age: number;
  prescriptions: Prescription[];
  finishedMedications: FinishedMedicationRecord[];
  emotionalStates: EmotionalState[];
  personalDetails: PersonalDetails;
  mealPlan?: WeeklyMealPlan;

  constructor(residentId: string, name: string, age: number) {
    this.residentId = residentId;
    this.name = name;
    this.age = age;
    this.prescriptions = [];
    this.finishedMedications = [];
    this.emotionalStates = [];
    this.personalDetails = {};
  }

  updatePersonalDetails(details: Partial<PersonalDetails>): void {
    this.personalDetails = { ...this.personalDetails, ...details };
  }

  addPrescription(prescription: Prescription): void {
    this.prescriptions.push(prescription);
  }

  removePrescription(prescriptionId: string): void {
    // Remove prescription (this will also delete all associated medications due to composition)
    this.prescriptions = this.prescriptions.filter(p => p.prescriptionId !== prescriptionId);
  }

  addEmotionalState(state: EmotionalState): void {
    this.emotionalStates.push(state);
  }

  addFinishedMedication(record: FinishedMedicationRecord): void {
    this.finishedMedications.unshift(record);
  }

  getLatestEmotionalState(): EmotionalState | null {
    if (this.emotionalStates.length === 0) return null;
    return this.emotionalStates.reduce((latest, state) => state.timestamp > latest.timestamp ? state : latest);
  }

  getAllMedications() {
    return this.prescriptions.flatMap(p => p.medications);
  }
}