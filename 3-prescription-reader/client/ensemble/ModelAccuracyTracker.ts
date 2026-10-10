/**
 * Model Accuracy Tracker
 * 
 * Tracks per-model accuracy metrics for the ensemble system.
 * Persists to localStorage so metrics survive page refreshes.
 * 
 * Used by:
 *  - EnsembleOrchestrator: records predictions
 *  - PrescriptionUpload: called when user confirms/corrects results
 *  - PatientDashboard: displays accuracy comparison charts
 */

import { ModelSource, EnsembleMedication } from './EnsembleOrchestrator';

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export interface ModelMetrics {
  totalPredictions: number;
  correctPredictions: number;
  accuracy: number;             // correctPredictions / totalPredictions
  totalMedicationsFound: number;
  averageConfidence: number;
  lastUpdated: string;
}

export interface AccuracySnapshot {
  donut: ModelMetrics;
  regex: ModelMetrics;
  gemini: ModelMetrics;
  ensemble: ModelMetrics;
  totalPrescriptions: number;
  modelAgreementRate: number;
  lastUpdated: string;
}

interface PredictionRecord {
  id: string;
  timestamp: string;
  medications: {
    drugName: string;
    dosage: string;
    sources: ModelSource[];
    confidence: number;
  }[];
  wasConfirmed: boolean;
  wasCorrected: boolean;
  correctMedications?: string[];  // Ground truth after user correction
}

// ─────────────────────────────────────────────
// Tracker Class
// ─────────────────────────────────────────────

const STORAGE_KEY = 'careconnect_model_accuracy';
const MAX_HISTORY = 200;  // Keep last 200 predictions for rolling accuracy

class ModelAccuracyTracker {
  private predictions: PredictionRecord[] = [];
  private metrics: AccuracySnapshot;

  constructor() {
    this.metrics = this.getDefaultMetrics();
    this.loadFromStorage();
  }

  // ─── Recording ────────────────────────────

