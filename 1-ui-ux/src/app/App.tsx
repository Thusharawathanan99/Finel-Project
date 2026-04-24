import { useState, useEffect, useRef } from 'react';
import { Dashboard } from './models/Dashboard';
import { Resident } from './models/Resident';
import { Prescription } from './models/Prescription';
import { Medication } from './models/Medication';
import { EmotionalState } from './models/EmotionalState';
import { Caretaker, LeaveRequest } from './models/Caretaker';
import { SystemComponent } from './models/SystemComponent';
import { User } from './models/User';
import { WelcomeScreen } from './components/WelcomeScreen';
import { SignInSignUp } from './components/SignInSignUp';
import { PatientDashboard } from './components/PatientDashboard';
import { CaretakerDashboard } from './components/CaretakerDashboard';
import { AdminDashboard } from './components/AdminDashboard';
import { onAuthStateChange, fetchUserProfile, signOut } from './services/firebaseAuthService';
import { residentsApi, caretakersApi, systemApi } from './services/apiService';

/**
 * Load dashboard data from MySQL API.
 * Falls back to empty dashboard if API is unavailable.
 */
const loadDashboardFromAPI = async (dashboard: Dashboard): Promise<void> => {
  try {
    // Load residents with prescriptions and emotional states
    const residentsData = await residentsApi.getAll();
    for (const r of residentsData) {
      // Fetch full resident details (with prescriptions + emotions)
      try {
        const fullResident = await residentsApi.getById(r.resident_id);
        const resident = new Resident(fullResident.resident_id, fullResident.name, fullResident.age || 0);

        // Map personal details
        resident.updatePersonalDetails({
          dateOfBirth: fullResident.date_of_birth ? new Date(fullResident.date_of_birth) : undefined,
          address: fullResident.address || undefined,
          city: fullResident.city || undefined,
          state: fullResident.state || undefined,
          zipCode: fullResident.zip_code || undefined,
          emergencyContactName: fullResident.emergency_contact_name || undefined,
          emergencyContactPhone: fullResident.emergency_contact_phone || undefined,
          emergencyContactRelation: fullResident.emergency_contact_relation || undefined,
          children: fullResident.children ? (typeof fullResident.children === 'string' ? JSON.parse(fullResident.children) : fullResident.children) : undefined,
          roomNumber: fullResident.room_number || undefined,
          floorNumber: fullResident.floor_number || undefined,
          admissionDate: fullResident.admission_date ? new Date(fullResident.admission_date) : undefined,
          medicalHistory: fullResident.medical_history || undefined,
          allergies: fullResident.allergies ? (typeof fullResident.allergies === 'string' ? JSON.parse(fullResident.allergies) : fullResident.allergies) : undefined,
          dietaryRestrictions: fullResident.dietary_restrictions ? (typeof fullResident.dietary_restrictions === 'string' ? JSON.parse(fullResident.dietary_restrictions) : fullResident.dietary_restrictions) : undefined,
        });

        // Map prescriptions
        if (fullResident.prescriptions) {
          for (const rx of fullResident.prescriptions) {
            const prescription = new Prescription(
              rx.prescription_id,
              new Date(rx.date_issued),
              rx.doctor_name || ''
            );
            if (rx.medications) {
              for (const med of rx.medications) {
                prescription.addMedication(new Medication(med.drug_name, med.dosage || '', med.frequency || '', med.id));
              }
            }
            resident.addPrescription(prescription);
          }
        }

        // Map emotional states
        if (fullResident.emotionalStates) {
          for (const es of fullResident.emotionalStates) {
            resident.addEmotionalState(new EmotionalState(
              new Date(es.recorded_at),
              es.state_score
            ));
          }
        }

        // Map finished medications history
        if (fullResident.finishedMedications) {
          resident.finishedMedications = fullResident.finishedMedications.map((fm: any) => ({
            id: fm.id,
            residentId: fm.resident_id,
            prescriptionId: fm.prescription_id,
            drugName: fm.drug_name,
            dosage: fm.dosage || '',
            frequency: fm.frequency || '',
            finishedAt: new Date(fm.finished_at),
          }));
        }

        dashboard.addResident(resident);
      } catch (err) {
        console.warn(`[App] Failed to load resident ${r.resident_id}:`, err);
      }
    }

    // Load caretakers
    const caretakersData = await caretakersApi.getAll();
    for (const c of caretakersData) {
      const caretaker = new Caretaker(
        c.caretaker_id,
        c.name,
        c.email || '',
        c.phone || '',
        c.specialization || ''
      );
      // Map assigned residents
      if (c.assigned_residents) {
        const residents = typeof c.assigned_residents === 'string'
          ? JSON.parse(c.assigned_residents)
          : c.assigned_residents;
        if (Array.isArray(residents)) {
          caretaker.assignedResidents = residents.filter(Boolean);
        }
      }
      dashboard.addCaretaker(caretaker);
    }

    try {
      // Load all leave requests globally
      const allLeaveRequests = await caretakersApi.getAllLeaveRequests();
      for (const req of allLeaveRequests) {
        const caretaker = dashboard.getCaretaker(req.caretaker_id);
        if (caretaker) {
          // Avoid duplicate requests during re-renders/HMR
          if (!caretaker.leaveRequests.some((lr: any) => lr.requestId === req.request_id)) {
            const leaveReq = new LeaveRequest(
              req.request_id,
              req.caretaker_id,
              req.caretaker_name || caretaker.name,
              new Date(req.start_date),
              new Date(req.end_date),
              req.reason || ''
            );
            
            // Map the remaining properties from the database since the constructor defaults to 'pending'
            leaveReq.status = req.status as 'pending' | 'approved' | 'rejected';
            leaveReq.requestDate = new Date(req.request_date);
            leaveReq.reviewedBy = req.reviewed_by || undefined;
            leaveReq.reviewDate = req.review_date ? new Date(req.review_date) : undefined;
            leaveReq.temporaryReplacement = req.temporary_replacement || undefined;

            caretaker.addLeaveRequest(leaveReq);
          }
        }
      }
    } catch (err) {
      console.warn('[App] Failed to load global leave requests:', err);
    }

    // Load system components
    const componentsData = await systemApi.getComponents();
    for (const comp of componentsData) {
      dashboard.addSystemComponent(new SystemComponent(
        comp.component_id,
        comp.name,
        comp.version || '',
        comp.description || '',
        comp.status || 'online'
      ));
    }

    // Generate alerts based on loaded data
    dashboard.refreshAlerts();

    console.log(`✅ Dashboard loaded from API: ${dashboard.residents.length} residents, ${dashboard.caretakers.length} caretakers`);
  } catch (err) {
    console.warn('[App] API unavailable, using empty dashboard. Error:', err);
  }
};

