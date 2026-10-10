import { useState, useEffect, useRef } from 'react';
import { Dashboard } from '../models/Dashboard';
import { User } from '../models/User';
import { Resident, PersonalDetails } from '../models/Resident';
import { Caretaker } from '../models/Caretaker';
import { SystemComponent, SystemStatus } from '../models/SystemComponent';
import { createCaretakerAccount, getCaretakerPasswordValidationError as getPasswordValidationError } from '../services/firebaseAuthService';
import { caretakersApi, sosApi, residentsApi, systemApi } from '../services/apiService';
import { PersistedCareAlerts } from './PersistedCareAlerts';
import { MonitoringDevices } from './monitoring/MonitoringDevices';
import { MonitoringIncidents } from './monitoring/MonitoringIncidents';
import { MonitoringConsentPanel } from './monitoring/MonitoringConsentPanel';
import { CareRecordPanel } from './monitoring/CareRecordPanel';
import { MonitoringReports } from './monitoring/MonitoringReports';
import { subscribeSosAlerts } from '../services/sosRealtime';
import { 
  Shield, 
  Users, 
  Activity, 
  Bell, 
  Settings,
  Plus,
  X,
  Loader2,
  AlertTriangle,
  UserPlus,
  Trash2,
  Eye,
  EyeOff
} from 'lucide-react';

interface AdminDashboardProps {
  user: User;
  dashboard: Dashboard;
  onLogout: () => void;
  onRefresh: () => void;
}

