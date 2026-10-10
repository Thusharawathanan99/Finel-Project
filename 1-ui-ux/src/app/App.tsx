import { useState, useEffect, useRef, lazy, Suspense, type ReactNode } from 'react';
import { Dashboard } from './models/Dashboard';
import { Resident } from './models/Resident';
import { Prescription } from './models/Prescription';
import { Medication } from './models/Medication';
import { EmotionalState } from './models/EmotionalState';
import { Caretaker } from './models/Caretaker';
import { SystemComponent } from './models/SystemComponent';
import { User } from './models/User';
import { WelcomeScreen } from './components/WelcomeScreen';
import { SignInSignUp } from './components/SignInSignUp';
import { onAuthStateChange, fetchUserProfile, signOut } from './services/firebaseAuthService';
import { loadDashboardSnapshot, publishDashboardSnapshot } from './services/dashboardLoader';
import { auth } from './firebase';
import { datasetCollector } from './ml/dataset/DatasetCollector';
import { modelAccuracyTracker } from './ml/ensemble/ModelAccuracyTracker';
import { clearAllMealPlanCaches } from './ml/meal-plan/MealPlanEngine';

const PatientDashboard = lazy(() => import('./components/PatientDashboard').then(module => ({ default: module.PatientDashboard })));
const CaretakerDashboard = lazy(() => import('./components/CaretakerDashboard').then(module => ({ default: module.CaretakerDashboard })));
const AdminDashboard = lazy(() => import('./components/AdminDashboard').then(module => ({ default: module.AdminDashboard })));

type AppScreen = 'welcome' | 'auth' | 'app' | 'loading' | 'error';

const initialPublicScreen = (): AppScreen => {
  if (typeof window === 'undefined') return 'welcome';
  return ['#/auth', '#/app'].includes(window.location.hash) ? 'auth' : 'welcome';
};

