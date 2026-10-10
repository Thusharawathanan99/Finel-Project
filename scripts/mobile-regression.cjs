const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const project = path.resolve(__dirname, '..');
const staging = project;
const parser = createRequire(path.join(project, '5-patient/package.json'))('@babel/parser');
const source = p => fs.readFileSync(path.join(staging, p), 'utf8');
const passed = [];
const test = async (name, fn) => { await fn(); passed.push(name); console.log('PASS ' + name); };
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const jsonResponse = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => body });

function loadModule(p, dependencies = {}) {
  const src = source(p).replace(/^import .*;\r?\n/gm, '').replace(/export /g, '');
  const context = vm.createContext({ ...dependencies, process: { env: { EXPO_PUBLIC_API_URL: 'https://fixture.invalid/custom-api/' } }, console, Set, Date, encodeURIComponent, Number, String });
  const exports = p.endsWith('apiHelper.js') ? 'apiFetch, API_BASE' + (p.startsWith('5-patient') ? ', getResidentId, clearCache' : '')
    : p.endsWith('calendar.js') ? 'localDateKey, calendarDateKey, parseCalendarDate, appointmentInstant, upcomingAppointments'
    : p.endsWith('faceUi.js') ? 'getMobileFaceCopy, containedFaceBox, SELF_REPORTED_FEELINGS'
    : p.endsWith('emotionCheckInCatalog.js') ? 'getEmotionCheckInCopy, getEmotionCheckInState, searchEmotionCheckInStates, EMOTION_CHECK_IN_STATES, buildEmotionCheckInReport'
    : p.endsWith('faceReport.js') ? 'validateFaceReport, FACE_LANGUAGES, getFaceCopy, buildFaceReportText'
    : p.endsWith('liveFace.js') ? 'validateLiveFrame, createLiveFaceTracker, getExpressionDisplay, expressionEmoji, LIVE_EXPRESSIONS, buildLiveReportText, getLiveFaceCopy'
    : p.endsWith('liveMobileCopy.js') ? 'getLiveMobileCopy'
    : p.endsWith('liveFaceQuality.js') ? 'summarizeLiveFaceQuality, getLiveFaceQualityCopy'
    : p.endsWith('faceProviderStatus.js') ? 'getFaceProviderStatusCopy, validateFaceProviderStatus'
    : p.endsWith('facialObservations.js') ? 'createFacialObservationSession, getFacialObservationCopy, buildFacialObservationReport'
    : p.endsWith('patientSymptoms.js') ? 'buildPatientSymptomReport'
    : p.endsWith('faceGuide.js') ? 'getFaceGuideCopy, getAssistanceWorkflow'
    : p.endsWith('liveFaceSession.js') ? 'createLiveFrameLoop, createCloudFrameSampler, isLiveFrameFresh, getLiveFramePresentation, captureLiveCameraImage'
    : p.endsWith('mealPlanAdapter.js') ? 'normalizeMealPlan'
    : p.endsWith('medicationReview.js') ? 'medicationDetailsComplete, medicationReadyToSave, editMedication'
    : p.endsWith('sessionBootstrap.js') ? 'resolveInitialSession'
    : 'localDateKey, millisecondsToNextDay, medicationStorageKey, createDailyMedicationStore';
  vm.runInContext(src + '\nthis.exports = { ' + exports + ' };', context);
  return context.exports;
}

function loadComponentPrefix(p, componentName, handlers, initialStates, overrides = {}) {
  const src = source(p);
  const ast = parser.parse(src, { sourceType: 'module', plugins: ['jsx'] });
  const declaration = ast.program.body.filter(n => n.type === 'VariableDeclaration').flatMap(n => n.declarations).find(n => n.id.name === componentName);
  const fn = declaration.init;
  const containsJsx = node => node && typeof node === 'object' && (String(node.type).startsWith('JSX') ||
    Object.values(node).some(value => Array.isArray(value) ? value.some(containsJsx) : containsJsx(value)));
  const ret = fn.body.body.find(n => n.type === 'ReturnStatement' || containsJsx(n));
  const prefix = src.slice(fn.body.start + 1, ret.start);
  let stateIndex = 0;
  // Existing behavior fixtures retain their logical slots. The new movement
  // and symptom snapshots are independent state owned by their scoped panels.
  const stateSlot = index => componentName === 'LiveEmotionScreen'
    ? index === 13 ? 'movementSnapshot' : index === 14 ? 'symptomSnapshot' : index > 14 ? index - 2 : index : index;
  const setters = [];
  const effects = [];
  const context = vm.createContext({
    console, Date, AbortController, Number, JSON, Set, encodeURIComponent, setTimeout, clearTimeout, setInterval, clearInterval,
    ...loadModule('5-patient/src/calendar.js'), ...loadModule('5-patient/src/mealPlanAdapter.js'), useScreenRefresh() {},
    useState: value => { const index = stateSlot(stateIndex++); setters[index] = []; return [typeof index === 'number' && index < initialStates.length ? initialStates[index] : typeof value === 'function' ? value() : value, next => setters[index].push(next)]; },
    useRef: value => ({ current: value }),
    useEffect: effect => { effects.push(effect()); },
    useCallback: fn => fn,
    Alert: { alert: () => {} },
    ...overrides,
  });
  if (!context.React) context.React = {useState:context.useState,useRef:context.useRef,useEffect:context.useEffect,useCallback:context.useCallback};
  const factory = vm.runInContext('(' + src.slice(fn.start, fn.body.start) + '{' + prefix + '\nreturn { ' + handlers.join(', ') + ' }; })', context);
  return { handlers: factory({ navigation: overrides.navigation || { replace() {}, goBack() {} }, route: { params: { patient: { resident_id: 'RES-1', name: 'Fixture Patient' } } } }), setters, effects };
}

