import type { ReconciledMedication } from '../../4-system-engine/api/routes/prescriptionSafety.js';

export class Medication {
  id?: number;
  drugName: string;
  dosage: string;
  frequency: string;
  duration?: string;
  instructions?: string;
  confidence?: number;
  needsReview?: boolean;
  reviewReasons?: string[];
  conflictingFields?: string[];
  sourceDetails?: ReconciledMedication['sourceDetails'];
  verifiedByUser?: boolean;

  constructor(
    drugName: string,
    dosage: string = 'Needs Review',
    frequency: string = 'Needs Review',
    id?: number,
    duration?: string,
    instructions?: string,
    confidence?: number,
    needsReview?: boolean
  ) {
    this.id = id;
    this.drugName = drugName;
    this.dosage = dosage;
    this.frequency = frequency;
    this.duration = duration;
    this.instructions = instructions;
    this.confidence = confidence;
    this.needsReview = needsReview;
  }

  toString(): string {
    const details = [this.dosage, this.frequency, this.duration].filter(Boolean).join(', ');
    return `${this.drugName} - ${details}`;
  }
}
