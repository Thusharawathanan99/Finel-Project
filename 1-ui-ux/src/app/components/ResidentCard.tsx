import { Resident } from '../models/Resident';
import { User, Pill, Activity } from 'lucide-react';

interface ResidentCardProps {
  resident: Resident;
  onSelect: () => void;
  isSelected: boolean;
}

export function ResidentCard({ resident, onSelect, isSelected }: ResidentCardProps) {
  const latestEmotion = resident.getLatestEmotionalState();
  const medicationCount = resident.getAllMedications().length;

  return (
    <div
      onClick={onSelect}
      className={`p-5 rounded-2xl border-2 cursor-pointer transition-all shadow-sm hover:shadow-md ${
        isSelected 
          ? 'border-teal-500 bg-teal-50' 
          : 'border-gray-200 bg-white hover:border-gray-300'
      }`}
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-full bg-gradient-to-br from-teal-500 to-emerald-700 flex items-center justify-center">
            <User className="w-6 h-6 text-white" />
          </div>
          <div>
            <h3 className="font-semibold">{resident.name}</h3>
            <p className="text-sm text-gray-500">Age: {resident.age} | ID: {resident.residentId}</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 mt-3">
        <div className="flex items-center gap-2 text-sm">
          <Pill className="w-4 h-4 text-teal-600" />
          <span>{medicationCount} medications</span>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <Activity className="w-4 h-4 text-green-600" />
          <span>
            {latestEmotion 
              ? `${latestEmotion.getEmotionalLevel()} (${latestEmotion.stateScore})`
              : 'No data'
            }
          </span>
        </div>
      </div>

      {latestEmotion && (
        <div className="mt-3">
          <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden">
            <div
              className={`h-full transition-all ${
                latestEmotion.stateScore >= 80 ? 'bg-green-500' :
                latestEmotion.stateScore >= 60 ? 'bg-teal-500' :
                latestEmotion.stateScore >= 40 ? 'bg-yellow-500' :
                latestEmotion.stateScore >= 20 ? 'bg-orange-500' :
                'bg-red-500'
              }`}
              style={{ width: `${latestEmotion.stateScore}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