  /**
   * Record a new ensemble prediction.
   * Called by EnsembleOrchestrator after merging results.
   */
  recordPrediction(medications: EnsembleMedication[]): string {
    const id = `pred-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;

    const record: PredictionRecord = {
      id,
      timestamp: new Date().toISOString(),
      medications: medications.map(m => ({
        drugName: m.medication.drugName,
        dosage: m.medication.dosage,
        sources: m.sources,
        confidence: m.confidence,
      })),
      wasConfirmed: false,
      wasCorrected: false,
    };

    this.predictions.push(record);

    // Update per-model counts
    for (const med of medications) {
      for (const source of med.sources) {
        this.incrementModelCount(source, 'totalMedicationsFound', 1);
        this.addConfidence(source, med.confidence);
      }
    }

    this.metrics.totalPrescriptions++;
    this.updateEnsembleMetrics(medications);
    this.trimHistory();
    this.saveToStorage();

    return id;
  }

  /**
   * Mark a prediction as confirmed by the user (user accepted the results).
   * This counts as "correct" for all models that found those medications.
   */
  confirmPrediction(predictionId: string): void {
    const record = this.predictions.find(p => p.id === predictionId);
    if (!record || record.wasConfirmed) return;

    record.wasConfirmed = true;

    for (const med of record.medications) {
      for (const source of med.sources) {
        this.incrementModelCount(source, 'totalPredictions', 1);
        this.incrementModelCount(source, 'correctPredictions', 1);
      }
    }

    this.recalculateAccuracies();
    this.saveToStorage();
  }

  /**
   * Record a correction — user changed the results.
   * Models that had the correct answer get credit; others don't.
   */
  recordCorrection(
    predictionId: string,
    correctMedications: { drugName: string; dosage: string }[]
  ): void {
    const record = this.predictions.find(p => p.id === predictionId);
    if (!record) return;

    record.wasCorrected = true;
    record.correctMedications = correctMedications.map(m => m.drugName.toLowerCase());

    const correctNames = new Set(record.correctMedications);

    for (const med of record.medications) {
      const wasCorrect = correctNames.has(med.drugName.toLowerCase());
      for (const source of med.sources) {
        this.incrementModelCount(source, 'totalPredictions', 1);
        if (wasCorrect) {
          this.incrementModelCount(source, 'correctPredictions', 1);
        }
      }
    }

    this.recalculateAccuracies();
    this.saveToStorage();
  }

  // ─── Getters ──────────────────────────────

  /**
   * Get current accuracy snapshot for all models.
   */
  getMetrics(): AccuracySnapshot {
    return { ...this.metrics };
  }

  /**
   * Get metrics for a specific model.
   */
  getModelMetrics(source: ModelSource): ModelMetrics {
    return { ...this.metrics[source] };
  }

  /**
   * Get the last N prediction records for display.
   */
  getRecentPredictions(count: number = 10): PredictionRecord[] {
    return this.predictions.slice(-count).reverse();
  }

  /**
   * Get total prescription count.
   */
  getTotalPrescriptions(): number {
    return this.metrics.totalPrescriptions;
  }

  /**
   * Export metrics as JSON (for research).
   */
  exportMetrics(): string {
    return JSON.stringify({
      exportedAt: new Date().toISOString(),
      metrics: this.metrics,
      recentPredictions: this.predictions.slice(-50),
    }, null, 2);
  }

  /**
   * Reset all metrics.
   */
  reset(): void {
    this.predictions = [];
    this.metrics = this.getDefaultMetrics();
    this.saveToStorage();
  }

  // ─── Internal ─────────────────────────────

  private incrementModelCount(
    source: ModelSource,
    field: 'totalPredictions' | 'correctPredictions' | 'totalMedicationsFound',
    amount: number
  ): void {
    this.metrics[source][field] += amount;
    this.metrics.lastUpdated = new Date().toISOString();
  }

  private addConfidence(source: ModelSource, confidence: number): void {
    const m = this.metrics[source];
    // Running average
    const total = m.totalMedicationsFound || 1;
    m.averageConfidence = (m.averageConfidence * (total - 1) + confidence) / total;
  }

  private updateEnsembleMetrics(medications: EnsembleMedication[]): void {
    this.metrics.ensemble.totalMedicationsFound += medications.length;

    if (medications.length > 0) {
      const avgConf = medications.reduce((s, m) => s + m.confidence, 0) / medications.length;
      const total = this.metrics.ensemble.totalMedicationsFound || 1;
      this.metrics.ensemble.averageConfidence =
        (this.metrics.ensemble.averageConfidence * (total - medications.length) + avgConf * medications.length) / total;
    }

    // Model agreement rate
    const agreementCounts = medications.map(m => m.sources.length);
    if (agreementCounts.length > 0) {
      const avgAgreement = agreementCounts.reduce((s, c) => s + c, 0) / agreementCounts.length;
      const n = this.metrics.totalPrescriptions || 1;
      this.metrics.modelAgreementRate =
        (this.metrics.modelAgreementRate * (n - 1) + avgAgreement / 3) / n;
    }
  }

  private recalculateAccuracies(): void {
    for (const source of ['donut', 'regex', 'gemini', 'ensemble'] as const) {
      const m = this.metrics[source];
      m.accuracy = m.totalPredictions > 0
        ? m.correctPredictions / m.totalPredictions
        : 0;
      m.lastUpdated = new Date().toISOString();
    }
  }

  private trimHistory(): void {
    if (this.predictions.length > MAX_HISTORY) {
      this.predictions = this.predictions.slice(-MAX_HISTORY);
    }
  }

  private getDefaultMetrics(): AccuracySnapshot {
    const defaultModel: ModelMetrics = {
      totalPredictions: 0,
      correctPredictions: 0,
      accuracy: 0,
      totalMedicationsFound: 0,
      averageConfidence: 0,
      lastUpdated: new Date().toISOString(),
    };

    return {
      donut: { ...defaultModel },
      regex: { ...defaultModel },
      gemini: { ...defaultModel },
      ensemble: { ...defaultModel },
      totalPrescriptions: 0,
      modelAgreementRate: 0,
      lastUpdated: new Date().toISOString(),
    };
  }

  // ─── Persistence ──────────────────────────

  private saveToStorage(): void {
    try {
      const data = JSON.stringify({
        metrics: this.metrics,
        predictions: this.predictions.slice(-MAX_HISTORY),
      });
      localStorage.setItem(STORAGE_KEY, data);
    } catch {
      // localStorage may not be available
    }
  }

  private loadFromStorage(): void {
    try {
      const data = localStorage.getItem(STORAGE_KEY);
      if (data) {
        const parsed = JSON.parse(data);
        if (parsed.metrics) {
          this.metrics = { ...this.getDefaultMetrics(), ...parsed.metrics };
        }
        if (parsed.predictions) {
          this.predictions = parsed.predictions;
        }
        console.log(
          `[AccuracyTracker] Loaded ${this.predictions.length} predictions, ` +
          `${this.metrics.totalPrescriptions} total prescriptions`
        );
      }
    } catch {
      // Ignore errors
    }
  }
}

// Singleton instance
export const modelAccuracyTracker = new ModelAccuracyTracker();
