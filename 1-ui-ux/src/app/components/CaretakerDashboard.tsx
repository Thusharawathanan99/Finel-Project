import { useState, useEffect, useRef, lazy } from 'react';
import { Dashboard } from '../models/Dashboard';
import { User } from '../models/User';
import { Resident } from '../models/Resident';
import { LeaveRequest } from '../models/Caretaker';
import { EmergencyAlert } from '../models/EmergencyAlert';
import { Medication } from '../models/Medication';
import { 
  Users, 
  Bell, 
  Activity,
  AlertTriangle,
  Upload,
  Calendar,
  FileText,
  Send,
  Home,
  Utensils
} from 'lucide-react';
const PrescriptionUpload = lazy(() => import('./PrescriptionUpload').then(module => ({ default: module.PrescriptionUpload })));
import { AppointmentBooking } from './AppointmentBooking';
import { Appointment } from '../models/Appointment';
const MealPlanView = lazy(() => import('./MealPlanView').then(module => ({ default: module.MealPlanView })));
import { PersistedCareAlerts } from './PersistedCareAlerts';
import { MonitoringDevices } from './monitoring/MonitoringDevices';
import { MonitoringIncidents } from './monitoring/MonitoringIncidents';
import { MonitoringConsentPanel } from './monitoring/MonitoringConsentPanel';
import { MedicationReminderPanel } from './MedicationReminderPanel';
import { CareRecordPanel } from './monitoring/CareRecordPanel';
import { clearMealPlanCache } from '../ml/meal-plan/MealPlanEngine';
import { caretakersApi, appointmentsApi, sosApi } from '../services/apiService';

interface CaretakerDashboardProps {
  user: User;
  dashboard: Dashboard;
  onLogout: () => void;
  onRefresh: () => void;
}