(async () => {
  await test('Every changed mobile module parses', async () => {
    const checkedFiles = ["6-caretaker/src/apiHelper.js","5-patient/src/apiHelper.js","5-patient/src/config/api.js","5-patient/App.js","6-caretaker/App.js","5-patient/src/sessionBootstrap.js","6-caretaker/src/sessionBootstrap.js","5-patient/src/screens/DashboardScreen.js","5-patient/src/screens/LoginScreen.js","6-caretaker/src/screens/LoginScreen.js","5-patient/src/screens/RegisterScreen.js","6-caretaker/src/screens/DashboardScreen.js","6-caretaker/src/screens/PatientListScreen.js","6-caretaker/src/screens/PatientProfileScreen.js","6-caretaker/src/screens/LeaveRequestScreen.js","6-caretaker/src/screens/WellnessAlertScreen.js","5-patient/src/screens/UploadRxScreen.js","6-caretaker/src/screens/UploadRxScreen.js","5-patient/src/screens/LiveEmotionScreen.js","5-patient/src/dailyMedicationState.js","5-patient/src/screens/MedicationsScreen.js"];
    for (const p of checkedFiles) parser.parse(source(p), { sourceType: 'module', plugins: ['jsx'] });
    for (const p of ['5-patient/src/medicationReview.js', '6-caretaker/src/medicationReview.js', '6-caretaker/src/screens/RegisterScreen.js']) parser.parse(source(p), { sourceType: 'module', plugins: ['jsx'] });
  });

  await test('Patient resident cache follows account UID and refuses 500/unlinked profiles', async () => {
    const auth = { currentUser: { uid: 'account-A', getIdToken: async () => 'fixture-token' } };
    const requests = [];
    let profile = jsonResponse(200, { role: 'patient', resident_id: 'resident-A' });
    const api = loadModule('5-patient/src/apiHelper.js', { auth, fetch: async url => { requests.push(url); return profile; } });
    assert.equal(await api.getResidentId(), 'resident-A');
    assert.equal(await api.getResidentId(), 'resident-A');
    assert.equal(requests.length, 1);
    auth.currentUser = { uid: 'account-B', getIdToken: async () => 'fixture-token-B' };
    profile = jsonResponse(200, { role: 'patient', resident_id: 'resident-B' });
    assert.equal(await api.getResidentId(), 'resident-B');
    api.clearCache();
    profile = jsonResponse(500, {});
    await assert.rejects(api.getResidentId(), /could not be loaded/);
    profile = jsonResponse(200, { role: 'patient' });
    await assert.rejects(api.getResidentId(), /not linked/);
    auth.currentUser = null;
    await assert.rejects(api.getResidentId(), /Not authenticated/);
  });

  await test('Stale account lookup cannot poison resident cache', async () => {
    const pending = deferred();
    const auth = { currentUser: { uid: 'A', getIdToken: async () => 'a' } };
    const api = loadModule('5-patient/src/apiHelper.js', { auth, fetch: () => pending.promise });
    const request = api.getResidentId();
    await new Promise(resolve => setImmediate(resolve));
    auth.currentUser = { uid: 'B', getIdToken: async () => 'b' };
    pending.resolve(jsonResponse(200, { role: 'patient', resident_id: 'A-resident' }));
    await assert.rejects(request, /session changed/);
  });

  for (const app of ['5-patient', '6-caretaker']) {
    const expectedRole = app === '5-patient' ? 'patient' : 'caretaker';
    const session = loadModule(app + '/src/sessionBootstrap.js');
    await test(app + ': verified saved session resumes at dashboard', async () => {
      const user = { uid: 'A' };
      const auth = { currentUser: user };
      const profile = { role: expectedRole, ...(expectedRole === 'patient' ? { resident_id: 'R-A' } : {}) };
      const result = await session.resolveInitialSession({ auth, user, expectedRole, requireResident: expectedRole === 'patient', apiFetch: async () => jsonResponse(200, profile) });
      assert.equal(result.route, 'Dashboard');assert.equal(result.invalidate, false);
    });
    await test(app + ': stale or wrong-role saved session returns to login', async () => {
      const user = { uid: 'A' };
      const auth = { currentUser: user };
      const missing = await session.resolveInitialSession({ auth, user, expectedRole, apiFetch: async () => jsonResponse(404, {}) });
      assert.equal(missing.route, 'Login');assert.equal(missing.invalidate, true);
      const wrongRole = await session.resolveInitialSession({ auth, user, expectedRole, apiFetch: async () => jsonResponse(200, { role: expectedRole === 'patient' ? 'caretaker' : 'patient' }) });
      assert.equal(wrongRole.route, 'Login');assert.equal(wrongRole.invalidate, true);
    });
    await test(app + ': saved-session service errors are retryable and never guessed', async () => {
      const user = { uid: 'A' };
      const auth = { currentUser: user };
      await assert.rejects(
        session.resolveInitialSession({ auth, user, expectedRole, apiFetch: async () => jsonResponse(503, {}) }),
        /could not verify/
      );
    });
  }

  for (const app of ['5-patient', '6-caretaker']) {
    await test(app + ': slow profile verification never opens the dashboard early', async () => {
      const pending = deferred();
      let navigations = 0; let signouts = 0;
      const auth = { currentUser: { uid: 'A' } };
      const { handlers } = loadComponentPrefix(app + '/src/screens/LoginScreen.js', 'LoginScreen', ['handleLogin'], ['person@example.com', 'password'], {
        auth, clearCache() {}, signInWithEmailAndPassword: async () => ({ user: auth.currentUser }),
        signOut: async () => { signouts++; auth.currentUser = null; },
        navigation: { replace() { navigations++; } },
        apiFetch: () => pending.promise,
        setTimeout: callback => { callback(); return 0; },
      });
      const login = handlers.handleLogin();
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(navigations, 0);
      pending.resolve(jsonResponse(500, {}));
      await login;
      assert.equal(navigations, 0);
      assert.equal(signouts, 1);
    });

    await test(app + ': account change during profile JSON parsing denies navigation without signing out the new user', async () => {
      const pending = deferred();
      let navigations = 0; let signouts = 0;
      const auth = { currentUser: { uid: 'A' } };
      const { handlers } = loadComponentPrefix(app + '/src/screens/LoginScreen.js', 'LoginScreen', ['handleLogin'], ['person@example.com', 'password'], {
        auth, clearCache() {}, signInWithEmailAndPassword: async () => ({ user: auth.currentUser }),
        signOut: async () => { signouts++; }, navigation: { replace() { navigations++; } },
        apiFetch: async () => ({ status: 200, ok: true, json: () => pending.promise }),
      });
      const login = handlers.handleLogin();
      await new Promise(resolve => setImmediate(resolve));
      auth.currentUser = { uid: 'B' };
      pending.resolve({ role: app === '5-patient' ? 'patient' : 'caretaker', resident_id: 'R-A' });
      await login;
      assert.equal(navigations, 0);
      assert.equal(signouts, 0);
      assert.equal(auth.currentUser.uid, 'B');
    });

    const review = loadModule(app + '/src/medicationReview.js');
    await test(app + ': unresolved medication cannot save and any edit invalidates verification', async () => {
      const medicine = { drugName: 'Metformin', dosage: '500mg', frequency: 'BID', reviewed: true };
      assert.equal(review.medicationReadyToSave(medicine), true);
      for (const field of ['drugName', 'dosage', 'frequency']) {
        assert.equal(review.medicationReadyToSave({ ...medicine, [field]: '' }), false);
        assert.equal(review.medicationReadyToSave({ ...medicine, [field]: 'Needs Review' }), false);
      }
      assert.equal(review.medicationReadyToSave(review.editMedication(medicine, 'dosage', '50mg')), false);
      let saves = 0;
      const { handlers } = loadComponentPrefix(app + '/src/screens/UploadRxScreen.js', 'UploadRxScreen', ['handleSubmit'],
        ['Fixture', 'Doctor', '2026-10-04', 'file', 'image', 'base64', false, { medications: [{ ...medicine, reviewed: false }] }], {
          ...review, auth: { currentUser: { uid: 'A' } }, getResidentId: async () => 'R-A',
          apiFetch: async () => { saves++; return jsonResponse(201, {}); },
        });
      await handlers.handleSubmit();
      assert.equal(saves, 0);
    });

    await test(app + ': save preserves all verified dose and day regimens', async () => {
      let saved;
      const medications = [
        { drugName: 'Warfarin', dosage: '5mg', frequency: 'Monday', reviewed: true },
        { drugName: 'Warfarin', dosage: '2.5mg', frequency: 'Tuesday', reviewed: true },
      ];
      const { handlers } = loadComponentPrefix(app + '/src/screens/UploadRxScreen.js', 'UploadRxScreen', ['handleSubmit'],
        ['Fixture', 'Doctor', '2026-10-04', 'file', 'image', 'base64', false, { medications }], {
          ...review, auth: { currentUser: { uid: 'A' } }, getResidentId: async () => 'R-A',
          apiFetch: async (_, options) => { saved = JSON.parse(options.body); return jsonResponse(201, {}); },
        });
      await handlers.handleSubmit();
      assert.equal(saved.medications.length, 2);
      assert.equal(saved.medications[0].frequency, 'Monday');
      assert.equal(saved.medications[1].dosage, '2.5mg');
      assert.equal(saved.medications[1].frequency, 'Tuesday');
      assert.equal(saved.medications[0].instructions, '');
    });

    await test(app + ': selecting another image during analysis cannot replace the current image', async () => {
      const pending = deferred(); let picks = 0;
      const component = loadComponentPrefix(app + '/src/screens/UploadRxScreen.js', 'UploadRxScreen', ['handlePickImage'], [], {
        auth: { currentUser: { displayName: 'Fixture' } },
        ImagePicker: { launchImageLibraryAsync: async () => { picks++; return { canceled: false, assets: [{ uri: 'image-a', base64: 'base64-a' }] }; } },
        apiFetch: () => pending.promise,
      });
      const first = component.handlers.handlePickImage();
      await new Promise(resolve => setImmediate(resolve));
      await component.handlers.handlePickImage();
      assert.equal(picks, 1);
      pending.resolve(jsonResponse(200, { medications: [{ drugName: 'A' }] }));
      await first;
      assert.deepEqual(component.setters[4], ['image-a']);
    });

    await test(app + ': API helper honors configured base and Firebase token', async () => {
      let observed;
      const auth = { currentUser: { uid: 'A', getIdToken: async () => 'fresh-token' } };
      const api = loadModule(app + '/src/apiHelper.js', { auth, fetch: async (...args) => { observed = args; return jsonResponse(200, {}); } });
      await api.apiFetch('/residents', { headers: { Authorization: 'stale-token' } });
      assert.equal(observed[0], 'https://fixture.invalid/custom-api/residents');
      assert.equal(observed[1].headers.Authorization, 'Bearer fresh-token');
    });

    await test(app + ': login never creates or changes profiles after HTTP 500', async () => {
      const requests = [];
      let signouts = 0;
      const auth = { currentUser: { uid: 'A', getIdTokenResult: async () => ({ claims: {} }) } };
      const { handlers } = loadComponentPrefix(app + '/src/screens/LoginScreen.js', 'LoginScreen', ['handleLogin'], ['person@example.com', 'password'], {
        auth, clearCache() {}, signInWithEmailAndPassword: async () => ({ user: auth.currentUser }),
        signOut: async () => { signouts++; auth.currentUser = null; },
        apiFetch: async (...args) => { requests.push(args); return jsonResponse(500, {}); },
      });
      await handlers.handleLogin();
      assert.equal(requests.length, 1);
      assert.equal(requests[0][1], undefined);
      assert.equal(signouts, 1);
    });

    await test(app + ': existing different role is preserved and denied', async () => {
      const requests = [];
      let signouts = 0;
      const auth = { currentUser: { uid: 'A' } };
      const { handlers } = loadComponentPrefix(app + '/src/screens/LoginScreen.js', 'LoginScreen', ['handleLogin'], ['person@example.com', 'password'], {
        auth, clearCache() {}, signInWithEmailAndPassword: async () => ({ user: auth.currentUser }),
        signOut: async () => { signouts++; auth.currentUser = null; },
        apiFetch: async (...args) => { requests.push(args); return jsonResponse(200, { role: app === '5-patient' ? 'caretaker' : 'patient' }); },
      });
      await handlers.handleLogin();
      assert.equal(requests.length, 1);
      assert.equal(signouts, 1);
    });

    await test(app + ': password-reset action invokes Firebase using entered email', async () => {
      let sent;
      const auth = {};
      const { handlers } = loadComponentPrefix(app + '/src/screens/LoginScreen.js', 'LoginScreen', ['handlePasswordReset'], ['  Person@Example.com  ', 'password'], {
        auth, sendPasswordResetEmail: async (...args) => { sent = args; },
      });
      await handlers.handlePasswordReset();
      assert.equal(sent[0], auth);
      assert.equal(sent[1], 'person@example.com');
    });

    await test(app + ': upload ignores superseded analysis and results after unmount', async () => {
      const first = deferred(); const second = deferred();
      let count = 0;
      const component = loadComponentPrefix(app + '/src/screens/UploadRxScreen.js', 'UploadRxScreen', ['handleAnalyze'], [], {
        auth: { currentUser: { displayName: 'Fixture' } },
        apiFetch: async () => (++count === 1 ? first.promise : second.promise),
      });
      const a = component.handlers.handleAnalyze('image-a');
      const b = component.handlers.handleAnalyze('image-b');
      second.resolve(jsonResponse(200, { doctor_name: 'Doctor B', medications: [{ drugName: 'B' }] }));
      await b;
      first.resolve(jsonResponse(200, { doctor_name: 'Doctor A', medications: [{ drugName: 'A' }] }));
      await a;
      assert.deepEqual(component.setters[1], ['Doctor B']);
      const savedCount = component.setters[7].length;
      component.effects.forEach(cleanup => cleanup?.());
      await component.handlers.handleAnalyze('image-after-unmount');
      assert.equal(component.setters[1].length, 1);
    });
  }

  await test('Patient true-404 login repair uses only atomic register endpoint', async () => {
    const requests = [];
    const auth = { currentUser: { uid: 'A', displayName: 'Fixture', getIdTokenResult: async () => ({ claims: {} }) } };
    const { handlers } = loadComponentPrefix('5-patient/src/screens/LoginScreen.js', 'LoginScreen', ['handleLogin'], ['person@example.com', 'password'], {
      auth, clearCache() {}, signInWithEmailAndPassword: async () => ({ user: auth.currentUser }), signOut: async () => {},
      apiFetch: async (...args) => { requests.push(args); return requests.length === 1 ? jsonResponse(404, {}) : jsonResponse(201, { role: 'patient', residentId: 'R-A' }); },
    });
    await handlers.handleLogin();
    assert.equal(requests.length, 2);
    assert.equal(requests[1][0], '/users/register-patient');
    assert.equal(requests[1][1].method, 'POST');
  });

  await test('Patient missing role, missing resident link and rejected registration cannot open dashboard', async () => {
    for (const scenario of ['missing-role', 'missing-link', 'registration-failed']) {
      const auth = { currentUser: { uid: 'A', displayName: 'Fixture' } };
      let requests = 0; let signouts = 0; let navigations = 0;
      const { handlers } = loadComponentPrefix('5-patient/src/screens/LoginScreen.js', 'LoginScreen', ['handleLogin'], ['person@example.com', 'password'], {
        auth, clearCache() {}, signInWithEmailAndPassword: async () => ({ user: auth.currentUser }),
        signOut: async () => { signouts++; auth.currentUser = null; }, navigation: { replace() { navigations++; } },
        apiFetch: async () => {
          requests++;
          if (scenario === 'registration-failed') return requests === 1 ? jsonResponse(404, {}) : jsonResponse(500, {});
          return jsonResponse(200, scenario === 'missing-role' ? { resident_id: 'R-A' } : { role: 'patient' });
        },
      });
      await handlers.handleLogin();
      assert.equal(navigations, 0, scenario);
      assert.equal(signouts, 1, scenario);
      assert.equal(requests, scenario === 'registration-failed' ? 2 : 1, scenario);
    }
  });

  await test('Patient signup rolls back identity only after confirmed missing server profile', async () => {
    for (const serverProfileStatus of [404, 200, 503]) {
      const auth = { currentUser: null };
      let deletes = 0; let signouts = 0; let navigations = 0;
      const { handlers } = loadComponentPrefix('5-patient/src/screens/RegisterScreen.js', 'RegisterScreen', ['handleRegister'],
        ['Fixture', 'person@example.com', 'Password1', 'Password1', 'CT1'], {
          React: { useEffect() {} }, auth, clearCache() {}, updateProfile: async () => {},
          createUserWithEmailAndPassword: async () => { auth.currentUser = { uid: 'A' }; return { user: auth.currentUser }; },
          deleteUser: async () => { deletes++; auth.currentUser = null; },
          signOut: async () => { signouts++; auth.currentUser = null; }, navigation: { replace() { navigations++; } },
          apiFetch: async endpoint => endpoint === '/users/register-patient'
            ? jsonResponse(503, { error: 'Fixture registration error' }) : jsonResponse(serverProfileStatus, {}),
          console: { error() {} },
        });
      await handlers.handleRegister();
      assert.equal(deletes, serverProfileStatus === 404 ? 1 : 0);
      assert.equal(signouts, serverProfileStatus === 404 ? 0 : 1);
      assert.equal(navigations, 0);
    }
  });

  const faceContract = loadModule('shared/faceReport.js');
  const faceUi = loadModule('5-patient/src/faceUi.js');
  const emotionCatalog = loadModule('shared/emotionCheckInCatalog.js');
  const liveContract = loadModule('shared/liveFace.js', faceContract);
  const liveCopy = loadModule('5-patient/src/liveMobileCopy.js', liveContract);
  const liveQuality = loadModule('shared/liveFaceQuality.js', liveContract);
  const providerStatus = loadModule('shared/faceProviderStatus.js');
  const facialObservations = loadModule('shared/facialObservations.js', liveContract);
  const patientSymptoms = loadModule('shared/patientSymptoms.js', { URGENT_HELP_NOTE_MAX_LENGTH: 1000, URGENT_HELP_MESSAGE_MAX_LENGTH: 4999 });
  const faceGuide = loadModule('shared/faceGuide.js');
  const liveSession = loadModule('5-patient/src/liveFaceSession.js', { AbortController, setTimeout, clearTimeout });
  const fixturePhoto = { id: 1, dataUri: 'data:image/jpeg;base64,fixture-image', width: 800, height: 600 };
  const fixtureReport = () => ({
    version: 'face-report-v1', provider: 'google-cloud-vision', analyzedAt: '2026-10-05T08:00:00.000Z',
    image: { width: 800, height: 600 }, faceCount: 1, status: 'ready', issues: [],
    faces: [{ box: { x: 0.25, y: 0.2, width: 0.35, height: 0.55 }, confidence: 0.98, landmarkConfidence: 0.96,
      pose: { roll: 0, pan: 0, tilt: 0 }, quality: { blur: 'VERY_UNLIKELY', underExposure: 'VERY_UNLIKELY' },
      signals: { joy: 'LIKELY', sorrow: 'VERY_UNLIKELY', anger: 'VERY_UNLIKELY', surprise: 'UNLIKELY' } }],
  });

  function faceFixture(overrides = {}, states) {
    let refIndex = 0;
    return loadComponentPrefix('5-patient/src/screens/LiveEmotionScreen.js', 'LiveEmotionScreen',
      ['analyzePhoto', 'discardPhoto', 'saveCheckIn', 'capturePhoto', 'choosePhoto', 'shareReport', 'openCamera', 'shareLiveReport', 'shareCheckInReport'],
      states || ['en', fixturePhoto, false, true, null, null, null, { width: 400, height: 340 }, true, 'sad', '20', 'My own words', false, null], {
        ...faceContract, ...faceUi, ...liveContract, ...liveCopy, ...liveSession, ...liveQuality, ...providerStatus, ...emotionCatalog,
        ...facialObservations, ...patientSymptoms, ...faceGuide,
        AppState: { addEventListener: () => ({ remove() {} }) }, FileSystem: { deleteAsync: async () => {} },
        auth: { currentUser: { uid: 'A' } },
        useCameraPermissions: () => [{ granted: true }, async () => ({ granted: true })],
        onAuthStateChanged: () => () => {},
        MAX_IMAGE_DIMENSION: 1600, MAX_SOURCE_BYTES: 16 * 1024 * 1024, MAX_ENCODED_LENGTH: 8 * 1024 * 1024,
        useRef: value => ({ current: refIndex++ === 0 ? { takePictureAsync: async () => ({ uri: 'fixture://photo', width: 800, height: 600 }) } : value }),
        ImageManipulator: { manipulate: () => ({ resize() {}, renderAsync: async () => ({
          saveAsync: async () => ({ base64: 'fixture-image', width: 800, height: 600 }), release() {},
        }), release() {} }) }, SaveFormat: { JPEG: 'jpeg' },
        ImagePicker: { launchImageLibraryAsync: async () => ({ canceled: false, assets: [{ uri: 'fixture://gallery', width: 800, height: 600, type: 'image' }] }) },
        Share: { share: async () => {} },
        getResidentId: async () => 'R-A',
        ...overrides,
        // Snapshot refs were inserted before the existing camera/session refs.
        // Keep injection targets in the original logical ref order.
        useRef: (() => {
          const originalRef = overrides.useRef || (value => ({ current: refIndex++ === 0
            ? { takePictureAsync: async () => ({ uri: 'fixture://photo', width: 800, height: 600 }) } : value }));
          let snapshotRef = 0;
          return value => snapshotRef++ < 2 ? { current: value } : originalRef(value);
        })(),
        // Configuration reads are exercised separately in live-session.test.cjs.
        // These existing tests isolate image/report and manual check-in requests.
        apiFetch: (endpoint, options) => endpoint === '/emotions/face-status'
          ? Promise.resolve(jsonResponse(200, { provider: 'google-cloud-vision', configurationState: 'missing', providerVerified: false }))
          : overrides.apiFetch?.(endpoint, options),
      });
  }

  await test('Unavailable or malformed face responses produce no report or wellness history', async () => {
    for (const response of [jsonResponse(503, {}), jsonResponse(200, { emotionLabel: 'Happy', stateScore: 70 }),
      jsonResponse(200, { ...fixtureReport(), image: { width: 600, height: 800 } })]) {
      const requests = [];
      const component = faceFixture({ apiFetch: async endpoint => { requests.push(endpoint); return response; } });
      await component.handlers.analyzePhoto();
      assert.deepEqual(requests, ['/emotions/analyze-image']);
      assert.deepEqual(component.setters[6], [null]);
      assert.equal(component.setters[5].filter(Boolean).length, 1);
      component.effects.forEach(cleanup => cleanup?.());
    }
  });

  await test('Missing cloud credentials show a setup message distinct from temporary outages', async () => {
    const component = faceFixture({ apiFetch: async () => jsonResponse(503, { errorCode: 'FACE_NOT_CONFIGURED' }) });
    await component.handlers.analyzePhoto();
    assert.equal(component.setters[5].at(-1), 'notConfigured');
    assert.equal(component.setters[6].filter(Boolean).length, 0);
    component.effects.forEach(cleanup => cleanup?.());
  });

  await test('Retaking a photo ignores late cloud results and prevents history writes', async () => {
    const pending = deferred(); const requests = [];
    const component = faceFixture({ apiFetch: endpoint => { requests.push(endpoint); return pending.promise; } });
    const analysis = component.handlers.analyzePhoto();
    await new Promise(resolve => setImmediate(resolve));
    component.handlers.discardPhoto();
    pending.resolve(jsonResponse(200, fixtureReport()));
    await analysis;
    assert.deepEqual(requests, ['/emotions/analyze-image']);
    assert.equal(component.setters[6].filter(Boolean).length, 0);
    component.effects.forEach(cleanup => cleanup?.());
  });

  await test('Face capture and gallery choice prepare a preview without sending any image', async () => {
    for (const handler of ['capturePhoto', 'choosePhoto']) {
      let requests = 0; let captureOptions;
      const component = faceFixture({ apiFetch: async () => { requests++; },
        useRef: (() => { let index = 0; return value => ({ current: index++ === 0 ? { takePictureAsync: async options => {
          captureOptions = options; return { uri: 'fixture://photo', width: 800, height: 600 };
        } } : value }); })(),
      });
      await component.handlers[handler]();
      assert.equal(requests, 0);
      assert.equal(component.setters[1].at(-1).dataUri, fixturePhoto.dataUri);
      assert.equal(component.setters[1].at(-1).width, 800);
      if (handler === 'capturePhoto') { assert.equal(captureOptions.skipProcessing, false); assert.ok(captureOptions.quality >= 0.8); }
      component.effects.forEach(cleanup => cleanup?.());
    }
  });

  await test('Account changes during photo JSON parsing never display another account report', async () => {
    const pending = deferred(); const auth = { currentUser: { uid: 'A' } };
    const component = faceFixture({ auth, apiFetch: async () => ({ ok: true, json: () => pending.promise }) });
    const work = component.handlers.analyzePhoto();
    await new Promise(resolve => setImmediate(resolve));
    auth.currentUser = { uid: 'B' };
    pending.resolve(fixtureReport());
    await work;
    assert.equal(component.setters[6].filter(Boolean).length, 0);
    component.effects.forEach(cleanup => cleanup?.());
  });

  await test('Face analysis returns a measured report and never saves inferred wellness or care alerts', async () => {
    const requests = [];
    const component = faceFixture({ apiFetch: async (endpoint, options) => { requests.push({ endpoint, body: JSON.parse(options.body) }); return jsonResponse(200, fixtureReport()); } });
    await component.handlers.analyzePhoto();
    assert.deepEqual(requests.map(r => r.endpoint), ['/emotions/analyze-image']);
    assert.equal(requests[0].body.image, fixturePhoto.dataUri);
    assert.equal(component.setters[6].at(-1).faces[0].confidence, 0.98);
    component.effects.forEach(cleanup => cleanup?.());
  });

  await test('Concurrent Analyze taps send exactly one cloud request', async () => {
    const pending = deferred(); let requests = 0;
    const component = faceFixture({ apiFetch: async () => { requests++; return pending.promise; } });
    const first = component.handlers.analyzePhoto(); const second = component.handlers.analyzePhoto();
    assert.equal(requests, 1);
    pending.resolve(jsonResponse(200, fixtureReport())); await Promise.all([first, second]);
    assert.equal(component.setters[6].filter(Boolean).length, 1);
    component.effects.forEach(cleanup => cleanup?.());
  });

  await test('Cloud request timeout leaves a retryable translated error and no report', async () => {
    let deadline;
    const component = faceFixture({ setTimeout: callback => { deadline = callback; return 1; }, clearTimeout() {},
      apiFetch: (endpoint, options) => new Promise((resolve, reject) => options.signal.addEventListener('abort', () => {
        const error = new Error('Fixture timeout'); error.name = 'AbortError'; reject(error);
      }, { once: true })),
    });
    const analysis = component.handlers.analyzePhoto(); deadline(); await analysis;
    assert.equal(component.setters[5].at(-1), 'timeout');
    assert.equal(component.setters[6].filter(Boolean).length, 0);
    assert.equal(component.setters[4].at(-1), null);
    component.effects.forEach(cleanup => cleanup?.());
  });

  await test('Retaking while camera permission is pending does not reopen a stale camera', async () => {
    const pending = deferred();
    const component = faceFixture({ useCameraPermissions: () => [{ granted: false }, () => pending.promise] });
    const opening = component.handlers.openCamera(); component.handlers.discardPhoto();
    pending.resolve({ granted: true }); await opening;
    assert.equal(component.setters[2].includes(true), false);
    component.effects.forEach(cleanup => cleanup?.());
  });

  await test('A no-face response remains a retake report without inferred wellness', async () => {
    const requests = [];
    const component = faceFixture({ apiFetch: async endpoint => {
      requests.push(endpoint); return jsonResponse(200, { ...fixtureReport(), faces: [], faceCount: 0, status: 'retake', issues: ['no_face'] });
    } });
    await component.handlers.analyzePhoto();
    assert.deepEqual(requests, ['/emotions/analyze-image']);
    assert.equal(component.setters[6].at(-1).status, 'retake');
    assert.equal(component.setters[6].at(-1).faceCount, 0);
    assert.equal(component.setters[6].at(-1).stateScore, undefined);
    component.effects.forEach(cleanup => cleanup?.());
  });

  await test('Unknown photo-quality signals remain unknown without claiming quality passed', async () => {
    const report = fixtureReport(); report.faces[0].quality = { blur: 'UNKNOWN', underExposure: 'UNKNOWN' };
    const component = faceFixture({ apiFetch: async () => jsonResponse(200, report) });
    await component.handlers.analyzePhoto();
    const displayed = component.setters[6].at(-1);
    assert.equal(displayed.faces[0].quality.blur, 'UNKNOWN');
    for (const language of ['en', 'ta', 'si']) {
      const sharedLabels = faceContract.getFaceCopy(language);
      assert.equal(faceUi.getMobileFaceCopy(language).ready, sharedLabels.ready);
      assert.ok(faceContract.buildFaceReportText(displayed, language).includes(sharedLabels.likelihood.UNKNOWN));
    }
    component.effects.forEach(cleanup => cleanup?.());
  });

  await test('Freezing a live frame retains its exact photo, expression report and text sharing without cloud', async () => {
    let reads = 0; let requests = 0; let shared;
    const raw = { version: 'live-face-v1', provider: 'face-api.js-local', width: 800, height: 600, capturedAt: new Date().toISOString(), processingTimeMs: 25,
      faces: [{ box: { x: 0.2, y: 0.2, width: 0.5, height: 0.5 }, detectionConfidence: 0.98,
        scores: { angry: 0.01, disgusted: 0.01, fearful: 0.01, happy: 0.94, neutral: 0.01, sad: 0.01, surprised: 0.01 }, landmarks: Array.from({ length: 68 }, () => ({ x: 0.5, y: 0.5 })) }] };
    const frozen = { ...liveContract.createLiveFaceTracker({ stableFrames: 1 }).update(raw), completedAt: raw.capturedAt, ownerUid: 'A', image: { ...fixturePhoto, capturedAt: raw.capturedAt } };
    let index = 0;
    const component = faceFixture({ apiFetch: async () => { requests++; }, Share: { share: async value => { shared = value; } },
      useRef: value => ({ current: index++ === 0 ? { takePictureAsync: async () => { reads++; } } : index === 16 ? frozen : value }),
    }, ['en', null, true, true, null, null, null, { width: 400, height: 340 }, false, null, '', '', false, null, true, frozen, 'running']);
    await component.handlers.capturePhoto(); await component.handlers.shareLiveReport();
    assert.equal(reads, 0); assert.equal(requests, 0);
    assert.equal(component.setters[1].at(-1).dataUri, frozen.image.dataUri);
    assert.equal(component.setters[23].at(-1).faces[0].expression, 'happy');
    assert.equal(component.setters[23].at(-1).faces[0].evidenceMode, 'single-frame');
    assert.ok(shared.message.includes('Happy expression')); assert.ok(!shared.message.includes(frozen.image.dataUri));
    component.effects.forEach(cleanup => cleanup?.());
  });

  await test('Uploaded-photo local output works without any cloud call and ignores late account changes', async () => {
    for (const changed of [false, true]) {
      const result = deferred(); const auth = { currentUser: { uid: 'A' } }; let index = 0; let requests = 0;
      const states = ['en', { ...fixturePhoto, width: 1600, height: 1200, ownerUid: 'A', capturedAt: '2026-10-05T08:00:00.000Z' }, false, false, null, null, null, { width: 400, height: 340 }, false, null, '', '', false, null, true];
      const component = faceFixture({ auth, apiFetch: async () => { requests++; },
        ImageManipulator: { manipulate: () => ({ resize() {}, renderAsync: async () => ({ saveAsync: async () => ({ base64: 'local-resized-fixture', width: 640, height: 480 }), release() {} }), release() {} }) },
        useRef: value => ({ current: index++ === 0 ? {} : index === 12 ? { waitForIdle: async () => {}, analyze: () => result.promise } : value }),
      }, states);
      await new Promise(resolve => setImmediate(resolve)); if (changed) auth.currentUser = { uid: 'B' };
      result.resolve({ version: 'live-face-v1', provider: 'face-api.js-local', width: 640, height: 480, capturedAt: states[1].capturedAt, processingTimeMs: 25, faces: [] });
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(requests, 0);
      assert.equal(component.setters[23].filter(Boolean).length, changed ? 0 : 1);
      assert.equal(component.setters[1].length, 0);
      if (!changed) { assert.equal(component.setters[23].at(-1).image.width, 640); assert.equal(component.setters[23].at(-1).sourceDataUri, fixturePhoto.dataUri); }
      component.effects.forEach(cleanup => cleanup?.());
    }
  });

  await test('Self-reported save failures retain the same observation ID for a safe retry', async () => {
    const requests = []; let success = false;
    const component = faceFixture({ apiFetch: async (endpoint, options) => {
      requests.push({ endpoint, body: JSON.parse(options.body) });
      return jsonResponse(success ? 201 : 503, success ? { id: 1, alertId: 4, alertCreated: true } : {});
    } });
    await component.handlers.saveCheckIn();
    assert.equal(component.setters[13].length, 0);
    assert.equal(component.setters[5].at(-1), 'save');
    success = true;
    await component.handlers.saveCheckIn();
    assert.deepEqual(requests.map(r => r.endpoint), ['/emotions', '/emotions']);
    assert.equal(requests[0].body.observationId, requests[1].body.observationId);
    assert.equal(requests[1].body.emotionLabel, 'Self-reported');
    assert.ok(requests[1].body.note.startsWith('[Self-reported]'));
    assert.equal(component.setters[13].at(-1).alert, 'alertCreated');
    component.effects.forEach(cleanup => cleanup?.());
  });

  await test('Extended states are saved as patient answers, never as face predictions, and unknown states are rejected', async () => {
    for (const stateId of ['grateful', 'confused', 'distressed', 'sleepy', 'pain', 'invented-diagnosis']) {
      const requests = [];
      const component = faceFixture({ apiFetch: async (endpoint, options) => {
        requests.push({ endpoint, body: JSON.parse(options.body) });
        return jsonResponse(201, { id: 1 });
      } }, ['ta', fixturePhoto, false, true, null, null, null, { width: 400, height: 340 }, true, stateId, '55', '', false, null]);
      await component.handlers.saveCheckIn();
      if (stateId === 'invented-diagnosis') {
        assert.equal(requests.length, 0);
        assert.equal(component.setters[5].at(-1), 'score');
      } else {
        assert.equal(requests.length, 1);
        assert.equal(requests[0].endpoint, '/emotions');
        assert.equal(requests[0].body.emotionLabel, 'Self-reported');
        assert.equal(requests[0].body.stateScore, 55);
        assert.match(requests[0].body.note, /\[Self-reported\]/);
        assert.ok(requests[0].body.note.includes('(' + stateId + ')'));
        assert.equal(requests[0].body.scores, undefined);
      }
      component.effects.forEach(cleanup => cleanup?.());
    }
  });

  await test('Saved check-in sharing is localized text only and requires the owning account and server confirmation', async () => {
    for (const language of ['en', 'ta', 'si']) for (const mode of ['confirmed', 'unsaved', 'changed-account']) {
      const shared = [], auth = { currentUser: { uid: mode === 'changed-account' ? 'B' : 'A' } };
      const saved = mode === 'unsaved' ? null : { ownerUid: 'A', report: {
        stateId: 'confused', wellnessScore: 55, note: 'My own answer', recordedAt: '2026-10-08T00:00:00.000Z',
      } };
      const component = faceFixture({ auth, Share: { share: async value => shared.push(value) },
        apiFetch: async () => { throw new Error('Sharing must not save or send alerts'); } },
        [language, fixturePhoto, false, true, null, null, null, { width: 400, height: 340 }, true, 'confused', '55', 'My own answer', false, saved]);
      await component.handlers.shareCheckInReport();
      assert.equal(shared.length, mode === 'confirmed' ? 1 : 0);
      if (mode === 'confirmed') {
        assert.ok(shared[0].message.includes(emotionCatalog.getEmotionCheckInCopy(language).reportSource));
        assert.ok(shared[0].message.includes(emotionCatalog.getEmotionCheckInState('confused', language).label));
        assert.ok(shared[0].message.includes('55/100'));
        assert.ok(!shared[0].message.includes('data:image'));
        assert.ok(!shared[0].message.includes('Happy expression'));
      }
      component.effects.forEach(cleanup => cleanup?.());
    }
  });

  await test('Face overlay contain transform stays aligned on landscape and portrait images', async () => {
    const box = { x: 0.25, y: 0.25, width: 0.5, height: 0.5 };
    const a = faceUi.containedFaceBox(box, { width: 800, height: 400 }, { width: 400, height: 400 });
    assert.deepEqual(JSON.parse(JSON.stringify(a)), { left: 100, top: 150, width: 200, height: 100 });
    const b = faceUi.containedFaceBox(box, { width: 400, height: 800 }, { width: 400, height: 400 });
    assert.deepEqual(JSON.parse(JSON.stringify(b)), { left: 150, top: 100, width: 100, height: 200 });
    assert.equal(faceUi.containedFaceBox(box, { width: 0, height: 800 }, { width: 400, height: 400 }), null);
  });

  await test('Mobile face interaction translations have matching English, Tamil and Sinhala keys', async () => {
    const keys = value => Object.entries(value).flatMap(([key, child]) => typeof child === 'object' ? keys(child).map(k => key + '.' + k) : [key]).sort();
    const en = faceUi.getMobileFaceCopy('en');
    assert.deepEqual(keys(faceUi.getMobileFaceCopy('ta')), keys(en));
    assert.deepEqual(keys(faceUi.getMobileFaceCopy('si')), keys(en));
    assert.notEqual(faceUi.getMobileFaceCopy('ta').errors.unavailable, en.errors.unavailable);
    assert.notEqual(faceUi.getMobileFaceCopy('si').manual, en.manual);
  });

  await test('Mobile and all launcher modes include both mobile apps on distinct ports', async () => {
    for (const mode of ['app', 'mobile', 'all']) {
      const started = [];
      const child = { stdout: { on() {} }, stderr: { on() {} }, on() {} };
      const context = vm.createContext({
        __dirname, console: { log() {}, error() {} },
        process: { argv: ['node', 'dev-runner.js', mode], env: {}, on() {} },
        require: name => name === 'child_process' ? {
          spawn: (cmd, args, options) => { started.push({ args, cwd: options.cwd }); return child; },
          spawnSync: () => ({ status: 1 }),
        } : require(name),
      });
      vm.runInContext(source('scripts/dev-runner.js'), context);
      const mobileApps = started.filter(service => /[\\/](5-patient|6-caretaker)$/.test(service.cwd));
      assert.equal(mobileApps.length, 2, mode);
      assert.ok(mobileApps.find(service => service.cwd.endsWith('5-patient')).args.includes('8082'));
      assert.ok(mobileApps.find(service => service.cwd.endsWith('6-caretaker')).args.includes('8081'));
    }
  });

  await test('Daily medication state resets at local midnight, isolates users, and serializes fast taps', async () => {
    const api = loadModule('5-patient/src/dailyMedicationState.js');
    let uid = 'account-A'; let now = new Date(2026, 9, 4, 23, 59);
    const persisted = new Map(); const emitted = [];
    const store = api.createDailyMedicationStore({
      storage: { getItem: async key => persisted.get(key) ?? null, setItem: async (key, value) => persisted.set(key, value) },
      getUid: () => uid, now: () => now, onChange: value => emitted.push([...value]),
    });
    await store.refresh();
    await Promise.all([store.toggle(1), store.toggle(2)]);
    assert.deepEqual(emitted.at(-1), [1, 2]);
    now = new Date(2026, 9, 5, 0, 1);
    await store.refresh(true);
    assert.deepEqual(emitted.at(-1), []);
    await store.toggle(3);
    uid = 'account-B';
    await store.refresh(true);
    assert.deepEqual(emitted.at(-1), []);
    assert.equal(api.localDateKey(now), '2026-10-05');
    assert.equal(persisted.size, 2);
    assert.ok(api.millisecondsToNextDay(now) > 23 * 60 * 60 * 1000);
    uid = 'account-A';
    await store.refresh(true);
    assert.deepEqual(emitted.at(-1), [3]);
  });

  await test('Daily medication state ignores old-account storage reads', async () => {
    const api = loadModule('5-patient/src/dailyMedicationState.js');
    let uid = 'A'; const first = deferred(); const emitted = [];
    const store = api.createDailyMedicationStore({ storage: { getItem: key => key.includes('_A_') ? first.promise : Promise.resolve(null) }, getUid: () => uid, onChange: state => emitted.push([...state]) });
    const oldRead = store.refresh();
    uid = 'B';
    await store.refresh();
    first.resolve('[99]');
    await oldRead;
    assert.deepEqual(emitted.at(-1), []);
  });

  await test('No mobile client Gemini key/call or caretaker alternate API remains', async () => {
    const emotion = source('5-patient/src/screens/LiveEmotionScreen.js');
    assert.ok(!/GoogleGenerativeAI|GEMINI_API_KEY|generateContent|Images never leave/.test(emotion));
    assert.ok(emotion.includes("apiFetch('/emotions/analyze-image'"));
    for (const file of fs.readdirSync(path.join(staging, '6-caretaker/src/screens'))) {
      const src = source('6-caretaker/src/screens/' + file);
      assert.ok(!/https:\/\/api\.careconnect|10\.0\.2\.2|localhost:3001|\bfetch\(/.test(src), file);
    }
    assert.ok(source('5-patient/src/screens/MedicationsScreen.js').includes("AppState.addEventListener('change'"));
    assert.ok(source('6-caretaker/src/screens/PatientProfileScreen.js').includes('residentDetails?.room_number ?? patient.room_number'));
  });
  await test('Failed medication storage writes restore the previous checkmarks and allow retry', async () => {
    let fail = true;
    const changes = [];
    const daily = loadModule('5-patient/src/dailyMedicationState.js');
    const store = daily.createDailyMedicationStore({
      storage: {getItem: async () => null, setItem: async () => {if (fail) throw new Error('fixture write failure');}},
      getUid: () => 'fixture-patient', onChange: value => changes.push([...value]),
    });
    await store.refresh();
    await assert.rejects(() => store.toggle('M1'), /fixture write failure/);
    assert.deepEqual(changes.at(-1), []);
    fail = false;
    await store.toggle('M1');
    assert.deepEqual(changes.at(-1), ['M1']);
  });

  await test('Every mobile source parses, including new refresh/error/calendar adapters', async () => {
    const walk = directory => fs.readdirSync(directory,{withFileTypes:true}).flatMap(entry => entry.isDirectory() ? walk(path.join(directory,entry.name)) : entry.name.endsWith('.js') ? [path.join(directory,entry.name)] : []);
    for (const app of ['5-patient','6-caretaker']) for (const file of [...walk(path.join(project,app,'src')),path.join(project,app,'App.js')]) parser.parse(fs.readFileSync(file,'utf8'),{sourceType:'module',plugins:['jsx']});
  });
  for (const app of ['5-patient','6-caretaker']) {
    await test(app+': JSON decode after account change is rejected', async () => {
      const pending=deferred(); const auth={currentUser:{uid:'fixture-A',getIdToken:async()=> 'fixture-token'}};
      const api=loadModule(app+'/src/apiHelper.js',{auth,fetch:async()=>({status:200,ok:true,json:()=>pending.promise})});
      const response=await api.apiFetch('/residents'); const reading=response.json();
      auth.currentUser={uid:'fixture-B'};pending.resolve([{name:'A private fixture'}]);
      await assert.rejects(reading,/session changed/);
    });
    await test(app+': lost prescription acknowledgement retains stable draft ID', async () => {
      const saves=[];const review=loadModule(app+'/src/medicationReview.js');
      const component=loadComponentPrefix(app+'/src/screens/UploadRxScreen.js','UploadRxScreen',['handleSubmit'],
        ['Fixture','Doctor','2026-10-05','file','uri','base64',false,{medications:[{drugName:'Fixture',dosage:'1mg',frequency:'Daily',reviewed:true}]}],{
        ...review,auth:{currentUser:{uid:'fixture-A'}},getResidentId:async()=> 'R',useEffect(){},console:{error(){}},
        apiFetch:async(endpoint,options)=>{saves.push(JSON.parse(options.body));if(saves.length===1)throw new Error('fixture acknowledgement lost');return jsonResponse(201,{existing:true});}
      });
      await component.handlers.handleSubmit();await component.handlers.handleSubmit();assert.equal(saves.length,2);assert.equal(saves[0].prescriptionId,saves[1].prescriptionId);
    });
    await test(app+': unreadable issue date stays blank and prevents save', async () => {
      let saves=0;const review=loadModule(app+'/src/medicationReview.js');
      const component=loadComponentPrefix(app+'/src/screens/UploadRxScreen.js','UploadRxScreen',['handleAnalyze','handleSubmit'],
        ['Fixture','Doctor','','file','uri','base64',false,{medications:[{drugName:'Fixture',dosage:'1mg',frequency:'Daily',reviewed:true}]}],{
        ...review,useEffect(){},auth:{currentUser:{uid:'fixture-A'}},getResidentId:async()=> 'R',apiFetch:async endpoint=>{if(endpoint==='/prescriptions')saves++;return jsonResponse(200,{date:'Needs Review',medications:[]});}
      });
      await component.handlers.handleAnalyze('fixture');assert.equal(component.setters[2].at(-1),'');await component.handlers.handleSubmit();assert.equal(saves,0);
    });
    await test(app+': environment-backed Firebase configuration has all required variables', async () => {
      const config=source(app+'/src/firebase/config.js');
      for (const name of ['API_KEY','AUTH_DOMAIN','PROJECT_ID','STORAGE_BUCKET','MESSAGING_SENDER_ID','APP_ID']) assert.ok(config.includes('process.env.EXPO_PUBLIC_FIREBASE_'+name));
      assert.ok(source(app+'/App.js').includes('initialRouteName={bootstrap.route}'));
      assert.ok(source(app+'/App.js').includes('resolveInitialSession'));
    });
  }
  await test('Both meal adapters support website days-array, warnings, nutrition and legacy plans', async () => {
    assert.equal(source('5-patient/src/mealPlanAdapter.js'),source('6-caretaker/src/mealPlanAdapter.js'));
    const adapter=loadModule('5-patient/src/mealPlanAdapter.js');
    const website=adapter.normalizeMealPlan({days:[{day:'Monday',breakfast:{name:'Fixture meal',warnings:['Fixture warning']},lunch:{name:'Fixture lunch'},totalCalories:1800,totalProtein:50}],medicationConsiderations:['Fixture drug food advice']});
    assert.equal(website.days.Mon.meals.length,2);assert.equal(website.days.Mon.meals[0].warnings[0],'Fixture warning');assert.equal(website.days.Mon.nutrition.calories,1800);assert.equal(website.clinicalNotes[0],'Fixture drug food advice');
    const legacy=adapter.normalizeMealPlan({days:{Mon:{meals:[{id:'breakfast',name:'Old-format meal'}]}},clinicalNotes:'Fixture note'});
    assert.equal(legacy.days.Mon.meals[0].name,'Old-format meal');assert.equal(adapter.normalizeMealPlan(null),null);
  });
  await test('Deleted patient meal plan clears previous state and HTTP503 shows retry error', async () => {
    let status=200;
    const component=loadComponentPrefix('5-patient/src/screens/MealPlanScreen.js','MealPlanScreen',['fetchData'],[{days:{}},false],{
      useEffect(){},getResidentId:async()=> 'R',apiFetch:async()=>jsonResponse(status,{plan:null}),console:{error(){}}
    });
    await component.handlers.fetchData();assert.equal(component.setters[0].at(-1),null);
    status=503;await component.handlers.fetchData();assert.ok(component.setters[2].at(-1).includes('could not load'));
  });
  await test('Calendar helpers preserve local dates and reject invalid dates', async () => {
    const calendar=loadModule('5-patient/src/calendar.js');
    assert.equal(calendar.localDateKey(new Date(2026,9,5,0,15)),'2026-10-05');
    assert.equal(calendar.calendarDateKey('2026-12-08T00:00:00.000Z'),'2026-12-08');
    assert.equal(calendar.calendarDateKey('2026-02-30'),'');assert.equal(calendar.parseCalendarDate('invalid'),null);
    assert.equal(calendar.parseCalendarDate('2026-12-08T00:00:00.000Z').getDate(),8);
    const upcoming=calendar.upcomingAppointments([
      {appointment_date:'2026-12-08',appointment_time:'09:00',status:'completed'},
      {appointment_date:'2026-12-08',appointment_time:'09:00',status:'scheduled'},
      {appointment_date:'2026-12-08',appointment_time:'13:00',status:'scheduled'}],new Date(2026,11,8,12));
    assert.equal(upcoming.length,1);assert.equal(upcoming[0].appointment_time,'13:00');
  });
  await test('Patient appointment display accepts ISO contract and filters completed visits', async () => {
    const component=loadComponentPrefix('5-patient/src/screens/AppointmentsScreen.js','AppointmentsScreen',['formatDate','getDaysUntil','nextApt'],[[{appointment_date:'2099-12-08',status:'completed'},{appointment_date:'2099-12-09',status:'scheduled'}],false],{useEffect(){}});
    assert.equal(component.handlers.nextApt.status,'scheduled');assert.ok(!component.handlers.formatDate('2026-12-08T00:00:00.000Z').includes('Invalid'));assert.ok(!component.handlers.getDaysUntil('2026-12-08T00:00:00.000Z').includes('NaN'));
  });
  await test('Caretaker appointment concurrent taps send one request', async () => {
    const pending=deferred();let posts=0;
    const component=loadComponentPrefix('6-caretaker/src/screens/PatientProfileScreen.js','PatientProfileScreen',['handleBookAppointment'],
      ['meds',null,false,null,false,[],true,{doctorName:'Fixture',date:'2099-12-08',time:'09:00'},[],{id:'D'}],{
        useEffect(){},require:()=>({auth:{currentUser:{getIdToken:async()=> 'fixture-token'}}}),apiFetch:async()=>{posts++;await pending.promise;return jsonResponse(201,{appointmentId:'fixture-APT'});}
      });
    const first=component.handlers.handleBookAppointment();const second=component.handlers.handleBookAppointment();await new Promise(resolve=>setImmediate(resolve));assert.equal(posts,1);pending.resolve();await Promise.all([first,second]);
  });
  await test('Caretaker SOS requires an explicit assigned resident and loads SOS feed', async () => {
    const bodies=[],requests=[];const patients=[{id:'A',name:'Fixture A'},{id:'B',name:'Fixture B'}];
    const component=loadComponentPrefix('6-caretaker/src/screens/DashboardScreen.js','DashboardScreen',['triggerSOS','fetchAlerts'],['Fixture caretaker',patients,[],false,false,false,[]],{
      useEffect(){},Animated:{Value:class{}},setTimeout(){return 0;},auth:{currentUser:{uid:'caretaker-fixture'}},apiFetch:async(endpoint,options)=>{requests.push(endpoint);if(options?.body)bodies.push(JSON.parse(options.body));return jsonResponse(200,endpoint==='/sos-alerts'&&!options?.method?[{id:1,resident_id:'B',resident_name:'Fixture resident',message:'Fixture help',created_at:'2026-10-06T06:00:00.000Z',is_resolved:false}]:[]);}
    });
    await component.handlers.triggerSOS();assert.equal(bodies.length,0);await component.handlers.triggerSOS(patients[1]);assert.equal(bodies[0].residentId,'B');assert.ok(requests.includes('/sos-alerts'));assert.equal(component.setters[6].at(-1)[0].resident_id,'B');
  });
  await test('Failed patient notification persistence retains notification', async () => {
    const component=loadComponentPrefix('5-patient/src/screens/DashboardScreen.js','DashboardScreen',['dismissNotification'],['Fixture',[],false,[{notification_id:'N'}]],{useEffect(){},Animated:{Value:class{}},apiFetch:async()=>jsonResponse(500,{})});
    await component.handlers.dismissNotification('N');assert.equal(component.setters[3].length,0);
  });
  await test('Refresh hook reloads on focus and foreground and detaches listeners', async () => {
    const effects=[],listeners={};let loads=0;let removed=0;
    const code=source('5-patient/src/useScreenRefresh.js').replace(/^import .*;\n/gm,'').replace(/export /g,'');
    const context=vm.createContext({useRef:value=>({current:value}),useEffect:fn=>effects.push(fn()),AppState:{addEventListener:(name,fn)=>{listeners.active=fn;return {remove(){removed++;}};}}});
    vm.runInContext(code+';this.hook=useScreenRefresh;',context);
    context.hook({addListener(name,fn){listeners.focus=fn;return ()=>removed++;}},async()=>{loads++;});await new Promise(resolve=>setImmediate(resolve));
    await listeners.focus();await listeners.active('active');await new Promise(resolve=>setImmediate(resolve));assert.equal(loads,3);effects[0]();assert.equal(removed,2);
  });


  await test('SOS remains visible when wellness service fails', async () => {
    const component=loadComponentPrefix('6-caretaker/src/screens/DashboardScreen.js','DashboardScreen',['fetchAlerts'],['Fixture',[],[],false,false,false,[]],{
      useEffect(){},Animated:{Value:class{}},auth:{currentUser:{uid:'caretaker-fixture'}},apiFetch:async endpoint=>endpoint==='/sos-alerts'?jsonResponse(200,[{id:2,resident_id:'R',resident_name:'Fixture resident',message:'Fixture help',created_at:'2026-10-06T06:00:00.000Z',is_resolved:false}]):jsonResponse(503,{})
    });
    await component.handlers.fetchAlerts();assert.equal(component.setters[6].at(-1)[0].id,2);assert.ok(component.setters[8].at(-1).includes('could not be loaded'));
  });
  await test('A manual zero-score check-in uses one atomic request and preserves zero', async () => {
    const requests = [];
    const component = faceFixture({ apiFetch: async (endpoint, options) => {
      requests.push({ endpoint, body: JSON.parse(options.body) }); return jsonResponse(201, { id: 7, alertId: 9, alertCreated: true });
    } }, ['ta', fixturePhoto, false, true, null, null, null, { width: 400, height: 340 }, true, 'pain', '0', 'Fixture self-report', false, null]);
    await component.handlers.saveCheckIn();
    assert.deepEqual(requests.map(request => request.endpoint), ['/emotions']);
    assert.equal(requests[0].body.stateScore, 0);
    assert.ok(requests[0].body.observationId);
    assert.equal(component.setters[13].at(-1).alert, 'alertCreated');
    component.effects.forEach(cleanup => cleanup?.());
  });

  await test('Mobile rendered screens have no undefined component or helper references', async () => {
    const traverse=createRequire(path.join(project,'5-patient/package.json'))('@babel/traverse').default;
    const allowed=new Set(['require','module','exports','console','process','global','window','fetch','AbortController','Date','Math','Number','String','Boolean','Object','Array','JSON','Set','Map','Promise','Error','RegExp','isNaN','encodeURIComponent','setTimeout','clearTimeout','setInterval','clearInterval','undefined','parseInt','parseFloat']);
    const walk=directory=>fs.readdirSync(directory,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?walk(path.join(directory,entry.name)):entry.name.endsWith('.js')?[path.join(directory,entry.name)]:[]);
    const undefinedNames=[];
    for(const app of ['5-patient','6-caretaker'])for(const file of [...walk(path.join(project,app,'src')),path.join(project,app,'App.js')])traverse(parser.parse(fs.readFileSync(file,'utf8'),{sourceType:'module',plugins:['jsx']}),{ReferencedIdentifier(ref){if(!ref.scope.hasBinding(ref.node.name)&&!allowed.has(ref.node.name))undefinedNames.push(path.relative(project,file)+':'+ref.node.loc.start.line+' '+ref.node.name);}});
    assert.deepEqual(undefinedNames,[]);
  });
  console.log('Passed ' + passed.length + ' regression checks.');
})().catch(error => { console.error(error); process.exitCode = 1; });
