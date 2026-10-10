import { useState, useEffect, useRef, lazy } from 'react';
import { Resident } from '../models/Resident';
import { Dashboard } from '../models/Dashboard';
import { User } from '../models/User';
import { Appointment } from '../models/Appointment';
import { Medication } from '../models/Medication';
import { 
  Pill, 
  Heart, 
  Utensils, 
  AlertCircle, 
  Calendar,
  Clock,
  Activity,
  Upload,
  User as UserIcon,
  Home,
  Phone,
  Users,
  MapPin,
  FileText,
  ShieldCheck,
  Mail,
  Camera,
  Stethoscope,
  Sparkles,
  LogOut,
  MessageSquareWarning,
  Send,
  CheckCircle2
} from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, ResponsiveContainer } from 'recharts';
const PrescriptionUpload = lazy(() => import('./PrescriptionUpload').then(module => ({ default: module.PrescriptionUpload })));
const EmotionLoggerModal = lazy(() => import('./EmotionLoggerModal').then(module => ({ default: module.EmotionLoggerModal })));
const MealPlanView = lazy(() => import('./MealPlanView').then(module => ({ default: module.MealPlanView })));
import { residentsApi, complaintsApi, medicationEventsApi } from '../services/apiService';
import { MonitoringConsentPanel } from './monitoring/MonitoringConsentPanel';
import { MedicationReminderPanel } from './MedicationReminderPanel';
import { CareRecordPanel } from './monitoring/CareRecordPanel';

interface PatientDashboardProps {
  user: User;
  resident: Resident;
  dashboard: Dashboard;
  onLogout: () => void;
  onRefresh: () => void;
}

