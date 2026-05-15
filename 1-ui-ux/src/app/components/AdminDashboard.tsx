import { useState, useEffect } from 'react';
import { Dashboard } from '../models/Dashboard';
import { User } from '../models/User';
import { Resident, PersonalDetails } from '../models/Resident';
import { Caretaker } from '../models/Caretaker';
import { SystemComponent, SystemStatus } from '../models/SystemComponent';
import { createCaretakerAccount } from '../services/firebaseAuthService';
import { caretakersApi, doctorsApi, sosApi, complaintsApi } from '../services/apiService';
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
  Stethoscope,
  Pencil,
  MessageSquare,
  Send,
  CheckCircle,
  Eye
} from 'lucide-react';

interface AdminDashboardProps {
  user: User;
  dashboard: Dashboard;
  onLogout: () => void;
  onRefresh: () => void;
}

export function AdminDashboard({ user, dashboard, onLogout, onRefresh }: AdminDashboardProps) {
  const [activeView, setActiveView] = useState<'overview' | 'residents' | 'caretakers' | 'leave' | 'systems' | 'doctors' | 'complaints'>('overview');
  const [showAddResident, setShowAddResident] = useState(false);
  const [showAddCaretaker, setShowAddCaretaker] = useState(false);
  const [showAddSystem, setShowAddSystem] = useState(false);
  const [showAddDoctor, setShowAddDoctor] = useState(false);
  const [selectedLeaveRequest, setSelectedLeaveRequest] = useState<any>(null);
  const [doctors, setDoctors] = useState<any[]>([]);
  const [doctorForm, setDoctorForm] = useState({ name: '', specialization: '', phone: '', email: '', hospital: '' });
  const [editingDoctorId, setEditingDoctorId] = useState<number | null>(null);
  const [sosAlerts, setSosAlerts] = useState<any[]>([]);
  const [complaints, setComplaints] = useState<any[]>([]);
  const [respondingTo, setRespondingTo] = useState<number | null>(null);
  const [responseText, setResponseText] = useState('');

  const emergencyAlerts = dashboard.getActiveEmergencyAlerts();
  const criticalAlerts = dashboard.getCriticalAlerts();
  const pendingLeaveRequests = dashboard.getPendingLeaveRequests();
  const avgWellness = Math.round(
    dashboard.residents.reduce((sum, r) => {
      const latest = r.getLatestEmotionalState();
      return sum + (latest?.stateScore || 0);
    }, 0) / (dashboard.residents.length || 1)
  );

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

  // Fetch doctors on mount
  useEffect(() => {
    doctorsApi.getAll().then(setDoctors).catch(() => {});
  }, []);

  // Poll SOS alerts every 10 seconds
  useEffect(() => {
    const fetchSOS = () => sosApi.getActive().then(setSosAlerts).catch(() => {});
    fetchSOS();
    const interval = setInterval(fetchSOS, 10000);
    return () => clearInterval(interval);
  }, []);

  // Fetch complaints
  useEffect(() => {
    complaintsApi.getAll().then(setComplaints).catch(() => {});
  }, []);

  const handleResolveSOS = async (alertId: number) => {
    try {
      await sosApi.resolve(alertId, user.name);
      setSosAlerts(prev => prev.filter(a => a.id !== alertId));
    } catch (err) {
      alert('Failed to resolve SOS alert.');
    }
  };

  const handleRespondComplaint = async (complaintId: number) => {
    if (!responseText.trim()) return;
    try {
      await complaintsApi.respond(complaintId, {
        status: 'reviewed',
        adminResponse: responseText.trim(),
        respondedBy: user.name,
      });
      const updated = await complaintsApi.getAll();
      setComplaints(updated);
      setRespondingTo(null);
      setResponseText('');
    } catch (err) {
      alert('Failed to respond to complaint.');
    }
  };

  const handleResolveComplaint = async (complaintId: number) => {
    try {
      await complaintsApi.respond(complaintId, {
        status: 'resolved',
        respondedBy: user.name,
      });
      const updated = await complaintsApi.getAll();
      setComplaints(updated);
    } catch (err) {
      alert('Failed to resolve complaint.');
    }
  };

  const handleAddDoctor = async () => {
    if (!doctorForm.name) return;
    try {
      if (editingDoctorId) {
        await doctorsApi.update(editingDoctorId, doctorForm);
      } else {
        await doctorsApi.create(doctorForm);
      }
      const updated = await doctorsApi.getAll();
      setDoctors(updated);
      setDoctorForm({ name: '', specialization: '', phone: '', email: '', hospital: '' });
      setEditingDoctorId(null);
      setShowAddDoctor(false);
    } catch (err) {
      alert('Failed to save doctor.');
    }
  };

  const openEditDoctor = (doc: any) => {
    setDoctorForm({
      name: doc.name || '',
      specialization: doc.specialization || '',
      phone: doc.phone || '',
      email: doc.email || '',
      hospital: doc.hospital || '',
    });
    setEditingDoctorId(doc.doctor_id);
    setShowAddDoctor(true);
  };

  const openAddDoctor = () => {
    setDoctorForm({ name: '', specialization: '', phone: '', email: '', hospital: '' });
    setEditingDoctorId(null);
    setShowAddDoctor(true);
  };

  const handleRemoveDoctor = async (id: number) => {
    if (!confirm('Remove this doctor?')) return;
    try {
      await doctorsApi.delete(id);
      setDoctors(prev => prev.filter(d => d.doctor_id !== id));
    } catch (err) {
      alert('Failed to remove doctor.');
    }
  };

  const handleAddResident = () => {
    const resident = new Resident(
      `R${Date.now()}`,
      residentForm.name,
      parseInt(residentForm.age)
    );
    
    const details: PersonalDetails = {
      roomNumber: residentForm.roomNumber,
      floorNumber: residentForm.floorNumber,
      address: residentForm.address,
      city: residentForm.city,
      state: residentForm.state,
      zipCode: residentForm.zipCode,
      emergencyContactName: residentForm.emergencyContactName,
      emergencyContactPhone: residentForm.emergencyContactPhone,
      emergencyContactRelation: residentForm.emergencyContactRelation,
      admissionDate: new Date()
    };
    
    resident.updatePersonalDetails(details);
    dashboard.addResident(resident);
    setShowAddResident(false);
    setResidentForm({
      name: '', age: '', roomNumber: '', floorNumber: '', address: '', city: '',
      state: '', zipCode: '', emergencyContactName: '', emergencyContactPhone: '',
      emergencyContactRelation: ''
    });
    onRefresh();
  };

  const handleRemoveResident = (residentId: string) => {
    if (confirm('Are you sure you want to remove this resident?')) {
      dashboard.removeResident(residentId);
      onRefresh();
    }
  };

  const closeCaretakerModal = () => {
    setShowAddCaretaker(false);
    setCaretakerForm({ name: '', email: '', password: '', phone: '', specialization: '' });
    setCaretakerFormError('');
    setCaretakerSubmitting(false);
  };

  const handleAddCaretaker = async () => {
    setCaretakerFormError('');

    if (caretakerForm.password.length < 6) {
      setCaretakerFormError('Password must be at least 6 characters.');
      return;
    }

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
      setCaretakerSubmitting(false);
    }
  };

  const openCaretakerModal = () => {
    setCaretakerFormError('');
    setCaretakerSubmitting(false);
    setShowAddCaretaker(true);
  };

  const handleRemoveCaretaker = (caretakerId: string) => {
    if (confirm('Are you sure you want to remove this caretaker?')) {
      dashboard.removeCaretaker(caretakerId);
      onRefresh();
    }
  };

  const handleAddSystem = () => {
    const system = new SystemComponent(
      `SYS-${Date.now()}`,
      systemForm.name,
      systemForm.version,
      systemForm.description,
      systemForm.status
    );
    dashboard.addSystemComponent(system);
    setShowAddSystem(false);
    setSystemForm({ name: '', version: '', description: '', status: 'online' });
    onRefresh();
  };

  const handleToggleSystemStatus = (componentId: string, currentStatus: SystemStatus) => {
    const component = dashboard.getSystemComponent(componentId);
    if (component) {
      const newStatus: SystemStatus = 
        currentStatus === 'online' ? 'offline' : 
        currentStatus === 'offline' ? 'maintenance' : 'online';
      component.setStatus(newStatus);
      onRefresh();
    }
  };

  const handleRemoveSystem = (componentId: string) => {
    if (confirm('Remove this system component?')) {
      dashboard.removeSystemComponent(componentId);
      onRefresh();
    }
  };

  const handleApproveLeave = async (request: any) => {
    const caretaker = dashboard.getCaretaker(request.caretakerId);
    if (caretaker) {
      try {
        await caretakersApi.updateLeaveRequest(request.caretakerId, request.requestId, {
           status: 'approved',
           reviewedBy: user.name,
           temporaryReplacement: replacementCaretaker || undefined
        });
        request.approve(user.name, replacementCaretaker || undefined);
        setSelectedLeaveRequest(null);
        setReplacementCaretaker('');
        onRefresh();
      } catch (error) {
        console.error('Failed to approve leave request:', error);
        alert('Failed to approve leave request. Please try again.');
      }
    }
  };

  const handleRejectLeave = async (request: any) => {
    try {
      await caretakersApi.updateLeaveRequest(request.caretakerId, request.requestId, {
         status: 'rejected',
         reviewedBy: user.name
      });
      request.reject(user.name);
      setSelectedLeaveRequest(null);
      onRefresh();
    } catch (error) {
      console.error('Failed to reject leave request:', error);
      alert('Failed to reject leave request. Please try again.');
    }
  };

  const handleAcknowledgeEmergency = (alertId: string) => {
    const alert = dashboard.emergencyAlerts.find(a => a.alertId === alertId);
    if (alert) {
      alert.acknowledge(user.name);
      onRefresh();
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 via-blue-50 to-pink-50 pb-20">
      {/* Header */}
      <div className="bg-white shadow-sm border-b border-gray-200 sticky top-0 z-10">
        <div className="px-3 py-2.5">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <div className="w-9 h-9 rounded-full bg-gradient-to-br from-purple-400 to-pink-400 flex items-center justify-center text-white">
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
      <div className="px-3 py-3">
        {/* SOS Emergency Banner — always visible when active */}
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
                      <p className="text-red-100 text-sm font-semibold">{alert.resident_name || 'Unknown Patient'} — {alert.message}</p>
                      <p className="text-red-200 text-xs mt-0.5">{new Date(alert.created_at).toLocaleString()}</p>
                    </div>
                  </div>
                  <button
                    onClick={() => handleResolveSOS(alert.id)}
                    className="bg-white text-red-600 font-bold text-sm px-4 py-2 rounded-lg hover:bg-red-50 transition-colors shadow-md"
                  >
                    Resolve
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
                <Users className="w-6 h-6 text-blue-500 mb-1" />
                <p className="text-xl font-bold text-gray-800">{dashboard.residents.length}</p>
                <p className="text-xs text-gray-600">Residents</p>
              </div>

              <div className="bg-white rounded-lg p-3 shadow-sm border border-gray-200">
                <Users className="w-6 h-6 text-green-500 mb-1" />
                <p className="text-xl font-bold text-gray-800">{dashboard.caretakers.length}</p>
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
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => setShowAddResident(true)}
                  className="py-2 bg-blue-50 text-blue-700 rounded-lg text-xs font-medium active:scale-95 transition-transform flex items-center justify-center gap-1"
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
                  className="text-xs text-blue-600"
                >
                  View All
                </button>
              </div>
              <div className="space-y-1.5">
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
                className="px-3 py-1.5 bg-blue-500 text-white rounded-lg text-xs font-medium active:scale-95 transition-transform"
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
                          onChange={async (e) => {
                            const newCaretakerId = e.target.value;
                            if (!newCaretakerId) return;
                            try {
                              await caretakersApi.reassignResident({
                                residentId: resident.residentId,
                                fromCaretakerId: primaryCaretaker?.caretakerId,
                                toCaretakerId: newCaretakerId,
                              });
                              // Update local state
                              if (primaryCaretaker) {
                                primaryCaretaker.assignedResidents = primaryCaretaker.assignedResidents.filter(
                                  (id: string) => id !== resident.residentId
                                );
                              }
                              const newCaretaker = dashboard.getCaretaker(newCaretakerId);
                              if (newCaretaker && !newCaretaker.assignedResidents.includes(resident.residentId)) {
                                newCaretaker.assignedResidents.push(resident.residentId);
                              }
                              onRefresh();
                            } catch (err) {
                              alert('Failed to reassign caretaker. Please try again.');
                            }
                          }}
                          className="text-xs border border-teal-300 rounded-lg px-2 py-1 bg-white text-teal-900 font-medium cursor-pointer focus:ring-2 focus:ring-teal-400 focus:outline-none"
                        >
                          <option value="">Select...</option>
                          {dashboard.caretakers.map(c => (
                            <option key={c.caretakerId} value={c.caretakerId}>
                              {c.name} ({c.specialization || 'General'})
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-2 text-xs">
                      <div className="bg-blue-50 rounded p-1.5 text-center">
                        <p className="text-blue-900 font-bold">{resident.getAllMedications().length}</p>
                        <p className="text-blue-700">Meds</p>
                      </div>
                      <div className="bg-purple-50 rounded p-1.5 text-center">
                        <p className="text-purple-900 font-bold">{resident.prescriptions.length}</p>
                        <p className="text-purple-700">Rx</p>
                      </div>
                      <div className="bg-green-50 rounded p-1.5 text-center">
                        <p className="text-green-900 font-bold">{resident.getLatestEmotionalState()?.stateScore || '--'}</p>
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
                                <option key={c.caretakerId} value={c.name}>{c.name}</option>
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
                            onClick={() => handleRejectLeave(request)}
                            className="py-1.5 bg-red-500 text-white rounded text-xs font-medium"
                          >
                            Reject
                          </button>
                          <button
                            onClick={() => handleApproveLeave(request)}
                            className="py-1.5 bg-green-500 text-white rounded text-xs font-medium"
                          >
                            Approve
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        onClick={() => setSelectedLeaveRequest(request)}
                        className="w-full py-2 bg-blue-500 text-white rounded-lg text-xs font-medium mt-2"
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

        {activeView === 'doctors' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-gray-800">Doctors</h2>
              <button
                onClick={openAddDoctor}
                className="px-3 py-1.5 bg-teal-500 text-white rounded-lg text-xs font-medium active:scale-95 transition-transform"
              >
                <Plus className="w-3 h-3 inline mr-1" />
                Add
              </button>
            </div>

            {doctors.length === 0 ? (
              <div className="bg-white rounded-lg p-8 text-center">
                <Stethoscope className="w-10 h-10 text-gray-300 mx-auto mb-3" />
                <p className="text-sm text-gray-500">No doctors registered yet.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {doctors.map(doc => (
                  <div key={doc.doctor_id} className="bg-white rounded-lg p-3 shadow-sm border border-gray-200">
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-teal-100 flex items-center justify-center flex-shrink-0">
                          <Stethoscope className="w-5 h-5 text-teal-600" />
                        </div>
                        <div>
                          <h3 className="font-semibold text-gray-800 text-sm">Dr. {doc.name}</h3>
                          <p className="text-xs text-gray-500">{doc.specialization || 'General'}</p>
                        </div>
                      </div>
                      <div className="flex gap-1">
                        <button
                          onClick={() => openEditDoctor(doc)}
                          className="p-1.5 text-teal-600 hover:bg-teal-50 rounded"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleRemoveDoctor(doc.doctor_id)}
                          className="p-1.5 text-red-600 hover:bg-red-50 rounded"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-xs">
                      {doc.hospital && (
                        <div className="bg-blue-50 rounded p-1.5 col-span-3">
                          <p className="text-blue-800">🏥 {doc.hospital}</p>
                        </div>
                      )}
                      {doc.phone && (
                        <div className="bg-green-50 rounded p-1.5">
                          <p className="text-green-800">📞 {doc.phone}</p>
                        </div>
                      )}
                      {doc.email && (
                        <div className="bg-purple-50 rounded p-1.5 col-span-2">
                          <p className="text-purple-800 truncate">✉️ {doc.email}</p>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeView === 'complaints' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-gray-800">Patient Complaints</h2>
              <span className="bg-red-100 text-red-700 text-xs font-bold px-2 py-0.5 rounded-full">
                {complaints.filter(c => c.status === 'pending').length} pending
              </span>
            </div>

            {complaints.length === 0 ? (
              <div className="bg-white rounded-lg p-8 text-center shadow-sm border border-gray-200">
                <MessageSquare className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                <p className="text-gray-500 text-sm">No complaints received yet.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {complaints.map(c => (
                  <div key={c.id} className={`bg-white rounded-lg p-3 shadow-sm border ${
                    c.status === 'pending' ? 'border-yellow-300' :
                    c.status === 'reviewed' ? 'border-blue-200' :
                    'border-green-200'
                  }`}>
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <h3 className="font-semibold text-gray-800 text-sm">{c.subject}</h3>
                        <p className="text-xs text-gray-500">
                          {c.resident_name || 'Unknown Patient'} • {new Date(c.created_at).toLocaleDateString()}
                        </p>
                      </div>
                      <span className={`text-[10px] font-bold px-2 py-1 rounded-full ${
                        c.status === 'resolved' ? 'bg-green-100 text-green-700' :
                        c.status === 'reviewed' ? 'bg-blue-100 text-blue-700' :
                        'bg-yellow-100 text-yellow-700'
                      }`}>
                        {c.status?.toUpperCase()}
                      </span>
                    </div>

                    <p className="text-sm text-gray-600 mb-3">{c.message}</p>

                    {c.admin_response && (
                      <div className="bg-purple-50 rounded-lg p-2 mb-3 border border-purple-100">
                        <p className="text-xs font-semibold text-purple-700 mb-1">Your Response:</p>
                        <p className="text-xs text-purple-900">{c.admin_response}</p>
                        {c.responded_by && <p className="text-[10px] text-purple-500 mt-1 italic">— {c.responded_by}</p>}
                      </div>
                    )}

                    {respondingTo === c.id ? (
                      <div className="space-y-2">
                        <textarea
                          placeholder="Write your response..."
                          value={responseText}
                          onChange={e => setResponseText(e.target.value)}
                          className="w-full px-3 py-2 text-sm border rounded-lg resize-none"
                          rows={3}
                        />
                        <div className="flex gap-2">
                          <button
                            onClick={() => { setRespondingTo(null); setResponseText(''); }}
                            className="flex-1 py-2 border border-gray-300 text-gray-600 rounded-lg text-xs font-medium"
                          >
                            Cancel
                          </button>
                          <button
                            onClick={() => handleRespondComplaint(c.id)}
                            disabled={!responseText.trim()}
                            className="flex-1 py-2 bg-purple-500 text-white rounded-lg text-xs font-medium disabled:opacity-50 flex items-center justify-center gap-1"
                          >
                            <Send className="w-3 h-3" /> Send
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex gap-2">
                        {c.status !== 'resolved' && (
                          <>
                            <button
                              onClick={() => { setRespondingTo(c.id); setResponseText(c.admin_response || ''); }}
                              className="flex-1 py-2 bg-blue-50 text-blue-700 rounded-lg text-xs font-medium flex items-center justify-center gap-1"
                            >
                              <Eye className="w-3 h-3" /> {c.admin_response ? 'Edit Response' : 'Respond'}
                            </button>
                            <button
                              onClick={() => handleResolveComplaint(c.id)}
                              className="flex-1 py-2 bg-green-50 text-green-700 rounded-lg text-xs font-medium flex items-center justify-center gap-1"
                            >
                              <CheckCircle className="w-3 h-3" /> Resolve
                            </button>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Bottom Navigation */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 shadow-lg">
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
            <button
              onClick={() => setActiveView('doctors')}
              className={`flex flex-col items-center gap-0.5 py-1.5 px-2 rounded-lg transition-colors min-w-0 ${
                activeView === 'doctors' ? 'text-teal-600 bg-teal-50' : 'text-gray-500'
              }`}
            >
              <Stethoscope className="w-5 h-5" />
              <span className="text-xs">Doctors</span>
            </button>
            <button
              onClick={() => setActiveView('complaints')}
              className={`flex flex-col items-center gap-0.5 py-1.5 px-2 rounded-lg transition-colors min-w-0 relative ${
                activeView === 'complaints' ? 'text-red-600 bg-red-50' : 'text-gray-500'
              }`}
            >
              <MessageSquare className="w-5 h-5" />
              <span className="text-xs">Complaints</span>
              {complaints.filter(c => c.status === 'pending').length > 0 && (
                <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-red-500 text-white text-xs rounded-full flex items-center justify-center font-bold">
                  {complaints.filter(c => c.status === 'pending').length}
                </span>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Modals */}
      {showAddResident && (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50">
          <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-blue-500 text-white px-4 py-3 flex items-center justify-between rounded-t-2xl">
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
                  disabled={!residentForm.name || !residentForm.age}
                  className="py-2.5 bg-blue-500 text-white rounded-lg font-medium text-sm disabled:opacity-50"
                >
                  Add Resident
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showAddCaretaker && (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50">
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
              <input
                type="password"
                placeholder="Temporary Password (min 6 chars)"
                value={caretakerForm.password}
                onChange={(e) => setCaretakerForm({ ...caretakerForm, password: e.target.value })}
                className="w-full px-3 py-2 text-sm border rounded-lg"
                disabled={caretakerSubmitting}
              />
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
                  disabled={!caretakerForm.name || !caretakerForm.email || caretakerForm.password.length < 6 || caretakerSubmitting}
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
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50">
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
                  disabled={!systemForm.name || !systemForm.version}
                  className="py-2.5 bg-purple-500 text-white rounded-lg font-medium text-sm disabled:opacity-50"
                >
                  Add System
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showAddDoctor && (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50">
          <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md">
            <div className="bg-teal-500 text-white px-4 py-3 flex items-center justify-between rounded-t-2xl">
              <h3 className="font-semibold text-base">{editingDoctorId ? 'Edit Doctor' : 'Register Doctor'}</h3>
              <button onClick={() => { setShowAddDoctor(false); setEditingDoctorId(null); }} className="p-1">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 space-y-3">
              <input type="text" placeholder="Doctor Name *" value={doctorForm.name} onChange={e => setDoctorForm({...doctorForm, name: e.target.value})} className="w-full px-3 py-2 text-sm border rounded-lg" />
              <input type="text" placeholder="Specialization" value={doctorForm.specialization} onChange={e => setDoctorForm({...doctorForm, specialization: e.target.value})} className="w-full px-3 py-2 text-sm border rounded-lg" />
              <input type="text" placeholder="Hospital / Clinic" value={doctorForm.hospital} onChange={e => setDoctorForm({...doctorForm, hospital: e.target.value})} className="w-full px-3 py-2 text-sm border rounded-lg" />
              <div className="grid grid-cols-2 gap-2">
                <input type="tel" placeholder="Phone" value={doctorForm.phone} onChange={e => setDoctorForm({...doctorForm, phone: e.target.value})} className="w-full px-3 py-2 text-sm border rounded-lg" />
                <input type="email" placeholder="Email" value={doctorForm.email} onChange={e => setDoctorForm({...doctorForm, email: e.target.value})} className="w-full px-3 py-2 text-sm border rounded-lg" />
              </div>
              <div className="grid grid-cols-2 gap-2 pt-2">
                <button onClick={() => { setShowAddDoctor(false); setEditingDoctorId(null); }} className="py-2.5 border-2 border-gray-300 text-gray-700 rounded-lg font-medium text-sm">Cancel</button>
                <button onClick={handleAddDoctor} disabled={!doctorForm.name} className="py-2.5 bg-teal-500 text-white rounded-lg font-medium text-sm disabled:opacity-50">
                  {editingDoctorId ? 'Save Changes' : 'Register Doctor'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
