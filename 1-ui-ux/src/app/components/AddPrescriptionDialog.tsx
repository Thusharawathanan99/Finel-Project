import { useState } from 'react';
import { X, Upload, Sparkles } from 'lucide-react';

interface AddPrescriptionDialogProps {
  residentName: string;
  onProcess: (doctorName: string) => void;
  onClose: () => void;
}

export function AddPrescriptionDialog({ residentName, onProcess, onClose }: AddPrescriptionDialogProps) {
  const [doctorName, setDoctorName] = useState('');
  const [processing, setProcessing] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!doctorName.trim()) return;

    setProcessing(true);
    
    // Simulate OCR and NLP processing delay
    setTimeout(() => {
      onProcess(doctorName);
      setProcessing(false);
      onClose();
    }, 1500);
  };

  return (
    <div className="care-modal-overlay fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
        <div className="flex items-center justify-between p-4 border-b">
          <h3 className="font-semibold">Add Prescription - {residentName}</h3>
          <button
            onClick={onClose}
            className="p-1 hover:bg-gray-100 rounded transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2">Doctor Name</label>
            <input
              type="text"
              value={doctorName}
              onChange={(e) => setDoctorName(e.target.value)}
              placeholder="Enter prescribing doctor's name"
              className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
              required
            />
          </div>

          <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center">
            <Upload className="w-12 h-12 mx-auto mb-3 text-gray-400" />
            <p className="text-sm text-gray-600 mb-1">Upload Prescription Image</p>
            <p className="text-xs text-gray-500">
              (Simulated OCR & NLP processing)
            </p>
          </div>

          <div className="bg-teal-50 border border-teal-200 rounded-lg p-3">
            <div className="flex items-start gap-2">
              <Sparkles className="w-4 h-4 text-teal-600 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-teal-900">
                The system will use OCR to extract text from the prescription image, 
                then NLP to parse medication details automatically.
              </p>
            </div>
          </div>

          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 border rounded-lg hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={processing}
              className="flex-1 px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {processing ? 'Processing...' : 'Process Prescription'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
