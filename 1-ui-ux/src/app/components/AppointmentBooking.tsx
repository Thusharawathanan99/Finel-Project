import { useState } from 'react';
import { X, Calendar, Clock, Stethoscope, User } from 'lucide-react';

interface AppointmentBookingProps {
  residentName: string;
  residentId: string;
  onBook: (doctorName: string, specialization: string, date: Date, time: string, reason: string) => void | Promise<void>;
  onClose: () => void;
}

export function AppointmentBooking({ residentName, residentId, onBook, onClose }: AppointmentBookingProps) {
  const [formData, setFormData] = useState({
    doctorName: '',
    specialization: '',
    date: '',
    time: '',
    reason: ''
  });

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const specializations = [
    'General Physician',
    'Cardiologist',
    'Neurologist',
    'Orthopedic',
    'Dermatologist',
    'Psychiatrist',
    'Ophthalmologist',
    'ENT Specialist'
  ];

  const timeSlots = [
    '09:00 AM', '09:30 AM', '10:00 AM', '10:30 AM', '11:00 AM', '11:30 AM',
    '02:00 PM', '02:30 PM', '03:00 PM', '03:30 PM', '04:00 PM', '04:30 PM'
  ];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError('');
    try {
      await onBook(formData.doctorName, formData.specialization, new Date(`${formData.date}T00:00:00`), formData.time, formData.reason);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Appointment could not be booked. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="care-modal-overlay fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-gradient-to-r from-teal-600 to-emerald-600 text-white px-6 py-4 flex items-center justify-between rounded-t-2xl">
          <div>
            <h3 className="text-xl font-semibold">Book Doctor Appointment</h3>
            <p className="text-sm text-teal-100">For {residentName}</p>
          </div>
          <button
            onClick={onClose}
            disabled={submitting}
            className="p-2 hover:bg-white/20 rounded-full transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
          <fieldset disabled={submitting} className="space-y-5">
          {/* Doctor Name */}
          <div>
            <label className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-2">
              <User className="w-4 h-4" />
              Doctor's Name
            </label>
            <input
              type="text"
              value={formData.doctorName}
              onChange={(e) => setFormData({ ...formData, doctorName: e.target.value })}
              placeholder="Dr. Sarah Johnson"
              className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
              required
            />
          </div>

          {/* Specialization */}
          <div>
            <label className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-2">
              <Stethoscope className="w-4 h-4" />
              Specialization
            </label>
            <select
              value={formData.specialization}
              onChange={(e) => setFormData({ ...formData, specialization: e.target.value })}
              className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
              required
            >
              <option value="">Select specialization...</option>
              {specializations.map(spec => (
                <option key={spec} value={spec}>{spec}</option>
              ))}
            </select>
          </div>

          {/* Date and Time */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-2">
                <Calendar className="w-4 h-4" />
                Appointment Date
              </label>
              <input
                type="date"
                value={formData.date}
                onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                min={new Date().toISOString().split('T')[0]}
                className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                required
              />
            </div>

            <div>
              <label className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-2">
                <Clock className="w-4 h-4" />
                Time Slot
              </label>
              <select
                value={formData.time}
                onChange={(e) => setFormData({ ...formData, time: e.target.value })}
                className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                required
              >
                <option value="">Select time...</option>
                {timeSlots.map(time => (
                  <option key={time} value={time}>{time}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Reason */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Reason for Visit
            </label>
            <textarea
              value={formData.reason}
              onChange={(e) => setFormData({ ...formData, reason: e.target.value })}
              placeholder="Describe the health concern or reason for this appointment..."
              rows={4}
              className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent resize-none"
              required
            />
          </div>

          {/* Info Box */}
          <div className="bg-teal-50 border border-teal-200 rounded-xl p-4">
            <p className="text-sm text-teal-900">
              📅 <strong>Note:</strong> You will receive a confirmation once the appointment is scheduled. 
              Please arrive 15 minutes early for registration.
            </p>
          </div>

          {/* Action Buttons */}
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-6 py-3 border-2 border-gray-300 text-gray-700 rounded-xl font-medium hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex-1 px-6 py-3 bg-gradient-to-r from-teal-700 to-emerald-700 text-white rounded-xl font-medium hover:from-teal-700 hover:to-purple-700 transition-all"
            >
              {submitting ? 'Booking...' : 'Book Appointment'}
            </button>
          </div>
          </fieldset>
        </form>
      </div>
    </div>
  );
}