const screenHash = (screen: AppScreen): string => {
  if (screen === 'welcome') return '#/welcome';
  if (screen === 'auth') return '#/auth';
  return '#/app';
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
  const [currentScreen, setCurrentScreen] = useState<AppScreen>(initialPublicScreen);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [dashboard] = useState<Dashboard>(() => new Dashboard());
  const [, setRevision] = useState(0);
  const [loadError, setLoadError] = useState('');
  const sessionVersion = useRef(0);
  const activeIdentity = useRef<string | null>(null);
  const currentScreenRef = useRef(currentScreen);
  const restoreFromInitialAuthRoute = useRef(currentScreen === 'auth');
  const retryAction = useRef<(() => Promise<void>) | null>(null);
  const refreshInFlight = useRef(false);
  const refreshGeneration = useRef(0);
  const refreshAgain = useRef(false);
  const [refreshError, setRefreshError] = useState('');

  const showScreen = (screen: AppScreen, historyMode: 'replace' | 'push' = 'replace') => {
    currentScreenRef.current = screen;
    setCurrentScreen(screen);
    if (typeof window !== 'undefined') {
      const hash = screenHash(screen);
      if (window.location.hash !== hash) {
        window.history[historyMode === 'push' ? 'pushState' : 'replaceState'](null, '', hash);
      }
    }
  };

  const clearDashboard = () => {
    dashboard.clearPendingPrescriptionDrafts();
    dashboard.residents = [];
    dashboard.caretakers = [];
    dashboard.alerts = [];
    dashboard.systemComponents = [];
    dashboard.appointments = [];
    dashboard.emergencyAlerts = [];
  };

  const loadSession = async (user: User, version?: number): Promise<void> => {
    if (user.userId !== 'DEMO' && auth.currentUser?.uid !== user.userId) {
      throw new Error('Your signed-in account changed. Please sign in again.');
    }
    const loadVersion = version ?? ++sessionVersion.current;
    clearAllMealPlanCaches();
    setRefreshError('');
    activeIdentity.current = user.userId;
    datasetCollector?.setScope?.(user.userId === 'DEMO' ? null : user.userId);
    modelAccuracyTracker?.setScope?.(user.userId === 'DEMO' ? null : user.userId);
    setCurrentUser(null);
    setLoadError('');
    showScreen('loading');
    retryAction.current = () => loadSession(user);
    try {
      let snapshot: Dashboard;
      if (user.userId === 'DEMO') {
        snapshot = new Dashboard();
        initializeDemoData(snapshot);
      } else {
        snapshot = await loadDashboardSnapshot(user);
      }
      if (loadVersion !== sessionVersion.current || (user.userId !== 'DEMO' && auth.currentUser?.uid !== user.userId)) return;
      publishDashboardSnapshot(dashboard, snapshot);
      setCurrentUser(user);
      showScreen('app');
    } catch (error) {
      if (loadVersion !== sessionVersion.current || (user.userId !== 'DEMO' && auth.currentUser?.uid !== user.userId)) return;
      clearDashboard();
      setLoadError(error instanceof Error ? error.message : 'Your care information could not be loaded. Please try again.');
      showScreen('error');
    }
  };

  useEffect(() => {
    const restore = async (firebaseUser: Parameters<typeof fetchUserProfile>[0]) => {
      const version = ++sessionVersion.current;
      datasetCollector.setScope(null);
      modelAccuracyTracker.setScope(null);
      clearAllMealPlanCaches();
      activeIdentity.current = firebaseUser.uid;
      setCurrentUser(null);
      clearDashboard();
      setLoadError('');
      showScreen('loading');
      retryAction.current = () => restore(firebaseUser);
      try {
        const profile = await fetchUserProfile(firebaseUser);
        if (version !== sessionVersion.current) return;
        await loadSession({ userId: profile.uid, name: profile.name, email: profile.email, role: profile.role, residentId: profile.residentId }, version);
      } catch (error) {
        if (version !== sessionVersion.current) return;
        setLoadError(error instanceof Error ? error.message : 'Your account could not be verified. Please try again.');
        showScreen('error');
      }
    };
    const unsubscribe = onAuthStateChange(firebaseUser => {
      // Handle signout before duplicate-load checks, including signout during a request.
      if (!firebaseUser) {
        const hadSession = activeIdentity.current !== null;
        restoreFromInitialAuthRoute.current = false;
        sessionVersion.current++;
        activeIdentity.current = null;
        datasetCollector?.setScope?.(null);
        modelAccuracyTracker?.setScope?.(null);
        clearAllMealPlanCaches();
        retryAction.current = null;
        clearDashboard();
        setCurrentUser(null);
        if (hadSession || currentScreenRef.current === 'auth') showScreen('auth');
        return;
      }
      // The registration form owns identity creation until its transaction is complete.
      if (currentScreenRef.current === 'auth' && !restoreFromInitialAuthRoute.current) return;
      restoreFromInitialAuthRoute.current = false;
      if (activeIdentity.current === firebaseUser.uid) return;
      void restore(firebaseUser);
    });
    return () => {
      sessionVersion.current++;
      unsubscribe();
    };
  }, [dashboard]);

  useEffect(() => {
    const handleBrowserNavigation = () => {
      if (activeIdentity.current) {
        window.history.replaceState(null, '', '#/app');
        return;
      }
      const screen = initialPublicScreen();
      currentScreenRef.current = screen;
      setCurrentScreen(screen);
    };
    window.addEventListener('popstate', handleBrowserNavigation);
    window.addEventListener('hashchange', handleBrowserNavigation);
    return () => {
      window.removeEventListener('popstate', handleBrowserNavigation);
      window.removeEventListener('hashchange', handleBrowserNavigation);
    };
  }, []);

  const handleLogout = async () => {
    // Invalidate pending profile/data requests synchronously before awaiting Firebase.
    sessionVersion.current++;
    activeIdentity.current = null;
    datasetCollector?.setScope?.(null);
    modelAccuracyTracker?.setScope?.(null);
    clearAllMealPlanCaches();
    retryAction.current = null;
    clearDashboard();
    setCurrentUser(null);
    showScreen('auth');
    try { await signOut(); } catch (error) {
      console.warn('[App] Sign out failed:', error);
      setLoadError('Sign out could not be completed. Please retry.');
      retryAction.current = handleLogout;
      showScreen('error');
    }
  };

  const refreshRecords = async () => {
    if (!currentUser || currentUser.userId === 'DEMO' || auth.currentUser?.uid !== currentUser.userId) return;
    if (refreshInFlight.current) { refreshAgain.current=true; return; }
    const uid = currentUser.userId;
    const version = sessionVersion.current;
    const generation = refreshGeneration.current;
    refreshInFlight.current = true;
    try {
      const snapshot = await loadDashboardSnapshot(currentUser);
      if (version !== sessionVersion.current || auth.currentUser?.uid !== uid || generation !== refreshGeneration.current) return;
      publishDashboardSnapshot(dashboard, snapshot);
      setRefreshError('');
      setRevision(revision => revision + 1);
    } catch (error) {
      if (version === sessionVersion.current && generation === refreshGeneration.current) setRefreshError(error instanceof Error ? error.message : 'Care information could not be refreshed.');
    } finally { refreshInFlight.current = false; if(refreshAgain.current) {refreshAgain.current=false;void refreshRecords();} }
  };
  const handleRefresh = () => {
    ++refreshGeneration.current;
    dashboard.refreshAlerts();
    setRevision(revision => revision + 1);
    void refreshRecords();
  };

  useEffect(() => {
    if (currentScreen !== 'app' || !currentUser || currentUser.userId === 'DEMO') return;
    const refresh = () => { if (document.visibilityState !== 'hidden') void refreshRecords(); };
    const timer = setInterval(refresh, 20000);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => { clearInterval(timer); window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh); };
  }, [currentScreen, currentUser?.userId]);

  if (currentScreen === 'loading') {
    return (
      <div className="care-loading min-h-screen flex items-center justify-center bg-gradient-to-br from-teal-50 to-emerald-50">
        <div className="text-center" role="status" aria-live="polite">
          <div className="inline-block w-12 h-12 border-4 border-teal-200 border-t-teal-700 rounded-full animate-spin mb-4" aria-hidden="true" />
          <p className="text-gray-600 font-medium">Loading your dashboard...</p>
          <p className="text-xs text-gray-400 mt-1">Connecting to your care information</p>
        </div>
      </div>
    );
  }
  if (currentScreen === 'error') {
    return (
      <div className="care-error min-h-screen flex items-center justify-center bg-teal-50 p-6">
        <div className="max-w-md rounded-2xl border border-teal-100 bg-white p-8 text-center shadow-sm">
          <h1 className="text-xl font-semibold text-gray-800">We couldn't load your care information</h1>
          <p role="alert" className="mt-3 text-sm text-gray-600">{loadError}</p>
          <div className="mt-6 flex justify-center gap-3">
            <button type="button" onClick={() => void retryAction.current?.()} className="rounded-xl bg-teal-700 px-5 py-3 font-semibold text-white">Try Again</button>
            <button type="button" onClick={handleLogout} className="rounded-xl border border-gray-200 px-5 py-3 font-semibold text-gray-700">Return to Login</button>
          </div>
        </div>
      </div>
    );
  }
  if (currentScreen === 'welcome') return <WelcomeScreen onContinue={() => showScreen('auth', 'push')} />;
  if (currentScreen === 'auth') return <SignInSignUp onComplete={loadSession} />;
  if (currentScreen === 'app' && currentUser) {
    const props = { user: currentUser, dashboard, onLogout: handleLogout, onRefresh: handleRefresh };
    const showDashboard = (content: ReactNode) => <>{refreshError && <div role="alert" className="fixed bottom-28 left-4 right-4 z-[70] rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-900">{refreshError}<button type="button" className="ml-3 underline" onClick={()=>void refreshRecords()}>Retry refresh</button></div>}<Suspense fallback={<div role="status" className="p-8">Loading your workspace...</div>}>{content}</Suspense></>;
    if (currentUser.role === 'admin') return showDashboard(<AdminDashboard key={currentUser.userId} {...props} />);
    return (
      <div className="care-access-denied min-h-screen flex items-center justify-center bg-gray-50 p-6">
        <div className="max-w-md w-full rounded-2xl border border-red-200 bg-white p-8 text-center shadow-lg">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-red-100 flex items-center justify-center text-red-600">
            <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-gray-900">Admin Portal Only</h1>
          <p className="mt-3 text-sm text-gray-600">
            This web application is strictly for CareConnect Facility Administrators.
            {currentUser.role === 'patient'
              ? ' Patients must use the Elder/Orphan Mobile App to access medications, appointments, emotion AI, and meal plans.'
              : ' Caretakers must use the Caretaker Mobile App.'}
          </p>
          <p className="mt-2 text-xs text-gray-500">
            Per PDF specification, Prescription Reader, Facial Emotion AI, Vocal Analysis, and Meal Plans are restricted from the Admin Web Application.
          </p>
          <div className="mt-6 flex flex-col gap-2">
            <button
              type="button"
              onClick={handleLogout}
              className="w-full rounded-xl bg-teal-700 px-6 py-3 font-semibold text-white hover:bg-teal-800 transition-colors"
            >
              Sign Out & Switch to Admin Account
            </button>
          </div>
        </div>
      </div>
    );
  }
  return null;
}