export function CaretakerDashboard({ user, dashboard, onLogout, onRefresh }: CaretakerDashboardProps) {
  const [activeView, setActiveView] = useState<'home' | 'residents' | 'leave' | 'alerts'>('home');
  const [selectedResidentState, setSelectedResident] = useState<Resident | null>(null);
  const [showPrescriptionUpload, setShowPrescriptionUpload] = useState(false);
  const [showAppointmentBooking, setShowAppointmentBooking] = useState(false);
  const [showLeaveRequest, setShowLeaveRequest] = useState(false);
  const [showEmergencyConfirm, setShowEmergencyConfirm] = useState(false);
  const [emergencyResidentId, setEmergencyResidentId] = useState('');
  const [emergencySending, setEmergencySending] = useState(false);
  const [emergencyError, setEmergencyError] = useState('');
  const [emergencySuccess, setEmergencySuccess] = useState('');
  const [finishingMedicationKey, setFinishingMedicationKey] = useState<string | null>(null);
  const [medicationsTab, setMedicationsTab] = useState<'current' | 'finished' | 'mealplan'>('current');

  const currentCaretaker = dashboard.caretakers.find(c => c.caretakerId === user.userId || c.email === user.email);
  const caretakerResidents = currentCaretaker && currentCaretaker.assignedResidents?.length > 0
    ? dashboard.residents.filter(r => currentCaretaker.assignedResidents.includes(r.residentId))
    : [];
  const selectedResident = caretakerResidents.find(resident=>resident.residentId===selectedResidentState?.residentId) || null;
  useEffect(()=>{if(selectedResidentState && !selectedResident){setSelectedResident(null);setShowPrescriptionUpload(false);setShowAppointmentBooking(false);}},[selectedResidentState?.residentId,caretakerResidents.map(resident=>resident.residentId).join(',')]);
  const measuredScores=caretakerResidents.map(resident=>resident.getLatestEmotionalState()?.stateScore).filter((score):score is number=>typeof score==='number'&&Number.isFinite(score));

  const criticalAlerts = dashboard.getCriticalAlerts();
  const activeAlerts = dashboard.getActiveAlerts();
  const emergencyAlerts = dashboard.getActiveEmergencyAlerts();

  const [leaveForm, setLeaveForm] = useState({
    startDate: '',
    endDate: '',
    reason: ''
  });
  const [leaveError, setLeaveError] = useState('');
  const [leaveSubmitting, setLeaveSubmitting] = useState(false);
  const leaveLock = useRef(false);
  const localToday = () => { const today = new Date(); return [today.getFullYear(), String(today.getMonth()+1).padStart(2,'0'), String(today.getDate()).padStart(2,'0')].join('-'); };

  const selectedResidentFinishedMeds = selectedResident
    ? selectedResident.finishedMedications
    : [];

  const openEmergencyAlert = () => {
    setEmergencyResidentId(selectedResident?.residentId || caretakerResidents[0]?.residentId || '');
    setEmergencyError('');
    setEmergencySuccess('');
    setShowEmergencyConfirm(true);
  };

  const handleEmergencyAlert = async () => {
    if (emergencySending) return;
    const resident = caretakerResidents.find(r => r.residentId === emergencyResidentId);
    if (!resident) { setEmergencyError('Select an assigned resident for this emergency.'); return; }
    setEmergencySending(true);
    setEmergencyError('');
    try {
      await sosApi.create({ residentId: resident.residentId, residentName: resident.name, message: `EMERGENCY: Immediate assistance required! Sent by ${currentCaretaker?.name || user.name}.` });
      setEmergencySuccess('Emergency alert sent to the administrator.');
      setShowEmergencyConfirm(false);
    } catch (error) {
      setEmergencyError(error instanceof Error ? error.message : 'Emergency alert could not be sent. Please try again.');
    } finally {
      setEmergencySending(false);
    }
  };

  const handleLeaveSubmit = async () => {
    if (!currentCaretaker || leaveLock.current) return;
    if (!leaveForm.startDate || !leaveForm.endDate || leaveForm.endDate < leaveForm.startDate || !leaveForm.reason.trim()) { setLeaveError('Choose valid dates, with the end on or after the start, and enter a reason.'); return; }
    leaveLock.current = true;
    setLeaveSubmitting(true);
    setLeaveError('');
    
    const requestData = {
      startDate: leaveForm.startDate,
      endDate: leaveForm.endDate,
      reason: leaveForm.reason,
      caretakerName: currentCaretaker.name
    };

    try {
      const response = await caretakersApi.createLeaveRequest(currentCaretaker.caretakerId, requestData);
      
      const request = new LeaveRequest(
        response.requestId || `LV-${Date.now()}`,
        currentCaretaker.caretakerId,
        currentCaretaker.name,
        new Date(`${leaveForm.startDate}T00:00:00`),
        new Date(`${leaveForm.endDate}T00:00:00`),
        leaveForm.reason
      );
      currentCaretaker.addLeaveRequest(request);
      setShowLeaveRequest(false);
      setLeaveForm({ startDate: '', endDate: '', reason: '' });
      onRefresh();
    } catch (error) {
      setLeaveError(error instanceof Error ? error.message : 'Leave request could not be saved. Please retry.');
    } finally {
      leaveLock.current = false;
      setLeaveSubmitting(false);
    }
  };

  const handlePrescriptionUpload = async (
    doctorName: string,
    imageFile: File | null,
    medications?: Medication[],
    patientName?: string,
    dateIssued?: string,
    rawText?: string
  ) => {
    if (!selectedResident) return;

    if (medications && medications.length > 0) {
      const saved = await dashboard.saveProcessedPrescription(
        selectedResident.residentId,
        doctorName,
        medications,
        imageFile,
        patientName,
        dateIssued,
        rawText
      );
      if (!saved) {
        throw new Error('Database save failed. Ensure API server/MySQL are running, then retry.');
      }
    } else {
      throw new Error('Review and confirm the prescription medicines before saving.');
    }

    setShowPrescriptionUpload(false);
    clearMealPlanCache(selectedResident.residentId);
    onRefresh();
  };

  const handleBookAppointment = async (doctorName: string, specialization: string, date: Date, time: string, reason: string) => {
    if (!selectedResident) throw new Error('Select a resident before booking.');
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const appointmentDate = `${year}-${month}-${day}`;
    const response = await appointmentsApi.create({ residentId: selectedResident.residentId, residentName: selectedResident.name, doctorName, specialization, appointmentDate, appointmentTime: time, reason });
    dashboard.addAppointment(new Appointment(response.appointmentId, selectedResident.residentId, selectedResident.name, doctorName, specialization, date, time, reason));
    setShowAppointmentBooking(false);
    onRefresh();
  };

  const handleFinishMedication = async (prescriptionId: string, med: Medication) => {
    if (!selectedResident) return;

    const residentId = selectedResident.residentId;
    const medKey = `${prescriptionId}:${med.id ?? `${med.drugName}:${med.dosage}:${med.frequency}`}`;
    setFinishingMedicationKey(medKey);

    try {
      const finishedRecord = await dashboard.finishMedication(residentId, prescriptionId, med);
      if (!finishedRecord) {
        throw new Error('Could not mark medication as finished. Please retry.');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to finish medication.';
      window.alert(message);
    } finally {
      setFinishingMedicationKey(null);
    }
  };

  return (
    <div className="care-dashboard min-h-screen pb-28">
      {emergencySuccess && <div role="status" className="mx-4 mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{emergencySuccess}</div>}
      {/* Header - Mobile Optimized */}
      <div className="care-dashboard-header bg-white shadow-sm border-b border-gray-200 sticky top-0 z-10">
        <div className="px-4 py-3">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-green-400 to-teal-400 flex items-center justify-center text-white">
                <Users className="w-5 h-5" />
              </div>
              <div>
                <p className="text-xs text-gray-600">Caretaker</p>
                <p className="font-semibold text-gray-800 text-sm">{user.name.split(' ')[0]}</p>
              </div>
            </div>
            <button 
              onClick={onLogout}
              className="text-xs text-gray-600 hover:text-gray-800 px-3 py-1.5 rounded-lg hover:bg-gray-50"
            >
              Logout
            </button>
          </div>
          
          {/* Emergency Alerts Banner */}
          {(criticalAlerts.length > 0 || emergencyAlerts.length > 0) && (
            <div className="bg-red-50 border border-red-300 rounded-lg p-2 flex items-center gap-2">
              <Bell className="w-4 h-4 text-red-600 animate-pulse flex-shrink-0" />
              <span className="text-xs font-medium text-red-900 flex-1">
                {emergencyAlerts.length > 0 
                  ? `${emergencyAlerts.length} Emergency Alert${emergencyAlerts.length > 1 ? 's' : ''}!`
                  : `${criticalAlerts.length} Critical Alert${criticalAlerts.length > 1 ? 's' : ''}`
                }
              </span>
              <button 
                onClick={() => setActiveView('alerts')}
                className="text-xs font-medium text-red-700 px-2 py-1 bg-red-100 rounded"
              >
                View
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="care-dashboard-content px-4 py-6 max-w-6xl mx-auto">
        <section className="care-workspace-intro">
          <div><span>CARECONNECT / YOUR WORKSPACE</span><h1>Connected care starts here.</h1><p>A thoughtful workspace for the people who count on you.</p></div>
          <div className="care-workspace-emblem" aria-hidden="true"><img src="/careconnect-companion.png" alt="" /></div>
        </section>
        <PersistedCareAlerts caretakerId={user.userId} />
        <MonitoringIncidents residents={caretakerResidents} />
        {activeView === 'home' && (
          <div className="space-y-4">
            {/* Stats Grid */}
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-200">
                <Users className="w-8 h-8 text-teal-500 mb-2" />
                <p className="text-2xl font-bold text-gray-800">{caretakerResidents.length}</p>
                <p className="text-xs text-gray-600">Residents</p>
              </div>

              <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-200">
                <AlertTriangle className="w-8 h-8 text-orange-500 mb-2" />
                <p className="text-2xl font-bold text-gray-800">{activeAlerts.length}</p>
                <p className="text-xs text-gray-600">Active Alerts</p>
              </div>

              <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-200">
                <Activity className="w-8 h-8 text-green-500 mb-2" />
                <p className="text-2xl font-bold text-gray-800">
                  {measuredScores.length ? Math.round(measuredScores.reduce((sum,score)=>sum+score,0)/measuredScores.length) : '--'}
                </p>
                <p className="text-xs text-gray-600">Avg Wellness</p>
              </div>

              <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-200">
                <Calendar className="w-8 h-8 text-purple-500 mb-2" />
                <p className="text-2xl font-bold text-gray-800">
                  {dashboard.getUpcomingAppointments().length}
                </p>
                <p className="text-xs text-gray-600">Appointments</p>
              </div>
            </div>

            {/* Quick Actions */}
            <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-200">
              <h3 className="font-semibold text-gray-800 mb-3 text-base">Quick Actions</h3>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <button
                  onClick={() => setActiveView('residents')}
                  className="py-3 bg-teal-50 text-teal-700 rounded-lg font-medium text-sm active:scale-95 transition-transform"
                >
                  View Residents
                </button>
                <button
                  onClick={() => setShowLeaveRequest(true)}
                  className="py-3 bg-green-50 text-green-700 rounded-lg font-medium text-sm active:scale-95 transition-transform"
                >
                  Request Leave
                </button>
                <button
                  onClick={() => setActiveView('alerts')}
                  className="py-3 bg-orange-50 text-orange-700 rounded-lg font-medium text-sm active:scale-95 transition-transform"
                >
                  Check Alerts
                </button>
                <button
                  onClick={openEmergencyAlert}
                  className="py-3 bg-red-50 text-red-700 rounded-lg font-medium text-sm active:scale-95 transition-transform flex items-center justify-center gap-1"
                >
                  <AlertTriangle className="w-4 h-4" />
                  Emergency
                </button>
              </div>
            </div>

            {/* Recent Residents */}
            <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-200">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-gray-800 text-base">Recent Residents</h3>
                <button 
                  onClick={() => setActiveView('residents')}
                  className="text-xs text-teal-600"
                >
                  View All
                </button>
              </div>
              <div className="space-y-2">
                {caretakerResidents.slice(0, 3).map(resident => {
                  const latestEmotion = resident.getLatestEmotionalState();
                  return (
                    <button
                      key={resident.residentId}
                      onClick={() => {
                        setSelectedResident(resident);
                        setActiveView('residents');
                      }}
                      className="w-full p-3 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors text-left"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-teal-500 to-emerald-600 flex items-center justify-center text-white text-sm font-semibold">
                            {resident.name.charAt(0)}
                          </div>
                          <div>
                            <p className="font-medium text-gray-800 text-sm">{resident.name}</p>
                            <p className="text-xs text-gray-500">Room {resident.personalDetails.roomNumber}</p>
                          </div>
                        </div>
                        {latestEmotion && (
                          <span className={`text-sm font-semibold px-2 py-1 rounded ${
                            latestEmotion.stateScore >= 70 ? 'bg-green-100 text-green-700' :
                            latestEmotion.stateScore >= 50 ? 'bg-yellow-100 text-yellow-700' :
                            'bg-orange-100 text-orange-700'
                          }`}>
                            {latestEmotion.stateScore}
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {activeView === 'residents' && (
          <div className="space-y-4">
            <h2 className="text-xl font-bold text-gray-800">All Residents</h2>
            {selectedResident && <MonitoringConsentPanel key={selectedResident.residentId} residentId={selectedResident.residentId} staff />}
            {selectedResident && <CareRecordPanel key={selectedResident.residentId} residentId={selectedResident.residentId} staff />}
            {selectedResident && <MedicationReminderPanel key={selectedResident.residentId} resident={selectedResident} />}

            {selectedResident ? (
              /* Resident Detail View */
              <div className="space-y-3">
                <button
                  onClick={() => {
                    setSelectedResident(null);
                    setMedicationsTab('current');
                  }}
                  className="text-sm text-teal-600 mb-2"
                >
                  ← Back to list
                </button>

                {/* Resident Header */}
                <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-200">
                  <div className="flex items-start gap-3 mb-4">
                    <div className="w-12 h-12 rounded-full bg-gradient-to-br from-teal-500 to-emerald-600 flex items-center justify-center text-white text-xl font-semibold">
                      {selectedResident.name.charAt(0)}
                    </div>
                    <div className="flex-1">
                      <h3 className="text-lg font-bold text-gray-800">{selectedResident.name}</h3>
                      <p className="text-sm text-gray-600">Age: {selectedResident.age} • Room {selectedResident.personalDetails.roomNumber}</p>
                    </div>
                  </div>

                  {/* Quick Stats */}
                  <div className="grid grid-cols-3 gap-2">
                    <div className="bg-teal-50 rounded-lg p-2 border border-teal-200 text-center">
                      <p className="text-xs text-teal-700 mb-1">Medications</p>
                      <p className="text-lg font-bold text-teal-900">
                        {selectedResident.getAllMedications().length}
                      </p>
                    </div>
                    <div className="bg-purple-50 rounded-lg p-2 border border-purple-200 text-center">
                      <p className="text-xs text-purple-700 mb-1">Prescriptions</p>
                      <p className="text-lg font-bold text-purple-900">
                        {selectedResident.prescriptions.length}
                      </p>
                    </div>
                    <div className="bg-green-50 rounded-lg p-2 border border-green-200 text-center">
                      <p className="text-xs text-green-700 mb-1">Wellness</p>
                      <p className="text-lg font-bold text-green-900">
                        {selectedResident.getLatestEmotionalState()?.stateScore ?? '--'}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Actions */}
                <div className="grid grid-cols-3 gap-2">
                  <button
                    onClick={() => setShowPrescriptionUpload(true)}
                    className="py-3 bg-teal-500 text-white rounded-lg font-medium text-sm active:scale-95 transition-transform flex items-center justify-center gap-2"
                  >
                    <Upload className="w-4 h-4" />
                    Rx
                  </button>
                  <button
                    onClick={() => setShowAppointmentBooking(true)}
                    className="py-3 bg-green-500 text-white rounded-lg font-medium text-sm active:scale-95 transition-transform flex items-center justify-center gap-2"
                  >
                    <Calendar className="w-4 h-4" />
                    Appt
                  </button>
                  <button
                    onClick={() => setMedicationsTab('mealplan')}
                    className="py-3 bg-orange-500 text-white rounded-lg font-medium text-sm active:scale-95 transition-transform flex items-center justify-center gap-2"
                  >
                    <Utensils className="w-4 h-4" />
                    Meals
                  </button>
                </div>

                {/* Medications */}
                <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-200">
                  <h4 className="font-semibold text-gray-800 mb-3 text-base">Medications</h4>

                  <div className="grid grid-cols-3 gap-2 mb-3">
                    <button
                      type="button"
                      onClick={() => setMedicationsTab('current')}
                      className={`py-2 px-1 rounded-lg text-xs font-medium border transition-colors ${
                        medicationsTab === 'current'
                          ? 'bg-teal-50 border-teal-300 text-teal-700'
                          : 'bg-white border-gray-200 text-gray-600'
                      }`}
                    >
                      Meds ({selectedResident.getAllMedications().length})
                    </button>
                    <button
                      type="button"
                      onClick={() => setMedicationsTab('finished')}
                      className={`py-2 px-1 rounded-lg text-xs font-medium border transition-colors ${
                        medicationsTab === 'finished'
                          ? 'bg-green-50 border-green-300 text-green-700'
                          : 'bg-white border-gray-200 text-gray-600'
                      }`}
                    >
                      History ({selectedResidentFinishedMeds.length})
                    </button>
                    <button
                      type="button"
                      onClick={() => setMedicationsTab('mealplan')}
                      className={`py-2 px-1 rounded-lg text-xs font-medium border transition-colors ${
                        medicationsTab === 'mealplan'
                          ? 'bg-orange-50 border-orange-300 text-orange-700'
                          : 'bg-white border-gray-200 text-gray-600'
                      }`}
                    >
                      Diet Plan
                    </button>
                  </div>

                  {medicationsTab === 'mealplan' ? (
                    <MealPlanView resident={selectedResident} onGenerate={() => dashboard.generateMealPlan(selectedResident.residentId)} />
                  ) : medicationsTab === 'current' ? (
                    <div className="space-y-2">
                      {selectedResident.getAllMedications().length === 0 && (
                        <div className="bg-gray-50 rounded-lg p-3 border border-gray-200 text-sm text-gray-600">
                          No current medications.
                        </div>
                      )}
                      {selectedResident.prescriptions.map(prescription => (
                        <div key={prescription.prescriptionId}>
                          {prescription.medications.map((med, idx) => {
                            const medKey = `${prescription.prescriptionId}:${med.id ?? `${med.drugName}:${med.dosage}:${med.frequency}`}`;
                            const isFinishing = finishingMedicationKey === medKey;

                            return (
                            <div key={med.id ?? `${prescription.prescriptionId}-${idx}-${med.drugName}`} className="bg-purple-50 rounded-lg p-3 mb-2 border border-purple-100">
                              <div className="flex items-start justify-between gap-2">
                                <div>
                                  <p className="font-medium text-gray-800 text-sm">{med.drugName}</p>
                                  <p className="text-xs text-gray-600">{med.dosage} • {med.frequency}</p>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => handleFinishMedication(prescription.prescriptionId, med)}
                                  disabled={isFinishing}
                                  className="px-3 py-1.5 text-xs font-medium rounded-md border border-green-300 text-green-700 bg-green-50 hover:bg-green-100 disabled:opacity-60 disabled:cursor-not-allowed"
                                >
                                  {isFinishing ? 'Finishing...' : 'Finish Medication'}
                                </button>
                              </div>
                            </div>
                          )})}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {selectedResidentFinishedMeds.length === 0 ? (
                        <div className="bg-gray-50 rounded-lg p-3 border border-gray-200 text-sm text-gray-600">
                          No finished medications yet.
                        </div>
                      ) : (
                        selectedResidentFinishedMeds.map((med, idx) => (
                          <div key={`${med.prescriptionId}-${med.drugName}-${idx}`} className="bg-green-50 rounded-lg p-3 border border-green-100">
                            <p className="font-medium text-gray-800 text-sm">{med.drugName}</p>
                            <p className="text-xs text-gray-600">{med.dosage} • {med.frequency}</p>
                            <p className="text-xs text-green-700 mt-1">
                              Finished: {med.finishedAt.toLocaleDateString()} {med.finishedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </p>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>

                {/* Emotional State */}
                <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-200">
                  <h4 className="font-semibold text-gray-800 mb-3 text-base">Emotional Wellness</h4>
                  <div className="flex gap-2 overflow-x-auto pb-2">
                    {selectedResident.emotionalStates.slice(-5).reverse().map((state, idx) => (
                      <div key={idx} className="flex-shrink-0 text-center">
                        <div className={`w-16 h-16 rounded-lg flex items-center justify-center mb-1 ${
                          state.stateScore >= 70 ? 'bg-green-100' :
                          state.stateScore >= 50 ? 'bg-yellow-100' :
                          'bg-orange-100'
                        }`}>
                          <p className={`text-lg font-bold ${
                            state.stateScore >= 70 ? 'text-green-700' :
                            state.stateScore >= 50 ? 'text-yellow-700' :
                            'text-orange-700'
                          }`}>
                            {state.stateScore}
                          </p>
                        </div>
                        <p className="text-xs text-gray-500">
                          {state.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              /* Resident List View */
              <div className="space-y-2">
                {caretakerResidents.map(resident => {
                  const latestEmotion = resident.getLatestEmotionalState();
                  return (
                    <button
                      key={resident.residentId}
                      onClick={() => {
                        setSelectedResident(resident);
                        setMedicationsTab('current');
                      }}
                      className="w-full bg-white rounded-xl p-4 shadow-sm border border-gray-200 text-left active:scale-98 transition-transform"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-teal-500 to-emerald-600 flex items-center justify-center text-white font-semibold">
                            {resident.name.charAt(0)}
                          </div>
                          <div>
                            <p className="font-semibold text-gray-800 text-sm">{resident.name}</p>
                            <p className="text-xs text-gray-500">Age {resident.age} • Room {resident.personalDetails.roomNumber}</p>
                          </div>
                        </div>
                        {latestEmotion && (
                          <span className={`text-sm font-bold px-2 py-1 rounded ${
                            latestEmotion.stateScore >= 70 ? 'bg-green-100 text-green-700' :
                            latestEmotion.stateScore >= 50 ? 'bg-yellow-100 text-yellow-700' :
                            'bg-orange-100 text-orange-700'
                          }`}>
                            {latestEmotion.stateScore}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center justify-between text-xs text-gray-600">
                        <span>{resident.getAllMedications().length} medications</span>
                        <span>{resident.prescriptions.length} prescriptions</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {activeView === 'leave' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-bold text-gray-800">Leave Requests</h2>
              <button
                onClick={() => setShowLeaveRequest(true)}
                className="px-3 py-1.5 bg-green-500 text-white rounded-lg text-xs font-medium active:scale-95 transition-transform"
              >
                Request New
              </button>
            </div>

            {currentCaretaker?.leaveRequests.length ? (
              <div className="space-y-2">
                {[...currentCaretaker.leaveRequests].reverse().map(request => (
                  <div key={request.requestId} className="bg-white rounded-xl p-4 shadow-sm border border-gray-200">
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                            request.status === 'approved' ? 'bg-green-100 text-green-800' :
                            request.status === 'rejected' ? 'bg-red-100 text-red-800' :
                            'bg-yellow-100 text-yellow-800'
                          }`}>
                            {request.status.toUpperCase()}
                          </span>
                          <span className="text-xs text-gray-500">
                            {request.numberOfDays} day{request.numberOfDays > 1 ? 's' : ''}
                          </span>
                        </div>
                        <p className="text-sm font-medium text-gray-800">
                          {request.startDate.toLocaleDateString()} - {request.endDate.toLocaleDateString()}
                        </p>
                        <p className="text-xs text-gray-600 mt-1">Reason: {request.reason}</p>
                        {request.temporaryReplacement && (
                          <p className="text-xs text-green-600 mt-1">
                            Replacement: {request.temporaryReplacement}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="bg-white rounded-xl p-8 text-center">
                <FileText className="w-16 h-16 mx-auto mb-3 text-gray-300" />
                <p className="text-gray-600 mb-4">No leave requests yet</p>
                <button
                  onClick={() => setShowLeaveRequest(true)}
                  className="px-6 py-3 bg-green-500 text-white rounded-xl font-medium active:scale-95 transition-transform"
                >
                  Request Leave
                </button>
              </div>
            )}
          </div>
        )}

        {activeView === 'alerts' && (
          <div className="space-y-4">
            <h2 className="text-xl font-bold text-gray-800">Alerts</h2>
            <MonitoringDevices residents={caretakerResidents} readOnly />

            {/* Emergency Alerts */}
            {emergencyAlerts.length > 0 && (
              <div className="space-y-2">
                <h3 className="font-semibold text-red-900 text-sm">EMERGENCY ALERTS</h3>
                {emergencyAlerts.map(alert => (
                  <div key={alert.alertId} className="bg-red-50 border-2 border-red-500 rounded-xl p-4">
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                      <div className="flex-1">
                        <p className="font-semibold text-red-900 text-sm mb-1">{alert.message}</p>
                        <p className="text-xs text-red-700">From: {alert.caretakerName}</p>
                        <p className="text-xs text-red-700">Time: {alert.timestamp.toLocaleString()}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Regular Alerts */}
            <div className="space-y-2">
              {dashboard.alerts.slice(0, 10).map(alert => (
                <div
                  key={alert.alertId}
                  className={`bg-white rounded-xl p-3 shadow-sm border-l-4 ${
                    alert.severityLevel === 'critical' ? 'border-red-500' :
                    alert.severityLevel === 'high' ? 'border-orange-500' :
                    alert.severityLevel === 'medium' ? 'border-yellow-500' :
                    'border-teal-500'
                  } ${alert.acknowledged ? 'opacity-50' : ''}`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded ${
                        alert.severityLevel === 'critical' ? 'bg-red-100 text-red-800' :
                        alert.severityLevel === 'high' ? 'bg-orange-100 text-orange-800' :
                        alert.severityLevel === 'medium' ? 'bg-yellow-100 text-yellow-800' :
                        'bg-teal-100 text-teal-800'
                      }`}>
                        {alert.severityLevel.toUpperCase()}
                      </span>
                      <p className="text-sm text-gray-800 mt-2">{alert.message}</p>
                      <p className="text-xs text-gray-500 mt-1">
                        {alert.timestamp.toLocaleString()}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Bottom Navigation */}
      <div className="care-bottom-nav fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 shadow-lg">
        <div className="care-nav-brand"><Users aria-hidden="true" /><div>CareConnect.<small>Care team</small></div></div>
        <div className="px-2 py-2">
          <div className="flex justify-around">
            <button
              onClick={() => setActiveView('home')}
              className={`flex flex-col items-center gap-1 py-2 px-3 rounded-lg transition-colors min-w-0 ${
                activeView === 'home' ? 'text-green-600 bg-green-50' : 'text-gray-500'
              }`}
            >
              <Home className="w-5 h-5" />
              <span className="text-xs">Home</span>
            </button>
            <button
              onClick={() => setActiveView('residents')}
              className={`flex flex-col items-center gap-1 py-2 px-3 rounded-lg transition-colors min-w-0 ${
                activeView === 'residents' ? 'text-green-600 bg-green-50' : 'text-gray-500'
              }`}
            >
              <Users className="w-5 h-5" />
              <span className="text-xs">Residents</span>
            </button>
            <button
              onClick={() => setActiveView('leave')}
              className={`flex flex-col items-center gap-1 py-2 px-3 rounded-lg transition-colors min-w-0 ${
                activeView === 'leave' ? 'text-green-600 bg-green-50' : 'text-gray-500'
              }`}
            >
              <Calendar className="w-5 h-5" />
              <span className="text-xs">Leave</span>
            </button>
            <button
              onClick={() => setActiveView('alerts')}
              className={`flex flex-col items-center gap-1 py-2 px-3 rounded-lg transition-colors min-w-0 relative ${
                activeView === 'alerts' ? 'text-green-600 bg-green-50' : 'text-gray-500'
              }`}
            >
              <Bell className="w-5 h-5" />
              <span className="text-xs">Alerts</span>
              {activeAlerts.length > 0 && (
                <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white text-xs rounded-full flex items-center justify-center">
                  {activeAlerts.length}
                </span>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Modals */}
      {showPrescriptionUpload && selectedResident && (
        <PrescriptionUpload
          residentName={selectedResident.name}
          residentId={selectedResident.residentId}
          onUpload={handlePrescriptionUpload}
          onClose={() => setShowPrescriptionUpload(false)}
        />
      )}

      {showAppointmentBooking && selectedResident && (
        <AppointmentBooking
          residentName={selectedResident.name}
          residentId={selectedResident.residentId}
          onBook={handleBookAppointment}
          onClose={() => setShowAppointmentBooking(false)}
        />
      )}

      {/* Leave Request Modal */}
      {showLeaveRequest && (
        <div className="care-modal-overlay fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full">
            <div className="bg-gradient-to-r from-green-500 to-teal-500 text-white px-6 py-4 flex items-center justify-between rounded-t-2xl">
              <h3 className="text-lg font-semibold">Request Leave</h3>
              <button onClick={() => setShowLeaveRequest(false)} className="p-2 hover:bg-white/20 rounded-full">
                ✕
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Start Date</label>
                <input
                  type="date"
                  value={leaveForm.startDate}
                  onChange={(e) => setLeaveForm({ ...leaveForm, startDate: e.target.value })}
                  min={localToday()}
                  className="w-full px-4 py-3 border border-gray-300 rounded-xl"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">End Date</label>
                <input
                  type="date"
                  value={leaveForm.endDate}
                  onChange={(e) => setLeaveForm({ ...leaveForm, endDate: e.target.value })}
                  min={leaveForm.startDate || localToday()}
                  className="w-full px-4 py-3 border border-gray-300 rounded-xl"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Reason</label>
                <textarea
                  value={leaveForm.reason}
                  onChange={(e) => setLeaveForm({ ...leaveForm, reason: e.target.value })}
                  placeholder="Explain the reason for your leave request..."
                  rows={4}
                  className="w-full px-4 py-3 border border-gray-300 rounded-xl resize-none"
                  required
                />
              </div>
              {leaveError && <p role="alert" className="text-sm text-red-700">{leaveError}</p>}
              <div className="grid grid-cols-2 gap-2 pt-2">
                <button
                  onClick={() => setShowLeaveRequest(false)}
                  className="py-3 border-2 border-gray-300 text-gray-700 rounded-xl font-medium"
                >
                  Cancel
                </button>
                <button
                  onClick={handleLeaveSubmit}
                  disabled={leaveSubmitting || !leaveForm.startDate || !leaveForm.endDate || leaveForm.endDate < leaveForm.startDate || !leaveForm.reason.trim()}
                  className="py-3 bg-green-500 text-white rounded-xl font-medium disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  <Send className="w-4 h-4" />
                  Submit
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Emergency Confirmation Modal */}
      {showEmergencyConfirm && (
        <div className="care-modal-overlay fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full">
            <div className="bg-red-500 text-white px-6 py-4 rounded-t-2xl text-center">
              <AlertTriangle className="w-12 h-12 mx-auto mb-2" />
              <h3 className="text-lg font-bold">Emergency Alert</h3>
            </div>
            <div className="p-6">
              <p className="text-center text-gray-700 mb-6">
                This will send an immediate emergency alert to the administrator. 
                Use only for urgent situations requiring immediate assistance.
              </p>
              <label className="block mb-4 text-sm font-medium text-gray-700">Resident
                <select className="mt-2 w-full rounded-xl border border-gray-300 p-3" value={emergencyResidentId} onChange={e => setEmergencyResidentId(e.target.value)} disabled={emergencySending}>
                  <option value="">Select resident...</option>
                  {caretakerResidents.map(r => <option key={r.residentId} value={r.residentId}>{r.name}</option>)}
                </select>
              </label>
              {caretakerResidents.length === 0 && <p className="mb-4 text-sm text-red-800">No assigned resident is available. Ask the administrator to assign a resident.</p>}
              {emergencyError && <p role="alert" className="mb-4 text-sm text-red-800">{emergencyError}</p>}
              <div className="grid grid-cols-2 gap-3">
                <button
                  disabled={emergencySending}
                  onClick={() => setShowEmergencyConfirm(false)}
                  className="py-3 border-2 border-gray-300 text-gray-700 rounded-xl font-medium"
                >
                  Cancel
                </button>
                <button
                  onClick={handleEmergencyAlert}
                  disabled={emergencySending || !emergencyResidentId}
                  className="py-3 bg-red-500 text-white rounded-xl font-bold"
                >
                  {emergencySending ? 'Sending...' : 'Send Alert'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