export function AdminDashboard({ user, dashboard, onLogout, onRefresh }: AdminDashboardProps) {
  const [activeView, setActiveView] = useState<'overview' | 'residents' | 'caretakers' | 'leave' | 'systems'>('overview');
  const [showAddResident, setShowAddResident] = useState(false);
  const [showAddCaretaker, setShowAddCaretaker] = useState(false);
  const [showAddSystem, setShowAddSystem] = useState(false);
  const [selectedLeaveRequest, setSelectedLeaveRequest] = useState<any>(null);
  const [sosAlerts, setSosAlerts] = useState<any[]>([]);
  const [operationError, setOperationError] = useState('');
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const changeInProgress = useRef(false);

  const runChange = async (action: string, change: () => Promise<void>) => {
    if (changeInProgress.current) return;
    changeInProgress.current = true;
    setPendingAction(action);
    setOperationError('');
    try {
      await change();
    } catch (error) {
      setOperationError(error instanceof Error ? error.message : 'Change could not be saved. Please try again.');
    } finally {
      changeInProgress.current = false;
      setPendingAction(null);
    }
  };

  const emergencyAlerts = dashboard.getActiveEmergencyAlerts();
  const criticalAlerts = dashboard.getCriticalAlerts();
  const pendingLeaveRequests = dashboard.getPendingLeaveRequests();
  const measuredScores=dashboard.residents.map(resident=>resident.getLatestEmotionalState()?.stateScore).filter((score):score is number=>typeof score==='number'&&Number.isFinite(score));
  const avgWellness = measuredScores.length ? Math.round(measuredScores.reduce((sum,score)=>sum+score,0)/measuredScores.length) : '--';

  const [residentForm, setResidentForm] = useState<{
    name: string;
    age: string;
    roomNumber: string;
    floorNumber: string;
    address: string;
    city: string;
    state: string;
    zipCode: string;
    emergencyContactName: string;
    emergencyContactPhone: string;
    emergencyContactRelation: string;
  }>({
    name: '',
    age: '',
    roomNumber: '',
    floorNumber: '',
    address: '',
    city: '',
    state: '',
    zipCode: '',
    emergencyContactName: '',
    emergencyContactPhone: '',
    emergencyContactRelation: ''
  });

  const [caretakerForm, setCaretakerForm] = useState({
    name: '',
    email: '',
    password: '',
    phone: '',
    specialization: ''
  });
  const [caretakerFormError, setCaretakerFormError] = useState('');
  const [caretakerSubmitting, setCaretakerSubmitting] = useState(false);

  const [systemForm, setSystemForm] = useState({
    name: '',
    version: '',
    description: '',
    status: 'online' as SystemStatus
  });

  const [replacementCaretaker, setReplacementCaretaker] = useState('');
  const [loadErrors, setLoadErrors] = useState<Record<string,string>>({});
  const [showCaretakerPassword, setShowCaretakerPassword] = useState(false);
  const recordsActive = useRef(true);
  const refreshRecords = async () => {
    const feeds = [{key:'emergencies',fetch:sosApi.getActive,publish:setSosAlerts}];
    await Promise.all(feeds.map(async feed => {
      try { const rows=await feed.fetch(); if (recordsActive.current) { feed.publish(rows); setLoadErrors(previous=>({...previous,[feed.key]:''})); } }
      catch (error) { if(recordsActive.current) setLoadErrors(previous=>({...previous,[feed.key]:error instanceof Error ? error.message : 'Could not load records.'})); }
    }));
  };

  // Refresh independent feeds; a failed feed retains its last successful records.
  useEffect(() => subscribeSosAlerts(setSosAlerts, message => setLoadErrors(previous => ({ ...previous, liveEmergencies: message }))), [user.userId]);
  useEffect(() => {
    recordsActive.current = true;
    void refreshRecords();
    const refresh = () => { if(document.visibilityState==='visible') void refreshRecords(); };
    const interval=setInterval(refresh,10000);
    window.addEventListener('focus',refresh);
    document.addEventListener('visibilitychange',refresh);
    return ()=>{recordsActive.current=false;clearInterval(interval);window.removeEventListener('focus',refresh);document.removeEventListener('visibilitychange',refresh);};
  }, []);

  const handleResolveSOS = async (alertId: number) => {
    if(changeInProgress.current)return;changeInProgress.current=true;setPendingAction('sos');
    try {
      await sosApi.resolve(alertId, user.name);
      setSosAlerts(prev => prev.filter(a => a.id !== alertId));
    } catch (err) {
      setOperationError('Failed to resolve SOS alert. Please retry.');
    } finally {changeInProgress.current=false;setPendingAction(null);}
  };

  const handleAddResident = () => runChange('resident', async () => {
    if (!residentForm.name.trim() || !residentForm.age.trim() || !Number.isInteger(Number(residentForm.age)) || Number(residentForm.age) < 0 || Number(residentForm.age) > 120) throw new Error('Enter a name and a whole-number age between 0 and 120.');
    const age = Number(residentForm.age);
    const admissionDate = new Date().toISOString().split('T')[0];
    const response = await residentsApi.create({ ...residentForm, name: residentForm.name.trim(), age, admissionDate });
    const resident = new Resident(response.residentId, residentForm.name.trim(), age);
    resident.updatePersonalDetails({ ...residentForm, admissionDate: new Date(`${admissionDate}T00:00:00`) });
    dashboard.addResident(resident);
    setShowAddResident(false);
    setResidentForm({ name: '', age: '', roomNumber: '', floorNumber: '', address: '', city: '', state: '', zipCode: '', emergencyContactName: '', emergencyContactPhone: '', emergencyContactRelation: '' });
    onRefresh();
  });

  const handleRemoveResident = (residentId: string) => {
    if (!confirm('Are you sure you want to remove this resident?')) return;
    void runChange(`resident:${residentId}`, async () => {
      await residentsApi.delete(residentId);
      dashboard.removeResident(residentId);
      dashboard.caretakers.forEach(c => { c.assignedResidents = c.assignedResidents.filter(id => id !== residentId); });
      dashboard.appointments = dashboard.appointments.filter(a => a.residentId !== residentId);
      onRefresh();
    });
  };

  const closeCaretakerModal = () => {
    setShowAddCaretaker(false);
    setCaretakerForm({ name: '', email: '', password: '', phone: '', specialization: '' });
    setCaretakerFormError('');
    setCaretakerSubmitting(false);
    setShowCaretakerPassword(false);
  };

  const handleAddCaretaker = async () => {
    setCaretakerFormError('');

    const passwordError = getPasswordValidationError(caretakerForm.password);
    if (passwordError) {
      setCaretakerFormError(passwordError);
      return;
    }
    if(changeInProgress.current)return;changeInProgress.current=true;setPendingAction('caretaker-create');

    setCaretakerSubmitting(true);

    try {
      const created = await createCaretakerAccount({
        name: caretakerForm.name,
        email: caretakerForm.email,
        password: caretakerForm.password,
        phone: caretakerForm.phone,
        specialization: caretakerForm.specialization,
      });

      const caretaker = new Caretaker(
        created.caretakerId,
        caretakerForm.name,
        caretakerForm.email,
        caretakerForm.phone,
        caretakerForm.specialization
      );
      dashboard.addCaretaker(caretaker);
      closeCaretakerModal();
      onRefresh();
    } catch (error: any) {
      setCaretakerFormError(error?.message || 'Failed to create caretaker account.');
    } finally {
      changeInProgress.current=false;setPendingAction(null);
      setCaretakerSubmitting(false);
    }
  };

  const openCaretakerModal = () => {
    setCaretakerFormError('');
    setCaretakerSubmitting(false);
    setShowAddCaretaker(true);
  };

  const handleRemoveCaretaker = (caretakerId: string) => {
    if (!confirm('Are you sure you want to remove this caretaker?')) return;
    void runChange(`caretaker:${caretakerId}`, async () => {
      await caretakersApi.delete(caretakerId);
      dashboard.removeCaretaker(caretakerId);
      onRefresh();
    });
  };

  const handleAddSystem = () => runChange('system', async () => {
    if (!systemForm.name.trim()) throw new Error('System name is required.');
    const componentId = `SYS-${Date.now()}`;
    await systemApi.createComponent({ componentId, ...systemForm, name: systemForm.name.trim() });
    dashboard.addSystemComponent(new SystemComponent(componentId, systemForm.name.trim(), systemForm.version, systemForm.description, systemForm.status));
    setShowAddSystem(false);
    setSystemForm({ name: '', version: '', description: '', status: 'online' });
    onRefresh();
  });

  const handleToggleSystemStatus = (componentId: string, currentStatus: SystemStatus) => runChange(`system:${componentId}`, async () => {
    const component = dashboard.getSystemComponent(componentId);
    if (!component) throw new Error('System component was not found.');
    const status: SystemStatus = currentStatus === 'online' ? 'offline' : currentStatus === 'offline' ? 'maintenance' : 'online';
    await systemApi.updateComponent(componentId, { status });
    component.setStatus(status);
    onRefresh();
  });

  const handleRemoveSystem = (componentId: string) => {
    if (!confirm('Remove this system component?')) return;
    void runChange(`system:${componentId}`, async () => {
      await systemApi.deleteComponent(componentId);
      dashboard.removeSystemComponent(componentId);
      onRefresh();
    });
  };

  const handleApproveLeave = (request: any) => runChange(`leave:${request.requestId}`, async () => {
        await caretakersApi.updateLeaveRequest(request.caretakerId, request.requestId, {
           status: 'approved',
           reviewedBy: user.name,
           temporaryReplacement: replacementCaretaker || undefined
        });
        request.approve(user.name, dashboard.getCaretaker(replacementCaretaker)?.name);
        setSelectedLeaveRequest(null);
        setReplacementCaretaker('');
        onRefresh();
  });

  const handleRejectLeave = (request: any) => runChange(`leave:${request.requestId}`, async () => {
      await caretakersApi.updateLeaveRequest(request.caretakerId, request.requestId, {
         status: 'rejected',
         reviewedBy: user.name
      });
      request.reject(user.name);
      setSelectedLeaveRequest(null);
      onRefresh();
  });

  const handleAcknowledgeEmergency = (alertId: string) => {
    const alert = dashboard.emergencyAlerts.find(a => a.alertId === alertId);
    if (alert) {
      alert.acknowledge(user.name);
      onRefresh();
    }
  };

  return (
    <div className="care-dashboard min-h-screen pb-28">
      {operationError && <div role="alert" className="fixed bottom-28 left-4 right-4 z-[60] rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{operationError}<button className="ml-3 underline" onClick={() => setOperationError('')}>Dismiss</button></div>}
      {/* Header */}
      <div className="care-dashboard-header bg-white shadow-sm border-b border-gray-200 sticky top-0 z-10">
        <div className="px-3 py-2.5">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <div className="w-9 h-9 rounded-full bg-gradient-to-br from-teal-600 to-emerald-600 flex items-center justify-center text-white">
                <Shield className="w-4 h-4" />
              </div>
              <div>
                <p className="text-xs text-gray-600">Administrator</p>
                <p className="font-semibold text-gray-800 text-sm">{user.name.split(' ')[0]}</p>
              </div>
            </div>
            <button onClick={onLogout} className="text-xs text-gray-600 px-2 py-1 rounded hover:bg-gray-100">
              Logout
            </button>
          </div>
          
          {/* Emergency Alerts */}
          {emergencyAlerts.length > 0 && (
            <div className="bg-red-50 border border-red-300 rounded-lg p-2 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-red-600 animate-pulse flex-shrink-0" />
              <span className="text-xs font-medium text-red-900 flex-1">
                {emergencyAlerts.length} EMERGENCY ALERT{emergencyAlerts.length > 1 ? 'S' : ''}!
              </span>
              <button 
                onClick={() => handleAcknowledgeEmergency(emergencyAlerts[0].alertId)}
                className="text-xs font-medium text-white px-2 py-1 bg-red-600 rounded"
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
          <div><span>CARECONNECT / YOUR WORKSPACE</span><h1>A clearer view of your care community.</h1><p>People, wellbeing, and daily operations in one connected workspace.</p></div>
          <div className="care-workspace-emblem" aria-hidden="true"><img src="/careconnect-companion.png" alt="" /></div>
        </section>
        {/* SOS Emergency Banner — always visible when active */}
        {Object.entries(loadErrors).filter(([,message])=>message).map(([key,message])=><div role="alert" key={key} className="mb-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-900">Could not load {key}: {message}<button type="button" className="ml-3 underline" onClick={()=>void refreshRecords()}>Retry</button></div>)}
        <PersistedCareAlerts includeSos={false} />
        <MonitoringIncidents residents={dashboard.residents} />
        {sosAlerts.length > 0 && (
          <div className="mb-3 space-y-2">
            {sosAlerts.map(alert => (
              <div key={alert.id} className="bg-red-600 text-white rounded-xl p-4 shadow-lg animate-pulse border-2 border-red-400">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-white/20 rounded-full flex items-center justify-center">
                      <AlertTriangle className="w-6 h-6 text-white" />
                    </div>
                    <div>
                      <p className="font-black text-lg">🚨 SOS EMERGENCY</p>
                      <p className="text-red-100 text-sm font-semibold">{alert.resident_name || 'Resident'} — {alert.message}</p>
                      <p className="text-red-100 text-sm">From: {alert.caretaker_name || alert.sender_name || "Resident"} · Location: {alert.location || "Location not recorded"}</p><p className="text-red-200 text-xs mt-0.5">{new Date(alert.created_at).toLocaleString()}</p>
                    </div>
                  </div>
                  <button
                    onClick={() => handleResolveSOS(alert.id)}
                    className="bg-white text-red-600 font-bold text-sm px-4 py-2 rounded-lg hover:bg-red-50 transition-colors shadow-md"
                  >
                    Acknowledge
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {activeView === 'overview' && (
          <div className="space-y-3">
            {/* Stats Grid */}
            <div className="grid grid-cols-2 gap-2">
              <div className="bg-white rounded-lg p-3 shadow-sm border border-gray-200">
                <Users className="w-6 h-6 text-teal-500 mb-1" />
                <p className="text-xl font-bold text-gray-800">{dashboard.residents.length}</p>
                <p className="text-xs text-gray-600">Residents</p>
              </div>

              <div className="bg-white rounded-lg p-3 shadow-sm border border-gray-200">
                <Users className="w-6 h-6 text-green-500 mb-1" />
                <p className="text-xl font-bold text-gray-800">{dashboard.caretakers.length}</p><p className="text-xs text-gray-500">{dashboard.caretakers.filter(c => c.isActive).length} active · {dashboard.caretakers.filter(c => !c.isActive).length} inactive</p>
                <p className="text-xs text-gray-600">Caretakers</p>
              </div>

              <div className="bg-white rounded-lg p-3 shadow-sm border border-gray-200">
                <Activity className="w-6 h-6 text-purple-500 mb-1" />
                <p className="text-xl font-bold text-gray-800">{avgWellness}</p>
                <p className="text-xs text-gray-600">Avg Wellness</p>
              </div>

              <div className="bg-white rounded-lg p-3 shadow-sm border border-gray-200">
                <Bell className="w-6 h-6 text-orange-500 mb-1" />
                <p className="text-xl font-bold text-gray-800">{criticalAlerts.length}</p>
                <p className="text-xs text-gray-600">Critical Alerts</p>
              </div>
            </div>

            {/* Pending Leave Requests */}
            {pendingLeaveRequests.length > 0 && (
              <div className="bg-yellow-50 border border-yellow-300 rounded-lg p-3">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-semibold text-yellow-900 text-sm">Pending Leave Requests</h3>
                  <span className="bg-yellow-200 text-yellow-900 text-xs font-bold px-2 py-0.5 rounded-full">
                    {pendingLeaveRequests.length}
                  </span>
                </div>
                <button 
                  onClick={() => setActiveView('leave')}
                  className="text-xs text-yellow-700 font-medium underline"
                >
                  Review now →
                </button>
              </div>
            )}

            {/* Quick Actions */}
            <div className="bg-white rounded-lg p-3 shadow-sm border border-gray-200">
              <h3 className="font-semibold text-gray-800 mb-2 text-sm">Quick Actions</h3>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
                <button
                  onClick={() => setShowAddResident(true)}
                  className="py-2 bg-teal-50 text-teal-700 rounded-lg text-xs font-medium active:scale-95 transition-transform flex items-center justify-center gap-1"
                >
                  <Plus className="w-3 h-3" />
                  Add Resident
                </button>
                <button
                  onClick={openCaretakerModal}
                  className="py-2 bg-green-50 text-green-700 rounded-lg text-xs font-medium active:scale-95 transition-transform flex items-center justify-center gap-1"
                >
                  <Plus className="w-3 h-3" />
                  Add Caretaker
                </button>
                <button
                  onClick={() => setActiveView('residents')}
                  className="py-2 bg-purple-50 text-purple-700 rounded-lg text-xs font-medium active:scale-95 transition-transform"
                >
                  Manage Residents
                </button>
                <button
                  onClick={() => setActiveView('systems')}
                  className="py-2 bg-orange-50 text-orange-700 rounded-lg text-xs font-medium active:scale-95 transition-transform"
                >
                  System Status
                </button>
              </div>
            </div>

            {/* System Status Overview */}
            <div className="bg-white rounded-lg p-3 shadow-sm border border-gray-200">
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-semibold text-gray-800 text-sm">System Components</h3>
                <button 
                  onClick={() => setActiveView('systems')}
                  className="text-xs text-teal-600"
                >
                  View All
                </button>
              </div>
              <p className="mb-2 text-xs text-gray-600">{dashboard.systemComponents.filter(c => c.status === "online").length} online · {dashboard.systemComponents.filter(c => c.status === "offline").length} offline · {dashboard.systemComponents.filter(c => c.status === "maintenance").length} maintenance</p><div className="space-y-1.5">
                {dashboard.systemComponents.slice(0, 3).map(comp => (
                  <div key={comp.componentId} className="flex items-center justify-between py-1.5 border-b border-gray-100 last:border-0">
                    <div className="flex items-center gap-2">
                      <div className={`w-2 h-2 rounded-full ${
                        comp.status === 'online' ? 'bg-green-500' :
                        comp.status === 'offline' ? 'bg-red-500' :
                        'bg-yellow-500'
                      }`} />
                      <span className="text-xs font-medium text-gray-800">{comp.name}</span>
                    </div>
                    <span className="text-xs text-gray-500">{comp.version}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {activeView === 'residents' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-gray-800">Residents</h2>
              <button
                onClick={() => setShowAddResident(true)}
                className="px-3 py-1.5 bg-teal-500 text-white rounded-lg text-xs font-medium active:scale-95 transition-transform"
              >
                <Plus className="w-3 h-3 inline mr-1" />
                Add
              </button>
            </div>

            <div className="space-y-2">
              {dashboard.residents.map(resident => {
                // Find assigned caretaker(s) for this resident
                const assignedCaretakers = dashboard.caretakers.filter(c =>
                  c.assignedResidents.includes(resident.residentId)
                );
                const primaryCaretaker = assignedCaretakers[0];

                return (
                  <div key={resident.residentId} className="bg-white rounded-lg p-3 shadow-sm border border-gray-200">
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <h3 className="font-semibold text-gray-800 text-sm">{resident.name}</h3>
                        <p className="text-xs text-gray-600">
                          Age {resident.age} • Room {resident.personalDetails.roomNumber}
                        </p>
                      </div>
                      <button
                        onClick={() => handleRemoveResident(resident.residentId)}
                        className="p-1.5 text-red-600 hover:bg-red-50 rounded"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>

                    {/* Assigned Caretaker Section */}
                    <div className="mb-2 p-2 rounded-lg bg-gradient-to-r from-teal-50 to-cyan-50 border border-teal-200">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className="w-6 h-6 rounded-full bg-teal-500 flex items-center justify-center flex-shrink-0">
                            <UserPlus className="w-3 h-3 text-white" />
                          </div>
                          <div>
                            <p className="text-xs text-teal-700 font-medium">Assigned Caretaker</p>
                            <p className="text-xs font-bold text-teal-900">
                              {primaryCaretaker ? primaryCaretaker.name : '— Unassigned —'}
                            </p>
                          </div>
                        </div>
                        <select
                          value={primaryCaretaker?.caretakerId || ''}
                          disabled={Boolean(pendingAction)}
                          aria-label={`Assigned caretaker for ${resident.name}`}
                          onChange={e => { const newCaretakerId = e.target.value; void runChange(`assignment:${resident.residentId}`, async () => {
                            await caretakersApi.reassignResident({ residentId: resident.residentId, toCaretakerId: newCaretakerId || null });
                            dashboard.caretakers.forEach(c => { c.assignedResidents = c.assignedResidents.filter(id => id !== resident.residentId); });
                            const assigned = dashboard.getCaretaker(newCaretakerId);
                            if (assigned) assigned.assignedResidents.push(resident.residentId);
                            onRefresh();
                          }); }}
                          className="text-xs border border-teal-300 rounded-lg px-2 py-1 bg-white text-teal-900 font-medium cursor-pointer focus:ring-2 focus:ring-teal-400 focus:outline-none"
                        >
                          <option value="">Unassigned</option>
                          {dashboard.caretakers.filter(c => c.isActive || c.caretakerId === primaryCaretaker?.caretakerId).map(c => (
                            <option key={c.caretakerId} value={c.caretakerId} disabled={!c.isActive}>
                              {c.name} ({c.specialization || 'General'})
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-2 text-xs">
                      <div className="bg-teal-50 rounded p-1.5 text-center">
                        <p className="text-teal-900 font-bold">{resident.getAllMedications().length}</p>
                        <p className="text-teal-700">Meds</p>
                      </div>
                      <div className="bg-purple-50 rounded p-1.5 text-center">
                        <p className="text-purple-900 font-bold">{resident.prescriptions.length}</p>
                        <p className="text-purple-700">Rx</p>
                      </div>
                      <div className="bg-green-50 rounded p-1.5 text-center">
                        <p className="text-green-900 font-bold">{resident.getLatestEmotionalState()?.stateScore ?? '--'}</p>
                        <p className="text-green-700">Wellness</p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {activeView === 'caretakers' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-gray-800">Caretakers</h2>
              <button
                onClick={openCaretakerModal}
                className="px-3 py-1.5 bg-green-500 text-white rounded-lg text-xs font-medium active:scale-95 transition-transform"
              >
                <Plus className="w-3 h-3 inline mr-1" />
                Add
              </button>
            </div>

            <div className="space-y-2">
              {dashboard.caretakers.map(caretaker => (
                <div key={caretaker.caretakerId} className="bg-white rounded-lg p-3 shadow-sm border border-gray-200">
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <h3 className="font-semibold text-gray-800 text-sm">{caretaker.name}</h3>
                      <p className="text-xs text-gray-600">{caretaker.specialization}</p>
                      <p className="text-xs text-gray-500">{caretaker.email}</p>
                      <p className="text-xs text-gray-500">{caretaker.phone}</p>
                    </div>
                    <button
                      onClick={() => handleRemoveCaretaker(caretaker.caretakerId)}
                      className="p-1.5 text-red-600 hover:bg-red-50 rounded"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-gray-600">
                      Assigned: {caretaker.assignedResidents.length} residents
                    </span>
                    <span className={`px-2 py-0.5 rounded ${
                      caretaker.isActive ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
                    }`}>
                      {caretaker.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeView === 'leave' && (
          <div className="space-y-3">
            <h2 className="text-lg font-bold text-gray-800">Leave Requests</h2>

            {pendingLeaveRequests.length > 0 ? (
              <div className="space-y-2">
                {pendingLeaveRequests.map(request => (
                  <div key={request.requestId} className="bg-white rounded-lg p-3 shadow-sm border border-yellow-300">
                    <div className="mb-2">
                      <div className="flex items-center justify-between mb-1">
                        <h3 className="font-semibold text-gray-800 text-sm">{request.caretakerName}</h3>
                        <span className="bg-yellow-100 text-yellow-800 text-xs font-medium px-2 py-0.5 rounded">
                          PENDING
                        </span>
                      </div>
                      <p className="text-xs text-gray-600 mb-1">
                        {request.startDate.toLocaleDateString()} - {request.endDate.toLocaleDateString()}
                      </p>
                      <p className="text-xs text-gray-600 mb-1">
                        <strong>{request.numberOfDays} day{request.numberOfDays > 1 ? 's' : ''}</strong>
                      </p>
                      <p className="text-xs text-gray-700">
                        <strong>Reason:</strong> {request.reason}
                      </p>
                    </div>

                    {selectedLeaveRequest?.requestId === request.requestId ? (
                      <div className="space-y-2 pt-2 border-t border-gray-200">
                        <div>
                          <label className="block text-xs font-medium text-gray-700 mb-1">
                            Assign Temporary Replacement (Optional)
                          </label>
                          <select
                            value={replacementCaretaker}
                            onChange={(e) => setReplacementCaretaker(e.target.value)}
                            className="w-full px-2 py-1.5 text-xs border border-gray-300 rounded"
                          >
                            <option value="">No replacement</option>
                            {dashboard.caretakers
                              .filter(c => c.caretakerId !== request.caretakerId && c.isActive)
                              .map(c => (
                                <option key={c.caretakerId} value={c.caretakerId}>{c.name}</option>
                              ))
                            }
                          </select>
                        </div>
                        <div className="grid grid-cols-3 gap-1.5">
                          <button
                            onClick={() => {
                              setSelectedLeaveRequest(null);
                              setReplacementCaretaker('');
                            }}
                            className="py-1.5 border border-gray-300 text-gray-700 rounded text-xs font-medium"
                          >
                            Cancel
                          </button>
                          <button
                            disabled={Boolean(pendingAction)}
                            onClick={() => void handleRejectLeave(request)}
                            className="py-1.5 bg-red-500 text-white rounded text-xs font-medium"
                          >
                            Reject
                          </button>
                          <button
                            disabled={Boolean(pendingAction)}
                            onClick={() => void handleApproveLeave(request)}
                            className="py-1.5 bg-green-500 text-white rounded text-xs font-medium"
                          >
                            Approve
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        onClick={() => setSelectedLeaveRequest(request)}
                        className="w-full py-2 bg-teal-500 text-white rounded-lg text-xs font-medium mt-2"
                      >
                        Review Request
                      </button>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="bg-white rounded-lg p-6 text-center">
                <p className="text-sm text-gray-600">No pending leave requests</p>
              </div>
            )}
          </div>
        )}

        {activeView === 'systems' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-gray-800">System Components</h2>
              <button
                onClick={() => setShowAddSystem(true)}
                className="px-3 py-1.5 bg-purple-500 text-white rounded-lg text-xs font-medium active:scale-95 transition-transform"
              >
                <Plus className="w-3 h-3 inline mr-1" />
                Add
              </button>
            </div>

            <div className="space-y-2">
              {dashboard.systemComponents.map(comp => (
                <div key={comp.componentId} className="bg-white rounded-lg p-3 shadow-sm border border-gray-200">
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <div className={`w-2.5 h-2.5 rounded-full ${
                          comp.status === 'online' ? 'bg-green-500 animate-pulse' :
                          comp.status === 'offline' ? 'bg-red-500' :
                          'bg-yellow-500 animate-pulse'
                        }`} />
                        <h3 className="font-semibold text-gray-800 text-sm">{comp.name}</h3>
                      </div>
                      <p className="text-xs text-gray-600 mb-1">{comp.description}</p>
                      <p className="text-xs text-gray-500">Version: {comp.version}</p>
                    </div>
                    <button
                      onClick={() => handleRemoveSystem(comp.componentId)}
                      className="p-1.5 text-red-600 hover:bg-red-50 rounded flex-shrink-0"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                  <button
                    onClick={() => handleToggleSystemStatus(comp.componentId, comp.status)}
                    className={`w-full py-1.5 rounded text-xs font-medium ${
                      comp.status === 'online' ? 'bg-green-100 text-green-800' :
                      comp.status === 'offline' ? 'bg-red-100 text-red-800' :
                      'bg-yellow-100 text-yellow-800'
                    }`}
                  >
                    {comp.status.toUpperCase()} - Tap to change
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Bottom Navigation */}
      <div role="navigation" aria-label="Administrator navigation" className="care-bottom-nav fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 shadow-lg">
        <div className="care-nav-brand"><Shield aria-hidden="true" /><div>CareConnect.<small>Administration</small></div></div>
        <div className="px-1 py-1.5">
          <div className="flex justify-around">
            <button
              onClick={() => setActiveView('overview')}
              className={`flex flex-col items-center gap-0.5 py-1.5 px-2 rounded-lg transition-colors min-w-0 ${
                activeView === 'overview' ? 'text-purple-600 bg-purple-50' : 'text-gray-500'
              }`}
            >
              <Shield className="w-5 h-5" />
              <span className="text-xs">Overview</span>
            </button>
            <button
              onClick={() => setActiveView('residents')}
              className={`flex flex-col items-center gap-0.5 py-1.5 px-2 rounded-lg transition-colors min-w-0 ${
                activeView === 'residents' ? 'text-purple-600 bg-purple-50' : 'text-gray-500'
              }`}
            >
              <Users className="w-5 h-5" />
              <span className="text-xs">Residents</span>
            </button>
            <button
              onClick={() => setActiveView('caretakers')}
              className={`flex flex-col items-center gap-0.5 py-1.5 px-2 rounded-lg transition-colors min-w-0 ${
                activeView === 'caretakers' ? 'text-purple-600 bg-purple-50' : 'text-gray-500'
              }`}
            >
              <UserPlus className="w-5 h-5" />
              <span className="text-xs">Caretakers</span>
            </button>
            <button
              onClick={() => setActiveView('leave')}
              className={`flex flex-col items-center gap-0.5 py-1.5 px-2 rounded-lg transition-colors min-w-0 relative ${
                activeView === 'leave' ? 'text-purple-600 bg-purple-50' : 'text-gray-500'
              }`}
            >
              <Bell className="w-5 h-5" />
              <span className="text-xs">Leave</span>
              {pendingLeaveRequests.length > 0 && (
                <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-yellow-500 text-white text-xs rounded-full flex items-center justify-center font-bold">
                  {pendingLeaveRequests.length}
                </span>
              )}
            </button>
            <button
              onClick={() => setActiveView('systems')}
              className={`flex flex-col items-center gap-0.5 py-1.5 px-2 rounded-lg transition-colors min-w-0 ${
                activeView === 'systems' ? 'text-purple-600 bg-purple-50' : 'text-gray-500'
              }`}
            >
              <Settings className="w-5 h-5" />
              <span className="text-xs">Systems</span>
            </button>

          </div>
        </div>
      </div>

      {/* Modals */}
      {showAddResident && (
        <div className="care-modal-overlay fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50">
          <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-teal-500 text-white px-4 py-3 flex items-center justify-between rounded-t-2xl">
              <h3 className="font-semibold text-base">Add New Resident</h3>
              <button onClick={() => setShowAddResident(false)} className="p-1">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 space-y-3">
              <input
                type="text"
                placeholder="Full Name"
                value={residentForm.name}
                onChange={(e) => setResidentForm({ ...residentForm, name: e.target.value })}
                className="w-full px-3 py-2 text-sm border rounded-lg"
              />
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="number"
                  placeholder="Age"
                  value={residentForm.age}
                  onChange={(e) => setResidentForm({ ...residentForm, age: e.target.value })}
                  className="w-full px-3 py-2 text-sm border rounded-lg"
                />
                <input
                  type="text"
                  placeholder="Room #"
                  value={residentForm.roomNumber}
                  onChange={(e) => setResidentForm({ ...residentForm, roomNumber: e.target.value })}
                  className="w-full px-3 py-2 text-sm border rounded-lg"
                />
              </div>
              <input
                type="text"
                placeholder="Floor #"
                value={residentForm.floorNumber}
                onChange={(e) => setResidentForm({ ...residentForm, floorNumber: e.target.value })}
                className="w-full px-3 py-2 text-sm border rounded-lg"
              />
              <input
                type="text"
                placeholder="Address"
                value={residentForm.address}
                onChange={(e) => setResidentForm({ ...residentForm, address: e.target.value })}
                className="w-full px-3 py-2 text-sm border rounded-lg"
              />
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="text"
                  placeholder="City"
                  value={residentForm.city}
                  onChange={(e) => setResidentForm({ ...residentForm, city: e.target.value })}
                  className="w-full px-3 py-2 text-sm border rounded-lg"
                />
                <input
                  type="text"
                  placeholder="State"
                  value={residentForm.state}
                  onChange={(e) => setResidentForm({ ...residentForm, state: e.target.value })}
                  className="w-full px-3 py-2 text-sm border rounded-lg"
                />
              </div>
              <input
                type="text"
                placeholder="ZIP Code"
                value={residentForm.zipCode}
                onChange={(e) => setResidentForm({ ...residentForm, zipCode: e.target.value })}
                className="w-full px-3 py-2 text-sm border rounded-lg"
              />
              <input
                type="text"
                placeholder="Emergency Contact Name"
                value={residentForm.emergencyContactName}
                onChange={(e) => setResidentForm({ ...residentForm, emergencyContactName: e.target.value })}
                className="w-full px-3 py-2 text-sm border rounded-lg"
              />
              <input
                type="tel"
                placeholder="Emergency Contact Phone"
                value={residentForm.emergencyContactPhone}
                onChange={(e) => setResidentForm({ ...residentForm, emergencyContactPhone: e.target.value })}
                className="w-full px-3 py-2 text-sm border rounded-lg"
              />
              <input
                type="text"
                placeholder="Relation"
                value={residentForm.emergencyContactRelation}
                onChange={(e) => setResidentForm({ ...residentForm, emergencyContactRelation: e.target.value })}
                className="w-full px-3 py-2 text-sm border rounded-lg"
              />
              <div className="grid grid-cols-2 gap-2 pt-2">
                <button
                  onClick={() => setShowAddResident(false)}
                  className="py-2.5 border-2 border-gray-300 text-gray-700 rounded-lg font-medium text-sm"
                >
                  Cancel
                </button>
                <button
                  onClick={handleAddResident}
                  disabled={pendingAction !== null || !residentForm.name || !residentForm.age}
                  className="py-2.5 bg-teal-500 text-white rounded-lg font-medium text-sm disabled:opacity-50"
                >
                  Add Resident
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showAddCaretaker && (
        <div className="care-modal-overlay fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50">
          <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md">
            <div className="bg-green-500 text-white px-4 py-3 flex items-center justify-between rounded-t-2xl">
              <h3 className="font-semibold text-base">Add New Caretaker</h3>
              <button onClick={closeCaretakerModal} className="p-1" disabled={caretakerSubmitting}>
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 space-y-3">
              {caretakerFormError && (
                <div className="p-2.5 bg-red-50 border border-red-200 rounded text-xs text-red-700">
                  {caretakerFormError}
                </div>
              )}

              <input
                type="text"
                placeholder="Full Name"
                value={caretakerForm.name}
                onChange={(e) => setCaretakerForm({ ...caretakerForm, name: e.target.value })}
                className="w-full px-3 py-2 text-sm border rounded-lg"
                disabled={caretakerSubmitting}
              />
              <input
                type="email"
                placeholder="Email"
                value={caretakerForm.email}
                onChange={(e) => setCaretakerForm({ ...caretakerForm, email: e.target.value })}
                className="w-full px-3 py-2 text-sm border rounded-lg"
                disabled={caretakerSubmitting}
              />
              <div className="relative">
                <input
                  type={showCaretakerPassword ? 'text' : 'password'}
                  placeholder="Temporary Password"
                  value={caretakerForm.password}
                  onChange={(e) => setCaretakerForm({ ...caretakerForm, password: e.target.value })}
                  className="w-full px-3 py-2 pr-10 text-sm border rounded-lg"
                  autoComplete="new-password"
                  minLength={6}
                  disabled={caretakerSubmitting}
                />
                <button
                  type="button"
                  onClick={() => setShowCaretakerPassword((visible) => !visible)}
                  className="absolute inset-y-0 right-0 px-3 text-gray-500"
                  aria-label={showCaretakerPassword ? 'Hide caretaker password' : 'Show caretaker password'}
                  aria-pressed={showCaretakerPassword}
                  disabled={caretakerSubmitting}
                >
                  {showCaretakerPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <p className="text-xs text-gray-500">Use at least 6 characters for the temporary password.</p>
              <input
                type="tel"
                placeholder="Phone"
                value={caretakerForm.phone}
                onChange={(e) => setCaretakerForm({ ...caretakerForm, phone: e.target.value })}
                className="w-full px-3 py-2 text-sm border rounded-lg"
                disabled={caretakerSubmitting}
              />
              <input
                type="text"
                placeholder="Specialization"
                value={caretakerForm.specialization}
                onChange={(e) => setCaretakerForm({ ...caretakerForm, specialization: e.target.value })}
                className="w-full px-3 py-2 text-sm border rounded-lg"
                disabled={caretakerSubmitting}
              />
              <p className="text-xs text-gray-500">
                This will create a real caretaker login account.
              </p>
              <div className="grid grid-cols-2 gap-2 pt-2">
                <button
                  onClick={closeCaretakerModal}
                  disabled={caretakerSubmitting}
                  className="py-2.5 border-2 border-gray-300 text-gray-700 rounded-lg font-medium text-sm"
                >
                  Cancel
                </button>
                <button
                  onClick={handleAddCaretaker}
                  disabled={!caretakerForm.name || !caretakerForm.email || Boolean(getPasswordValidationError(caretakerForm.password)) || caretakerSubmitting}
                  className="py-2.5 bg-green-500 text-white rounded-lg font-medium text-sm disabled:opacity-50 flex items-center justify-center gap-1"
                >
                  {caretakerSubmitting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Creating...
                    </>
                  ) : (
                    'Add Caretaker'
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showAddSystem && (
        <div className="care-modal-overlay fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50">
          <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md">
            <div className="bg-purple-500 text-white px-4 py-3 flex items-center justify-between rounded-t-2xl">
              <h3 className="font-semibold text-base">Add System Component</h3>
              <button onClick={() => setShowAddSystem(false)} className="p-1">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 space-y-3">
              <input
                type="text"
                placeholder="System Name"
                value={systemForm.name}
                onChange={(e) => setSystemForm({ ...systemForm, name: e.target.value })}
                className="w-full px-3 py-2 text-sm border rounded-lg"
              />
              <input
                type="text"
                placeholder="Version (e.g., 1.0.0)"
                value={systemForm.version}
                onChange={(e) => setSystemForm({ ...systemForm, version: e.target.value })}
                className="w-full px-3 py-2 text-sm border rounded-lg"
              />
              <textarea
                placeholder="Description"
                value={systemForm.description}
                onChange={(e) => setSystemForm({ ...systemForm, description: e.target.value })}
                className="w-full px-3 py-2 text-sm border rounded-lg resize-none"
                rows={3}
              />
              <select
                value={systemForm.status}
                onChange={(e) => setSystemForm({ ...systemForm, status: e.target.value as SystemStatus })}
                className="w-full px-3 py-2 text-sm border rounded-lg"
              >
                <option value="online">Online</option>
                <option value="offline">Offline</option>
                <option value="maintenance">Maintenance</option>
              </select>
              <div className="grid grid-cols-2 gap-2 pt-2">
                <button
                  onClick={() => setShowAddSystem(false)}
                  className="py-2.5 border-2 border-gray-300 text-gray-700 rounded-lg font-medium text-sm"
                >
                  Cancel
                </button>
                <button
                  onClick={handleAddSystem}
                  disabled={pendingAction !== null || !systemForm.name || !systemForm.version}
                  className="py-2.5 bg-purple-500 text-white rounded-lg font-medium text-sm disabled:opacity-50"
                >
                  Add System
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