/**
 * Initialize dashboard with hardcoded sample data (fallback for demo mode).
 */
const initializeDemoData = (dashboard: Dashboard): void => {
  // Add system components
  dashboard.addSystemComponent(new SystemComponent('SYS-001', 'OCR Engine', '2.5.1', 'Optical Character Recognition for prescription scanning', 'online'));
  dashboard.addSystemComponent(new SystemComponent('SYS-002', 'NLP Engine', '3.1.0', 'Natural Language Processing for medication extraction', 'online'));
  dashboard.addSystemComponent(new SystemComponent('SYS-003', 'Emotion AI', '1.8.2', 'Facial and vocal emotion analysis system', 'online'));

  // Create sample caretakers
  const caretaker1 = new Caretaker('CT001', 'Sarah Johnson', 'sarah.j@care.com', '555-0101', 'General Care');
  const caretaker2 = new Caretaker('CT002', 'Michael Davis', 'michael.d@care.com', '555-0102', 'Senior Care');
  const caretaker3 = new Caretaker('CT003', 'Jennifer Lee', 'jennifer.l@care.com', '555-0103', 'Medical Specialist');
  
  dashboard.addCaretaker(caretaker1);
  dashboard.addCaretaker(caretaker2);
  dashboard.addCaretaker(caretaker3);

  // Create sample residents
  const resident1 = new Resident('R001', 'Margaret Thompson', 78);
  resident1.updatePersonalDetails({
    dateOfBirth: new Date('1946-03-15'),
    address: '123 Oak Street', city: 'Springfield', state: 'IL', zipCode: '62701',
    emergencyContactName: 'David Thompson', emergencyContactPhone: '555-1234', emergencyContactRelation: 'Son',
    children: ['David Thompson', 'Susan Miller'], roomNumber: '201', floorNumber: '2',
    admissionDate: new Date('2023-01-15'), allergies: ['Penicillin']
  });

  const resident2 = new Resident('R002', 'Robert Chen', 82);
  resident2.updatePersonalDetails({
    dateOfBirth: new Date('1942-08-22'),
    address: '456 Elm Avenue', city: 'Springfield', state: 'IL', zipCode: '62702',
    emergencyContactName: 'Lisa Chen', emergencyContactPhone: '555-5678', emergencyContactRelation: 'Daughter',
    children: ['Lisa Chen', 'Michael Chen'], roomNumber: '305', floorNumber: '3',
    admissionDate: new Date('2023-03-20'), allergies: ['Sulfa drugs']
  });

  const resident3 = new Resident('R003', 'Elizabeth Rodriguez', 75);
  resident3.updatePersonalDetails({
    dateOfBirth: new Date('1949-11-30'),
    address: '789 Pine Road', city: 'Springfield', state: 'IL', zipCode: '62703',
    emergencyContactName: 'Carlos Rodriguez', emergencyContactPhone: '555-9012', emergencyContactRelation: 'Husband',
    roomNumber: '102', floorNumber: '1', admissionDate: new Date('2023-06-10')
  });

  // Assign residents to caretakers
  caretaker1.assignedResidents.push('R001');
  caretaker2.assignedResidents.push('R002', 'R003');

  // Add prescriptions
  const prescription1 = new Prescription('RX-001', new Date('2024-12-01'), 'Sarah Johnson');
  prescription1.addMedication(new Medication('Lisinopril', '10mg', 'once daily'));
  prescription1.addMedication(new Medication('Metformin', '500mg', 'twice daily'));
  resident1.addPrescription(prescription1);

  const prescription2 = new Prescription('RX-002', new Date('2024-12-10'), 'Michael Davis');
  prescription2.addMedication(new Medication('Atorvastatin', '20mg', 'once daily at bedtime'));
  resident1.addPrescription(prescription2);

  const prescription3 = new Prescription('RX-003', new Date('2024-12-05'), 'Sarah Johnson');
  prescription3.addMedication(new Medication('Aspirin', '81mg', 'once daily'));
  prescription3.addMedication(new Medication('Warfarin', '5mg', 'once daily'));
  prescription3.addMedication(new Medication('Furosemide', '40mg', 'twice daily'));
  prescription3.addMedication(new Medication('Metoprolol', '50mg', 'twice daily'));
  prescription3.addMedication(new Medication('Losartan', '100mg', 'once daily'));
  resident2.addPrescription(prescription3);

  const prescription4 = new Prescription('RX-004', new Date('2024-12-08'), 'Jennifer Lee');
  prescription4.addMedication(new Medication('Levothyroxine', '75mcg', 'once daily in morning'));
  prescription4.addMedication(new Medication('Calcium', '600mg', 'twice daily with meals'));
  resident3.addPrescription(prescription4);

  // Add emotional states
  const now = new Date();
  [68, 72, 74, 78, 80, 82, 85].forEach((score, i) => {
    resident1.addEmotionalState(new EmotionalState(new Date(now.getTime() - 3600000 * (6 - i)), score));
  });
  [48, 45, 42, 38, 35, 32, 30].forEach((score, i) => {
    resident2.addEmotionalState(new EmotionalState(new Date(now.getTime() - 3600000 * (6 - i)), score));
  });
  [55, 58, 62, 65, 68, 70, 72].forEach((score, i) => {
    resident3.addEmotionalState(new EmotionalState(new Date(now.getTime() - 3600000 * (6 - i)), score));
  });

  dashboard.addResident(resident1);
  dashboard.addResident(resident2);
  dashboard.addResident(resident3);

  dashboard.refreshAlerts();
};

