import { Prescription } from '../models/Prescription';
import { FileText, Trash2, Calendar, UserRound } from 'lucide-react';

interface PrescriptionListProps {
  prescriptions: Prescription[];
  onDelete?: (prescriptionId: string) => void;
}

export function PrescriptionList({ prescriptions, onDelete }: PrescriptionListProps) {
  if (prescriptions.length === 0) {
    return (
      <div className="text-center py-8 text-gray-500">
        <FileText className="w-12 h-12 mx-auto mb-2 opacity-50" />
        <p>No prescriptions on file</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {prescriptions.map(prescription => (
        <div key={prescription.prescriptionId} className="border rounded-lg p-4 bg-white">
          <div className="flex items-start justify-between mb-3">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <FileText className="w-4 h-4 text-teal-600" />
                <span className="font-medium">Prescription {prescription.prescriptionId}</span>
              </div>
              <div className="flex items-center gap-4 text-sm text-gray-600">
                <div className="flex items-center gap-1">
                  <UserRound className="w-3 h-3" />
                  <span>Dr. {prescription.doctorName}</span>
                </div>
                <div className="flex items-center gap-1">
                  <Calendar className="w-3 h-3" />
                  <span>{prescription.dateIssued.toLocaleDateString()}</span>
                </div>
              </div>
            </div>
            {onDelete && (
              <button
                onClick={() => onDelete(prescription.prescriptionId)}
                className="p-2 hover:bg-red-50 rounded transition-colors"
              >
                <Trash2 className="w-4 h-4 text-red-600" />
              </button>
            )}
          </div>

          <div className="mt-3 space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">Prescribed Medications ({prescription.medications.length})</p>
            {prescription.medications.map((med, idx) => {
              const isNeedsReview = med.needsReview || med.dosage === 'Needs Review' || med.frequency === 'Needs Review';
              return (
                <div key={idx} className={`p-3 rounded-lg border ${
                  isNeedsReview ? 'border-amber-200 bg-amber-50/50' : 'border-teal-100 bg-teal-50/40'
                }`}>
                  <div className="flex items-center justify-between mb-1">
                    <p className="font-bold text-sm text-gray-900">{med.drugName}</p>
                    {isNeedsReview && (
                      <span className="text-[10px] font-bold bg-amber-200 text-amber-900 px-2 py-0.5 rounded-full">
                        ⚠️ Needs Review
                      </span>
                    )}
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs text-gray-600 mt-1">
                    <div>
                      <span className="text-gray-400 block text-[10px]">Dosage</span>
                      <span className={med.dosage === 'Needs Review' ? 'text-amber-800 font-bold' : 'font-medium'}>{med.dosage}</span>
                    </div>
                    <div>
                      <span className="text-gray-400 block text-[10px]">Frequency</span>
                      <span className={med.frequency === 'Needs Review' ? 'text-amber-800 font-bold' : 'font-medium'}>{med.frequency}</span>
                    </div>
                    {med.duration && (
                      <div>
                        <span className="text-gray-400 block text-[10px]">Duration</span>
                        <span>{med.duration}</span>
                      </div>
                    )}
                    {med.instructions && (
                      <div>
                        <span className="text-gray-400 block text-[10px]">Instructions</span>
                        <span>{med.instructions}</span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