export function PatientDashboard({ user, resident, dashboard, onLogout, onRefresh }: PatientDashboardProps) {
  const [activeView, setActiveView] = useState<'home' | 'medications' | 'emotions' | 'appointments' | 'profile' | 'mealplan' | 'complaints'>('home');
  const [showPrescriptionUpload, setShowPrescriptionUpload] = useState(false);
  const [showEmotionLogger, setShowEmotionLogger] = useState(false);
  const [complaints, setComplaints] = useState<any[]>([]);
  const [complaintForm, setComplaintForm] = useState({ subject: '', message: '' });
  const [complaintSubmitting, setComplaintSubmitting] = useState(false);
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileError, setProfileError] = useState('');
  const [caretakers, setCaretakers] = useState<any[]>([]);

  const latestEmotion = resident.getLatestEmotionalState();
  const allMedications = resident.getAllMedications();
  const upcomingMedications = allMedications.slice(0, 3);
  const appointments = dashboard.getAppointmentsForResident(resident.residentId);
  const upcomingAppointments = appointments.filter(a => a.isUpcoming());
  
  const emotionChartData = [...resident.emotionalStates]
    .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
    .slice(-7)
    .map(state => ({
      time: state.timestamp.toLocaleDateString([], { weekday: 'short' }),
      score: state.stateScore
    }));

  const handlePrescriptionUpload = async (
    doctorName: string,
    imageFile: File | null,
    medications?: Medication[],
    patientName?: string,
    dateIssued?: string,
    rawText?: string
  ) => {
    if (medications && medications.length > 0) {
      const saved = await dashboard.saveProcessedPrescription(
        resident.residentId,
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
    onRefresh();
  };

  const handleSubmitComplaint = async () => {
    if (complaintSubmitting) return;
    if (!complaintForm.subject.trim() || !complaintForm.message.trim()) return;
    setComplaintSubmitting(true);
    setRecordError('');
    try {
      await complaintsApi.create({
        residentId: resident.residentId,
        residentName: resident.name,
        subject: complaintForm.subject.trim(),
        message: complaintForm.message.trim(),
      });
      setComplaintForm({ subject: '', message: '' });
      try { setComplaints(await complaintsApi.getForResident(resident.residentId)); }
      catch { setRecordError('Your complaint was saved, but the list could not be refreshed. Refresh care records to see it.'); }
    } catch (err) {
      setRecordError(err instanceof Error ? err.message : 'The complaint could not be saved. Please retry.');
    } finally {
      setComplaintSubmitting(false);
    }
  };

  const [profileForm, setProfileForm] = useState({
    address: resident.personalDetails.address || '',
    city: resident.personalDetails.city || '',
    state: resident.personalDetails.state || '',
    zipCode: resident.personalDetails.zipCode || '',
    emergencyContactName: resident.personalDetails.emergencyContactName || '',
    emergencyContactPhone: resident.personalDetails.emergencyContactPhone || '',
    emergencyContactRelation: resident.personalDetails.emergencyContactRelation || '',
  });

  const [recordError, setRecordError] = useState('');
  const [events, setEvents] = useState<any[]>([]);
  const [eventError, setEventError] = useState('');
  const [savingEvent, setSavingEvent] = useState<number | null>(null);
  const localDay = () => { const now = new Date(); return [now.getFullYear(),String(now.getMonth()+1).padStart(2,'0'),String(now.getDate()).padStart(2,'0')].join('-'); };
  const [eventDay, setEventDay] = useState(localDay);
  const eventVersion = useRef(0);
  const eventLock = useRef(false);
  const recordsActive = useRef(true);
  const reloadRecords = async () => {
    const results = await Promise.allSettled([residentsApi.getCaretakers(resident.residentId), complaintsApi.getForResident(resident.residentId)]);
    if (!recordsActive.current) return;
    if (results[0].status === 'fulfilled') setCaretakers(results[0].value);
    if (results[1].status === 'fulfilled') setComplaints(results[1].value);
    setRecordError(results.some(result => result.status === 'rejected') ? 'Some care records could not be loaded. Please retry.' : '');
  };
  useEffect(() => {
    recordsActive.current = true;
    void reloadRecords();
    const refresh = () => { if (document.visibilityState === 'visible') { void reloadRecords(); void reloadEvents(); } };
    const timer = setInterval(refresh, 30000);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => { recordsActive.current = false; clearInterval(timer); window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh); };
  }, [resident.residentId, eventDay]);
  const reloadEvents = async () => {
    const version = ++eventVersion.current;
    try { const rows = await medicationEventsApi.get(resident.residentId,eventDay); if (recordsActive.current && version === eventVersion.current) { setEvents(rows); setEventError(''); } }
    catch (error) { if (recordsActive.current && version === eventVersion.current) setEventError(error instanceof Error ? error.message : 'Medication check-ins could not be loaded.'); }
  };
  useEffect(() => { void reloadEvents(); const timer=setInterval(()=>setEventDay(localDay()),30000); return ()=>{ ++eventVersion.current; clearInterval(timer); }; }, [resident.residentId,eventDay]);
  const saveEvent = async (medicationId: number | undefined, status: 'taken' | 'skipped') => {
    if (!medicationId || eventLock.current) return;
    eventLock.current = true;
    ++eventVersion.current;
    setSavingEvent(medicationId); setEventError('');
    try {
      await medicationEventsApi.save(resident.residentId,medicationId,eventDay,status);
      if (recordsActive.current) setEvents(previous => [...previous.filter(item=>item.medication_id!==medicationId || item.event_day!==eventDay),{medication_id:medicationId,event_day:eventDay,status}]);
    } catch (error) { setEventError(error instanceof Error ? error.message : 'The check-in could not be saved. Please retry.'); }
    finally { eventLock.current = false; if (recordsActive.current) setSavingEvent(null); }
  };
  const takenCount = allMedications.filter(med=>events.some(event=>event.medication_id===med.id && event.event_day===eventDay && event.status==='taken')).length;

  const handleSaveProfile = async () => {
    if (profileSaving) return;
    setProfileSaving(true);
    setProfileError('');
    try {
      await residentsApi.update(resident.residentId, profileForm);
      resident.updatePersonalDetails(profileForm);
      setIsEditingProfile(false);
      onRefresh();
    } catch (error) {
      setProfileError(error instanceof Error ? error.message : 'Profile could not be saved. Please try again.');
    } finally {
      setProfileSaving(false);
    }
  };

  const getGreeting = () => {
    const h = new Date().getHours();
    if (h < 12) return 'Good Morning';
    if (h < 17) return 'Good Afternoon';
    return 'Good Evening';
  };

  const [scheduledMedicationIds, setScheduledMedicationIds] = useState<number[] | null>(null);

  return (
    <div className="care-dashboard min-h-screen pb-28">
      {recordError && <div role="alert" className="m-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-900">{recordError}<button type="button" onClick={() => { void reloadRecords(); onRefresh(); }} className="ml-3 underline">Refresh care records</button></div>}
      {/* Header - Premium */}
      <div className="care-dashboard-header bg-white/80 backdrop-blur-lg shadow-sm border-b border-white/50 sticky top-0 z-10">
        <div className="px-5 py-3.5 flex items-center justify-between max-w-6xl mx-auto">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-teal-600 to-emerald-700 flex items-center justify-center text-white font-bold text-lg shadow-lg shadow-violet-200">
              {resident.name.charAt(0)}
            </div>
            <div>
              <p className="text-xs text-gray-500 font-medium">{getGreeting()} 👋</p>
              <p className="font-bold text-gray-900 text-base">{resident.name.split(' ')[0]}</p>
            </div>
          </div>
          <button onClick={onLogout} className="flex items-center gap-1.5 text-xs text-red-500 hover:text-red-600 px-3 py-2 rounded-xl hover:bg-red-50 transition-all font-semibold">
            <LogOut className="w-3.5 h-3.5" />
            Logout
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="care-dashboard-content px-4 py-6 max-w-6xl mx-auto">
        <section className="care-workspace-intro">
          <div><span>CARECONNECT / YOUR WORKSPACE</span><h1>Your care. A little clearer.</h1><p>Your health, your care team, and your next steps — together.</p></div>
          <div className="care-workspace-emblem" aria-hidden="true"><img src="/careconnect-companion.png" alt="" /></div>
        </section>
        {activeView === 'home' && (
          <div className="space-y-5">

            {/* ─── Assigned Caretaker Card ─── */}
            {caretakers.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <ShieldCheck className="w-4.5 h-4.5 text-teal-600" />
                  <h3 className="text-sm font-bold text-gray-700 uppercase tracking-wide">Your Caretaker</h3>
                </div>
                {caretakers.map(ct => (
                  <div key={ct.caretaker_id} className="bg-white rounded-2xl border border-teal-100 shadow-md shadow-teal-50 overflow-hidden">
                    <div className="p-4 flex items-center gap-4">
                      <div className="relative">
                        <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-teal-100 to-emerald-50 flex items-center justify-center border-2 border-teal-200">
                          <span className="text-2xl font-black text-teal-600">{ct.name.charAt(0)}</span>
                        </div>
                        <div className={`absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full border-2 border-white ${ct.is_active ? 'bg-emerald-400' : 'bg-gray-400'}`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-bold text-gray-900 text-lg">{ct.name}</p>
                        {ct.specialization && (
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <Stethoscope className="w-3.5 h-3.5 text-teal-500" />
                            <span className="text-xs font-semibold text-teal-600">{ct.specialization}</span>
                          </div>
                        )}
                      </div>
                      <div className="flex gap-2">
                        {ct.phone && (
                          <a href={`tel:${ct.phone}`} className="w-10 h-10 rounded-xl bg-teal-500 hover:bg-teal-600 flex items-center justify-center text-white shadow-md shadow-teal-200 transition-all hover:scale-105">
                            <Phone className="w-4.5 h-4.5" />
                          </a>
                        )}
                        {ct.email && (
                          <a href={`mailto:${ct.email}`} className="w-10 h-10 rounded-xl bg-teal-500 hover:bg-teal-600 flex items-center justify-center text-white shadow-md shadow-teal-200 transition-all hover:scale-105">
                            <Mail className="w-4.5 h-4.5" />
                          </a>
                        )}
                      </div>
                    </div>
                    <div className="px-4 pb-3 flex flex-wrap gap-4 text-xs text-gray-500">
                      {ct.phone && <span className="flex items-center gap-1"><Phone className="w-3 h-3" />{ct.phone}</span>}
                      {ct.email && <span className="flex items-center gap-1 truncate"><Mail className="w-3 h-3" />{ct.email}</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* ─── AI Wellness Check Banner ─── */}
            <button
              onClick={() => setShowEmotionLogger(true)}
              className="w-full bg-gradient-to-r from-teal-700 to-emerald-700 hover:from-teal-800 hover:to-emerald-800 rounded-2xl p-4 flex items-center gap-4 text-left shadow-lg shadow-violet-200 transition-all hover:shadow-xl hover:scale-[1.01] active:scale-[0.99]"
            >
              <div className="w-12 h-12 rounded-xl bg-white/20 backdrop-blur flex items-center justify-center flex-shrink-0">
                <Camera className="w-6 h-6 text-white" />
              </div>
              <div className="flex-1">
                <p className="text-white font-bold text-base">Live Face Detection</p>
                <p className="text-violet-200 text-xs font-medium mt-0.5">English • தமிழ் • සිංහල — live expressions and face reports</p>
              </div>
              <Sparkles className="w-5 h-5 text-violet-200 flex-shrink-0" />
            </button>

            {/* Quick Actions - Mobile Grid */}
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => setActiveView('medications')}
                className="bg-white rounded-2xl p-4 shadow-md border border-teal-100 active:scale-95 hover:scale-[1.02] hover:shadow-lg hover:shadow-teal-100 transition-all group"
              >
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-teal-100 to-teal-50 flex items-center justify-center mb-2 mx-auto group-hover:from-teal-200 group-hover:to-teal-100 transition-colors">
                  <Pill className="w-6 h-6 text-teal-600" />
                </div>
                <p className="font-bold text-gray-800 text-center text-sm">My Medicines</p>
                <p className="text-xs text-gray-400 text-center mt-0.5 font-medium">{allMedications.length} active</p>
              </button>

              <button
                onClick={() => setActiveView('emotions')}
                className="bg-white rounded-2xl p-4 shadow-md border border-purple-100 active:scale-95 hover:scale-[1.02] hover:shadow-lg hover:shadow-purple-100 transition-all group"
              >
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-purple-100 to-purple-50 flex items-center justify-center mb-2 mx-auto group-hover:from-purple-200 group-hover:to-purple-100 transition-colors">
                  <Activity className="w-6 h-6 text-purple-600" />
                </div>
                <p className="font-bold text-gray-800 text-center text-sm">How I Feel</p>
                <p className="text-xs text-gray-400 text-center mt-0.5 font-medium">
                  {latestEmotion?.getEmotionalLevel() || 'Track now'}
                </p>
              </button>

              <button
                onClick={() => setActiveView('appointments')}
                className="bg-white rounded-2xl p-4 shadow-md border border-emerald-100 active:scale-95 hover:scale-[1.02] hover:shadow-lg hover:shadow-emerald-100 transition-all group"
              >
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-emerald-100 to-emerald-50 flex items-center justify-center mb-2 mx-auto group-hover:from-emerald-200 group-hover:to-emerald-100 transition-colors">
                  <Calendar className="w-6 h-6 text-emerald-600" />
                </div>
                <p className="font-bold text-gray-800 text-center text-sm">Appointments</p>
                <p className="text-xs text-gray-400 text-center mt-0.5 font-medium">{upcomingAppointments.length} upcoming</p>
              </button>

              <button
                onClick={() => setShowPrescriptionUpload(true)}
                className="bg-white rounded-2xl p-4 shadow-md border border-orange-100 active:scale-95 hover:scale-[1.02] hover:shadow-lg hover:shadow-orange-100 transition-all group"
              >
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-orange-100 to-orange-50 flex items-center justify-center mb-2 mx-auto group-hover:from-orange-200 group-hover:to-orange-100 transition-colors">
                  <Upload className="w-6 h-6 text-orange-600" />
                </div>
                <p className="font-bold text-gray-800 text-center text-sm">Upload Rx</p>
                <p className="text-xs text-gray-400 text-center mt-0.5 font-medium">Scan now</p>
              </button>

              <button
                onClick={() => setActiveView('mealplan')}
                className="bg-white rounded-2xl p-4 shadow-md border border-amber-100 active:scale-95 hover:scale-[1.02] hover:shadow-lg hover:shadow-amber-100 transition-all col-span-2 flex items-center justify-center gap-4 text-left group"
              >
                <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-orange-100 to-amber-50 flex items-center justify-center flex-shrink-0 group-hover:from-orange-200 group-hover:to-amber-100 transition-colors">
                  <Utensils className="w-7 h-7 text-orange-500" />
                </div>
                <div>
                  <p className="font-bold text-gray-800 text-base">My Diet & Meal Plan</p>
                  <p className="text-xs text-gray-400 mt-1 font-medium">Personalized AI meals based on your medications</p>
                </div>
              </button>
            </div>

            {/* Room Info Card */}
            {resident.personalDetails.roomNumber && (
              <div className="bg-gradient-to-r from-teal-100 to-purple-100 rounded-2xl p-4 border border-teal-200">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-teal-900 mb-1">Your Room</p>
                    <p className="text-2xl font-bold text-teal-900">
                      Room {resident.personalDetails.roomNumber}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-teal-900 mb-1">Floor</p>
                    <p className="text-2xl font-bold text-teal-900">
                      {resident.personalDetails.floorNumber}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Today's Summary */}
            <div className="bg-white rounded-2xl p-4 shadow-md border border-gray-100">
              <h3 className="font-semibold text-gray-800 mb-3 text-base">Today's Summary</h3>
              
              <div className="space-y-3">
                <div className="flex items-center justify-between py-2 border-b border-gray-100">
                  <span className="text-sm text-gray-600">Medicines checked in today</span>
                  <span className="font-semibold text-teal-600">{eventError ? 'Unavailable' : `${takenCount} / ${allMedications.length}`}</span>
                </div>
                
                <div className="flex items-center justify-between py-2 border-b border-gray-100">
                  <span className="text-sm text-gray-600">Emotional wellness</span>
                  <span className={`font-semibold ${
                    (latestEmotion?.stateScore || 0) >= 70 ? 'text-green-600' : 
                    (latestEmotion?.stateScore || 0) >= 40 ? 'text-yellow-600' : 
                    'text-orange-600'
                  }`}>
                    {latestEmotion?.getEmotionalLevel() || 'Not tracked'}
                  </span>
                </div>
                
                <div className="flex items-center justify-between py-2">
                  <span className="text-sm text-gray-600">Next appointment</span>
                  <span className="font-semibold text-gray-800 text-sm">
                    {upcomingAppointments.length > 0 
                      ? upcomingAppointments[0].appointmentDate.toLocaleDateString([], { month: 'short', day: 'numeric' })
                      : 'None scheduled'
                    }
                  </span>
                </div>
              </div>
            </div>

            {/* Emotion Chart */}
            {emotionChartData.length > 0 && (
              <div className="bg-white rounded-2xl p-4 shadow-md border border-gray-100">
                <h3 className="font-semibold text-gray-800 mb-3 text-base">Your Wellness Trend</h3>
                
                <ResponsiveContainer width="100%" height={150}>
                  <LineChart data={emotionChartData}>
                    <XAxis dataKey="time" style={{ fontSize: '10px' }} />
                    <YAxis domain={[0, 100]} hide />
                    <Line 
                      type="monotone" 
                      dataKey="score" 
                      stroke="#8b5cf6" 
                      strokeWidth={2}
                      dot={{ fill: '#8b5cf6', r: 3 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        )}

        {activeView === 'medications' && (
          <div className="space-y-3">
            <MedicationReminderPanel key={resident.residentId} resident={resident} onSchedulesChanged={setScheduledMedicationIds} />
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xl font-bold text-gray-800">My Medications</h2>
              <button
                onClick={() => setShowPrescriptionUpload(true)}
                className="px-3 py-1.5 bg-teal-500 text-white rounded-lg text-xs font-medium active:scale-95 transition-transform"
              >
                Upload New
              </button>
            </div>

            <div className="bg-teal-50 rounded-2xl p-4 border border-teal-200 mb-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-teal-900">Medication schedule</span>
                <Clock className="w-4 h-4 text-teal-600" />
              </div>
              <p className="text-sm text-teal-900">Follow the dose and schedule on your verified prescription. These check-ins record your daily status.</p>
              {eventError && <p role="alert" className="mt-2 text-sm text-red-800">{eventError}<button type="button" onClick={reloadEvents} className="ml-2 underline">Retry</button></p>}
            </div>

            {resident.prescriptions.map(prescription => (
              <div key={prescription.prescriptionId}>
                {prescription.medications.map((med, idx) => (
                  <div key={idx} className="bg-white rounded-2xl p-4 shadow-md border border-gray-100 mb-3">
                    <div className="flex items-start gap-3 mb-3">
                      <div className="w-10 h-10 rounded-full bg-purple-100 flex items-center justify-center flex-shrink-0">
                        <Pill className="w-5 h-5 text-purple-600" />
                      </div>
                      <div className="flex-1">
                        <h3 className="font-semibold text-gray-800 text-base mb-1">{med.drugName}</h3>
                        <p className="text-sm text-gray-600 mb-1">{med.frequency}</p>
                        <p className="text-xs text-gray-500">Dosage: {med.dosage}</p>
                      </div>
                    </div>
                    {scheduledMedicationIds?.includes(med.id) ? <p className="text-xs text-teal-800">Record each scheduled dose in the dose reminders above.</p> : <div className="grid grid-cols-2 gap-2">
                      <button disabled={!med.id || savingEvent !== null || scheduledMedicationIds === null} onClick={() => void saveEvent(med.id,'taken')} className="py-2 bg-green-100 text-green-700 rounded-lg font-medium text-xs disabled:opacity-50">
                        {events.some(event=>event.medication_id===med.id && event.event_day===eventDay && event.status==='taken') ? 'Taken today' : 'Taken'}
                      </button>
                      <button disabled={!med.id || savingEvent !== null || scheduledMedicationIds === null} onClick={() => void saveEvent(med.id,'skipped')} className="py-2 bg-gray-100 text-gray-700 rounded-lg font-medium text-xs disabled:opacity-50">
                        {events.some(event=>event.medication_id===med.id && event.event_day===eventDay && event.status==='skipped') ? 'Skipped today' : 'Skip'}
                      </button>
                    </div>}
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}

        {activeView === 'emotions' && (
          <div className="space-y-4">
            <h2 className="text-xl font-bold text-gray-800">How You're Feeling</h2>

            <div className="bg-gradient-to-br from-purple-100 to-pink-100 rounded-2xl p-6 text-center border border-purple-200">
              <p className="text-sm text-purple-900 mb-2">Current Emotional State</p>
              <p className="text-5xl font-bold text-purple-900 mb-2">
                {latestEmotion?.stateScore ?? '--'}
              </p>
              <p className="text-purple-700 font-medium">{latestEmotion?.getEmotionalLevel() || 'No data'}</p>
            </div>

            <div className="bg-white rounded-2xl p-4 shadow-md border border-gray-100">
              <h3 className="font-semibold text-gray-800 mb-3 text-base">This Week</h3>
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={emotionChartData}>
                  <XAxis dataKey="time" style={{ fontSize: '11px' }} />
                  <YAxis domain={[0, 100]} style={{ fontSize: '11px' }} />
                  <Line 
                    type="monotone" 
                    dataKey="score" 
                    stroke="#8b5cf6" 
                    strokeWidth={3}
                    dot={{ fill: '#8b5cf6', r: 4 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>

            <button
              onClick={() => setShowEmotionLogger(true)}
              className="w-full py-4 bg-gradient-to-r from-purple-600 to-indigo-600 text-white rounded-2xl font-semibold shadow-lg active:scale-95 transition-all hover:shadow-purple-200 hover:shadow-xl flex items-center justify-center gap-2"
            >
              <Activity className="w-5 h-5" />
              Log How I Feel Now
            </button>
          </div>
        )}

        {activeView === 'appointments' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xl font-bold text-gray-800">My Appointments</h2>
            </div>

            {upcomingAppointments.length > 0 ? (
              upcomingAppointments.map(apt => (
                <div key={apt.appointmentId} className="bg-white rounded-2xl p-4 shadow-md border border-gray-100">
                  <div className="flex items-start gap-3">
                    <div className="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0">
                      <Calendar className="w-6 h-6 text-green-600" />
                    </div>
                    <div className="flex-1">
                      <h3 className="font-semibold text-gray-800 text-base mb-1">Dr. {apt.doctorName}</h3>
                      <p className="text-sm text-gray-600 mb-1">{apt.specialization}</p>
                      <div className="flex items-center gap-3 text-xs text-gray-500 mb-2">
                        <span className="flex items-center gap-1">
                          <Calendar className="w-3 h-3" />
                          {apt.appointmentDate.toLocaleDateString()}
                        </span>
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {apt.appointmentTime}
                        </span>
                      </div>
                      <p className="text-xs text-gray-600">Reason: {apt.reason}</p>
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div className="bg-white rounded-2xl p-8 text-center">
                <Calendar className="w-16 h-16 mx-auto mb-3 text-gray-300" />
                <p className="text-gray-600">No upcoming appointments</p>
                <p className="text-sm text-gray-400 mt-1">Your caretaker will book appointments for you.</p>
              </div>
            )}
          </div>
        )}

        {activeView === 'profile' && (
          <div className="space-y-4">
            <MonitoringConsentPanel key={resident.residentId} residentId={resident.residentId} />
            <CareRecordPanel key={resident.residentId} residentId={resident.residentId} />
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xl font-bold text-gray-800">My Profile</h2><button type="button" className="text-sm underline" onClick={() => setActiveView("complaints")}>Report a concern</button>
              {!isEditingProfile && (
                <button
                  onClick={() => setIsEditingProfile(true)}
                  className="px-3 py-1.5 bg-teal-500 text-white rounded-lg text-xs font-medium active:scale-95 transition-transform"
                >
                  Edit Info
                </button>
              )}
            </div>

            <div className="bg-white rounded-2xl p-4 shadow-md border border-gray-100 space-y-4">
              {/* Basic Info */}
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <UserIcon className="w-5 h-5 text-teal-600" />
                  <h3 className="font-semibold text-gray-800">Basic Information</h3>
                </div>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between py-2 border-b border-gray-100">
                    <span className="text-gray-600">Name</span>
                    <span className="font-medium text-gray-800">{resident.name}</span>
                  </div>
                  <div className="flex justify-between py-2 border-b border-gray-100">
                    <span className="text-gray-600">Age</span>
                    <span className="font-medium text-gray-800">{resident.age} years</span>
                  </div>
                  <div className="flex justify-between py-2 border-b border-gray-100">
                    <span className="text-gray-600">Resident ID</span>
                    <span className="font-medium text-gray-800">{resident.residentId}</span>
                  </div>
                  {resident.personalDetails.dateOfBirth && (
                    <div className="flex justify-between py-2">
                      <span className="text-gray-600">Date of Birth</span>
                      <span className="font-medium text-gray-800">
                        {resident.personalDetails.dateOfBirth.toLocaleDateString()}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* Address */}
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <Home className="w-5 h-5 text-green-600" />
                  <h3 className="font-semibold text-gray-800">Address</h3>
                </div>
                {isEditingProfile ? (
                  <div className="space-y-2">
                    <input
                      type="text"
                      placeholder="Street Address"
                      value={profileForm.address}
                      onChange={(e) => setProfileForm({ ...profileForm, address: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        type="text"
                        placeholder="City"
                        value={profileForm.city}
                        onChange={(e) => setProfileForm({ ...profileForm, city: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                      />
                      <input
                        type="text"
                        placeholder="State"
                        value={profileForm.state}
                        onChange={(e) => setProfileForm({ ...profileForm, state: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                      />
                    </div>
                    <input
                      type="text"
                      placeholder="ZIP Code"
                      value={profileForm.zipCode}
                      onChange={(e) => setProfileForm({ ...profileForm, zipCode: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                    />
                  </div>
                ) : (
                  <div className="text-sm text-gray-600">
                    {resident.personalDetails.address || 'Not provided'}<br />
                    {resident.personalDetails.city && `${resident.personalDetails.city}, `}
                    {resident.personalDetails.state} {resident.personalDetails.zipCode}
                  </div>
                )}
              </div>

              {/* Emergency Contact */}
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <Phone className="w-5 h-5 text-red-600" />
                  <h3 className="font-semibold text-gray-800">Emergency Contact</h3>
                </div>
                {isEditingProfile ? (
                  <div className="space-y-2">
                    <input
                      type="text"
                      placeholder="Contact Name"
                      value={profileForm.emergencyContactName}
                      onChange={(e) => setProfileForm({ ...profileForm, emergencyContactName: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                    />
                    <input
                      type="tel"
                      placeholder="Contact Phone"
                      value={profileForm.emergencyContactPhone}
                      onChange={(e) => setProfileForm({ ...profileForm, emergencyContactPhone: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                    />
                    <input
                      type="text"
                      placeholder="Relation"
                      value={profileForm.emergencyContactRelation}
                      onChange={(e) => setProfileForm({ ...profileForm, emergencyContactRelation: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                    />
                  </div>
                ) : (
                  <div className="space-y-1 text-sm">
                    <p className="text-gray-800 font-medium">
                      {resident.personalDetails.emergencyContactName || 'Not provided'}
                    </p>
                    <p className="text-gray-600">
                      {resident.personalDetails.emergencyContactPhone}
                    </p>
                    <p className="text-gray-500 text-xs">
                      Relation: {resident.personalDetails.emergencyContactRelation}
                    </p>
                  </div>
                )}
              </div>

              {/* Save/Cancel Buttons */}
              {isEditingProfile && (
                <div className="grid grid-cols-2 gap-2 pt-2">
                  <button
                    onClick={() => setIsEditingProfile(false)}
                    disabled={profileSaving}
                    className="py-2 border-2 border-gray-300 text-gray-700 rounded-lg font-medium text-sm active:scale-95 transition-transform"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSaveProfile}
                    disabled={profileSaving}
                    className="py-2 bg-teal-500 text-white rounded-lg font-medium text-sm active:scale-95 transition-transform"
                  >
                    Save Changes
                  </button>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3 mt-4">
              <button
                onClick={() => setActiveView('emotions')}
                className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100 flex flex-col items-center justify-center gap-2 active:scale-95 transition-transform"
              >
                <div className="w-10 h-10 rounded-full bg-purple-100 flex items-center justify-center text-purple-600">
                  <Activity className="w-5 h-5" />
                </div>
                <span className="text-sm font-semibold text-gray-800">Track Mood</span>
              </button>

              <button
                onClick={() => setActiveView('mealplan')}
                className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100 flex flex-col items-center justify-center gap-2 active:scale-95 transition-transform"
              >
                <div className="w-10 h-10 rounded-full bg-orange-100 flex items-center justify-center text-orange-600">
                  <Utensils className="w-5 h-5" />
                </div>
                <span className="text-sm font-semibold text-gray-800">Diet & Meals</span>
              </button>
            </div>
          </div>
        )}
        {activeView === 'complaints' && (
          <div className="space-y-4">
            <h2 className="text-xl font-bold text-gray-800">Complaints</h2>

            {/* Submit Form */}
            <div className="bg-white rounded-2xl p-4 shadow-md border border-gray-100">
              <h3 className="font-semibold text-gray-800 mb-3 text-base flex items-center gap-2">
                <MessageSquareWarning className="w-5 h-5 text-red-500" />
                Submit a Complaint
              </h3>
              <div className="space-y-3">
                <input
                  type="text"
                  placeholder="Subject"
                  value={complaintForm.subject}
                  onChange={(e) => setComplaintForm({ ...complaintForm, subject: e.target.value })}
                  className="w-full px-3 py-2.5 border border-gray-300 rounded-xl text-sm focus:border-red-400 focus:ring-1 focus:ring-red-200 outline-none transition-all"
                />
                <textarea
                  placeholder="Describe your complaint in detail..."
                  value={complaintForm.message}
                  onChange={(e) => setComplaintForm({ ...complaintForm, message: e.target.value })}
                  className="w-full px-3 py-2.5 border border-gray-300 rounded-xl text-sm resize-none focus:border-red-400 focus:ring-1 focus:ring-red-200 outline-none transition-all"
                  rows={4}
                />
                <button
                  onClick={handleSubmitComplaint}
                  disabled={complaintSubmitting || !complaintForm.subject.trim() || !complaintForm.message.trim()}
                  className="w-full py-3 bg-gradient-to-r from-red-500 to-rose-500 text-white rounded-xl font-semibold shadow-lg active:scale-95 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  <Send className="w-4 h-4" />
                  {complaintSubmitting ? 'Submitting...' : 'Submit Complaint'}
                </button>
              </div>
            </div>

            {/* Complaints History */}
            {complaints.length > 0 ? (
              <div className="space-y-3">
                <h3 className="font-semibold text-gray-700 text-sm">Your Complaints</h3>
                {complaints.map((c: any) => (
                  <div key={c.id} className="bg-white rounded-2xl p-4 shadow-md border border-gray-100">
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <h4 className="font-semibold text-gray-800 text-base">{c.subject}</h4>
                        <p className="text-xs text-gray-400 mt-0.5">
                          {new Date(c.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                        </p>
                      </div>
                      <span className={`text-[10px] font-bold px-2 py-1 rounded-full ${
                        c.status === 'resolved' ? 'bg-green-100 text-green-700' :
                        c.status === 'reviewed' ? 'bg-teal-100 text-teal-700' :
                        'bg-yellow-100 text-yellow-700'
                      }`}>
                        {c.status?.toUpperCase()}
                      </span>
                    </div>
                    <p className="text-sm text-gray-600 mb-2">{c.message}</p>
                    {c.admin_response && (
                      <div className="bg-purple-50 rounded-xl p-3 border border-purple-100">
                        <p className="text-xs font-semibold text-purple-700 flex items-center gap-1 mb-1">
                          <CheckCircle2 className="w-3.5 h-3.5" /> Admin Response
                        </p>
                        <p className="text-sm text-purple-900">{c.admin_response}</p>
                        {c.responded_by && (
                          <p className="text-xs text-purple-500 mt-1 italic">— {c.responded_by}</p>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="bg-white rounded-2xl p-8 text-center">
                <MessageSquareWarning className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                <p className="text-gray-500">No complaints submitted yet.</p>
              </div>
            )}
          </div>
        )}

        {activeView === 'mealplan' && (
          <div className="space-y-4">
            <MealPlanView resident={resident} />
          </div>
        )}
      </div>

      {/* Bottom Navigation - Premium */}
      <div role="navigation" aria-label="Patient navigation" className="care-bottom-nav fixed bottom-0 left-0 right-0 bg-white/80 backdrop-blur-xl border-t border-gray-200/50 shadow-[0_-4px_20px_rgba(0,0,0,0.06)] safe-area-bottom">
        <div className="care-nav-brand"><Heart aria-hidden="true" /><div>CareConnect.<small>Patient space</small></div></div>
        <div className="px-2 py-2 max-w-6xl mx-auto">
          <div className="flex justify-around">
            <button onClick={() => setActiveView('home')} className={`flex flex-col items-center gap-0.5 py-2 px-3 rounded-xl transition-all min-w-0 ${activeView === 'home' ? 'text-violet-600 bg-violet-50 font-bold' : 'text-gray-400 hover:text-gray-600'}`}>
              <Heart className={`w-5 h-5 flex-shrink-0 ${activeView === 'home' ? 'stroke-[2.5px]' : ''}`} />
              <span className="text-[10px] font-semibold">Home</span>
            </button>
            <button onClick={() => setActiveView('medications')} className={`flex flex-col items-center gap-0.5 py-2 px-3 rounded-xl transition-all min-w-0 ${activeView === 'medications' ? 'text-teal-600 bg-teal-50 font-bold' : 'text-gray-400 hover:text-gray-600'}`}>
              <Pill className={`w-5 h-5 flex-shrink-0 ${activeView === 'medications' ? 'stroke-[2.5px]' : ''}`} />
              <span className="text-[10px] font-semibold">Meds</span>
            </button>
            <button onClick={() => setActiveView('appointments')} className={`flex flex-col items-center gap-0.5 py-2 px-3 rounded-xl transition-all min-w-0 ${activeView === 'appointments' ? 'text-emerald-600 bg-emerald-50 font-bold' : 'text-gray-400 hover:text-gray-600'}`}>
              <Calendar className={`w-5 h-5 flex-shrink-0 ${activeView === 'appointments' ? 'stroke-[2.5px]' : ''}`} />
              <span className="text-[10px] font-semibold">Appts</span>
            </button>
            <button onClick={() => setActiveView('emotions')} className={`flex flex-col items-center gap-0.5 py-2 px-3 rounded-xl transition-all min-w-0 ${activeView === 'emotions' ? 'text-purple-600 bg-purple-50 font-bold' : 'text-gray-400 hover:text-gray-600'}`}>
              <Activity className={`w-5 h-5 flex-shrink-0 ${activeView === 'emotions' ? 'stroke-[2.5px]' : ''}`} />
              <span className="text-[10px] font-semibold">Feel</span>
            </button>
            <button onClick={() => setActiveView('mealplan')} className={`flex flex-col items-center gap-0.5 py-2 px-3 rounded-xl transition-all min-w-0 ${activeView === 'mealplan' ? 'text-orange-600 bg-orange-50 font-bold' : 'text-gray-400 hover:text-gray-600'}`}>
              <Utensils className={`w-5 h-5 flex-shrink-0 ${activeView === 'mealplan' ? 'stroke-[2.5px]' : ''}`} />
              <span className="text-[10px] font-semibold">Meals</span>
            </button>
            <button onClick={() => setActiveView('profile')} className={`flex flex-col items-center gap-0.5 py-2 px-3 rounded-xl transition-all min-w-0 ${activeView === 'profile' ? 'text-slate-600 bg-slate-50 font-bold' : 'text-gray-400 hover:text-gray-600'}`}>
              <UserIcon className={`w-5 h-5 flex-shrink-0 ${activeView === 'profile' ? 'stroke-[2.5px]' : ''}`} />
              <span className="text-[10px] font-semibold">Profile</span>
            </button>
          </div>
        </div>
      </div>

      {profileError && <div role="alert" className="fixed bottom-28 left-4 right-4 z-[60] rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{profileError}</div>}

      {/* Modals */}

      {showPrescriptionUpload && (
        <PrescriptionUpload
          residentName={resident.name}
          residentId={resident.residentId}
          onUpload={handlePrescriptionUpload}
          onClose={() => setShowPrescriptionUpload(false)}
        />
      )}



      {showEmotionLogger && (
        <EmotionLoggerModal
          resident={resident}
          onClose={() => setShowEmotionLogger(false)}
          onLogged={onRefresh}
        />
      )}
    </div>
  );
}