export default function App() {
  const [dashboard] = useState<Dashboard>(() => new Dashboard());
  const [currentScreen, setCurrentScreen] = useState<'welcome' | 'auth' | 'app' | 'loading'>('loading');
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  // useRef for synchronous flags — useState is async and causes race conditions
  // with Firebase's onAuthStateChanged which fires immediately during signup
  const authInProgressRef = useRef(false);
  const dataLoadedRef = useRef(false);
  const dataLoadInProgressRef = useRef(false);
  const currentScreenRef = useRef(currentScreen);

  useEffect(() => {
    currentScreenRef.current = currentScreen;
  }, [currentScreen]);

  /** Clear all dashboard arrays to prevent duplicate accumulation */
  const clearDashboard = () => {
    dashboard.residents = [];
    dashboard.caretakers = [];
    dashboard.alerts = [];
    dashboard.systemComponents = [];
    dashboard.appointments = [];
    dashboard.emergencyAlerts = [];
  };

  // Listen for Firebase auth state changes (handles page reload / returning users only)
  useEffect(() => {
    const unsubscribe = onAuthStateChange(async (firebaseUser) => {
      // Skip if a signup/signin is actively being handled by handleAuthComplete
      if (authInProgressRef.current) return;
      // While user is on the auth screen, let SignInSignUp own the flow.
      if (currentScreenRef.current === 'auth') return;
      // Skip if data is already loaded (prevents duplicate loading)
      if (dataLoadedRef.current) return;
      // Skip if another async load is already running.
      if (dataLoadInProgressRef.current) return;

      if (firebaseUser) {
        // Returning user detected (page reload / existing session)
        try {
          setCurrentScreen('loading');
          const appUser = await fetchUserProfile(firebaseUser);

          const user: User = {
            userId: appUser.uid,
            name: appUser.name,
            email: appUser.email,
            role: appUser.role,
            residentId: appUser.residentId,
          };

          // Load dashboard data from API
          if (!dataLoadedRef.current) {
            dataLoadInProgressRef.current = true;
            try {
              clearDashboard();
              await loadDashboardFromAPI(dashboard);
              dataLoadedRef.current = true;
            } finally {
              dataLoadInProgressRef.current = false;
            }
          }

          setCurrentUser(user);
          setCurrentScreen('app');
        } catch (err) {
          console.error('[App] Auth state error:', err);
          setCurrentScreen('auth');
        }
      } else {
        if (currentScreenRef.current === 'loading') {
          setCurrentScreen('auth');
        }
      }
    });

    return () => unsubscribe();
  }, [dashboard]);

  const handleWelcomeContinue = () => {
    setCurrentScreen('auth');
  };

  const handleAuthComplete = async (user: User) => {
    // Set synchronous flag BEFORE anything else — prevents onAuthStateChanged from racing
    authInProgressRef.current = true;
    setCurrentScreen('loading');

    // Load data from API for real users, demo data for demo users
    if (!dataLoadedRef.current) {
      dataLoadInProgressRef.current = true;
      try {
        clearDashboard();
        if (user.userId === 'DEMO') {
          initializeDemoData(dashboard);
        } else {
          await loadDashboardFromAPI(dashboard);
          // If API returned no data, fall back to demo data
          if (dashboard.residents.length === 0) {
            console.log('[App] No data from API, loading demo data');
            initializeDemoData(dashboard);
          }
        }
        dataLoadedRef.current = true;
      } finally {
        dataLoadInProgressRef.current = false;
      }
    }

    setCurrentUser(user);
    setCurrentScreen('app');
    authInProgressRef.current = false;
  };

  const handleLogout = async () => {
    try {
      await signOut();
    } catch (err) {
      console.warn('[App] Sign out error (may be demo user):', err);
    }
    setCurrentUser(null);
    dataLoadedRef.current = false;

    // Clear dashboard data
    dashboard.residents = [];
    dashboard.caretakers = [];
    dashboard.alerts = [];
    dashboard.systemComponents = [];
    dashboard.appointments = [];
    dashboard.emergencyAlerts = [];

    setCurrentScreen('auth');
  };

  const handleRefresh = () => {
    dashboard.refreshAlerts();
    setRefreshKey(prev => prev + 1);
  };

  // Loading screen
  if (currentScreen === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-purple-50">
        <div className="text-center">
          <div className="inline-block w-12 h-12 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin mb-4"></div>
          <p className="text-gray-600 font-medium">Loading your dashboard...</p>
          <p className="text-xs text-gray-400 mt-1">Connecting to database</p>
        </div>
      </div>
    );
  }

  // Show welcome screen
  if (currentScreen === 'welcome') {
    return <WelcomeScreen onContinue={handleWelcomeContinue} />;
  }

  // Show auth (sign in/sign up) screen
  if (currentScreen === 'auth') {
    return <SignInSignUp onComplete={handleAuthComplete} />;
  }

  // Show app if user is logged in
  if (currentScreen === 'app' && currentUser) {
    // Route to appropriate dashboard based on user role
    if (currentUser.role === 'patient') {
      const resident = dashboard.getResident(currentUser.residentId || '');
      if (!resident) {
        return (
          <div className="min-h-screen flex items-center justify-center bg-red-50">
            <div className="text-center">
              <p className="text-red-800 font-semibold">Error: Resident record not found</p>
              <p className="text-sm text-red-600 mt-1">Resident ID: {currentUser.residentId || 'none'}</p>
              <button
                onClick={handleLogout}
                className="mt-4 px-6 py-2 bg-red-600 text-white rounded-lg"
              >
                Return to Login
              </button>
            </div>
          </div>
        );
      }
      return (
        <PatientDashboard
          user={currentUser}
          resident={resident}
          dashboard={dashboard}
          onLogout={handleLogout}
          onRefresh={handleRefresh}
        />
      );
    }

    if (currentUser.role === 'caretaker') {
      return (
        <CaretakerDashboard
          user={currentUser}
          dashboard={dashboard}
          onLogout={handleLogout}
          onRefresh={handleRefresh}
        />
      );
    }

    if (currentUser.role === 'admin') {
      return (
        <AdminDashboard
          user={currentUser}
          dashboard={dashboard}
          onLogout={handleLogout}
          onRefresh={handleRefresh}
        />
      );
    }
  }

  return null;
}