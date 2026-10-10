// Offline functional checks for explicit patient/observer urgent-help requests.
// No camera image, live service, actual SOS, phone call or patient record is used.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');
const project = path.resolve(__dirname, '..');
const esbuild = require(path.join(project, '1-ui-ux/node_modules/esbuild'));
const carePromise = import(pathToFileURL(path.join(project, 'shared/faceCare.js')));
const symptomPromise = import(pathToFileURL(path.join(project, 'shared/patientSymptoms.js')));
const source = fs.readFileSync(path.join(project, '5-patient/src/components/FaceCareHelpPanel.js'), 'utf8');
const code = esbuild.transformSync(source, { loader: 'jsx', format: 'cjs', target: 'es2020' }).code;
const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const saved = (extra = {}) => json(201, { alertId: 17, saved: true, replayed: false, isResolved: false, ...extra });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const settle = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
function text(node) {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(text).join(' ');
  return node?.children ? text(node.children) : '';
}
function find(node, predicate) {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node)) { for (const child of node) { const result = find(child, predicate); if (result) return result; } return null; }
  if (predicate(node)) return node;
  return find(node.children, predicate);
}
async function fixture(overrides = {}) {
  const care = await carePromise;
  const symptomCare = await symptomPromise;
  let stateIndex = 0, refIndex = 0, effectIndex = 0, first = true, language = overrides.language || 'en', tree, authListener, blurListener, nextUuid = 0;
  const states = [overrides.symptoms || [], overrides.note || '', false, null, null, overrides.expanded || false];
  const refs = [], cleanups = [], effects = [], timers = new Map(), requests = [], calls = [], shares = [], snapshots = [], uuidCalls = [];
  let timerSequence = 0;
  const auth = { currentUser: { uid: 'synthetic-patient-a' } };
  const React = { Fragment: 'Fragment', createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    useState: initial => { const index = stateIndex++; if (!(index in states)) states[index] = initial; return [states[index], value => { states[index] = typeof value === 'function' ? value(states[index]) : value; }]; },
    useRef: initial => { const index = refIndex++; if (!refs[index]) refs[index] = { current: initial }; return refs[index]; },
    useEffect: (effect, deps) => { const index = effectIndex++, prior = effects[index];
      if (first || !deps || !prior || deps.some((item, i) => !Object.is(item, prior[i]))) { cleanups[index]?.(); cleanups[index] = effect(); effects[index] = deps; }
    } };
  const native = { StyleSheet: { create: value => value }, Linking: { openURL: async url => { calls.push(url); if (overrides.callFailure) throw new Error('synthetic-dialer-failure'); } },
    Share: { share: async options => { shares.push(options); if (overrides.shareFailure) throw new Error('synthetic-share-failure'); } } };
  for (const component of ['View', 'Text', 'TouchableOpacity', 'ActivityIndicator', 'TextInput']) native[component] = component;
  const imports = { react: React, 'react-native': native, '@expo/vector-icons': { MaterialCommunityIcons: 'Icon' },
    'expo-modules-core': { uuid: { v4: () => { const value = '123e4567-e89b-42d3-a456-' + String(++nextUuid).padStart(12, '0'); uuidCalls.push(value); return value; } } },
    'firebase/auth': { onAuthStateChanged: (instance, callback) => { authListener = callback; return () => {}; } },
    '../firebase/config': { auth }, '../../../shared/faceCare.js': care, '../../../shared/patientSymptoms.js': symptomCare,
    '../apiHelper': { getResidentId: overrides.getResidentId || (async () => 'synthetic-resident-a'), apiFetch: async (endpoint, options) => {
      requests.push({ endpoint, options, body: JSON.parse(options.body) });
      return overrides.apiFetch ? overrides.apiFetch(endpoint, options) : saved();
    } },
  };
  const mod = { exports: {} };
  vm.runInNewContext(code, { module: mod, exports: mod.exports, require: name => { if (!(name in imports)) throw new Error('Unexpected import ' + name); return imports[name]; },
    Date, console, AbortController, setTimeout: (callback, delay) => { const id = ++timerSequence; timers.set(id, { callback, delay }); return id; }, clearTimeout: id => timers.delete(id) });
  const navigation = { addListener: (event, callback) => { assert.equal(event, 'blur'); blurListener = callback; return () => {}; } };
  const render = () => { stateIndex = 0; refIndex = 0; effectIndex = 0; tree = mod.exports.default({ language, navigation, onChange: snapshot => snapshots.push(snapshot) }); first = false; return tree; };
  render();
  const button = label => { render(); const result = find(tree, node => node.type === 'TouchableOpacity' && text(node).trim() === label); assert.ok(result, 'Expected button ' + label); return result; };
  return { care, symptomCare, states, requests, calls, shares, snapshots, uuidCalls, timers, render, button, auth,
    setLanguage(value) { language = value; render(); },
    setAccount(uid) { auth.currentUser = uid ? { uid } : null; authListener(auth.currentUser); render(); },
    blur: () => blurListener(), unmount: () => cleanups.forEach(cleanup => cleanup?.()),
    send: () => button(states[4] === 'failed' ? care.getFaceCareCopy(language).retry : care.getFaceCareCopy(language).action).props.onPress(),
  };
}

test('the urgent panel sends nothing on mount and permits an explicit request without selected symptoms', async () => {
  const f = await fixture();
  assert.equal(f.requests.length, 0); assert.equal(f.calls.length, 0);
  await f.send(); assert.equal(f.requests.length, 1);
  const { endpoint, body } = f.requests[0];
  assert.equal(endpoint, '/sos-alerts'); assert.deepEqual(Object.keys(body).sort(), ['message', 'requestId', 'residentId']);
  assert.equal(body.residentId, 'synthetic-resident-a'); assert.match(body.requestId, /^[0-9a-f-]{36}$/i);
  assert.ok(body.message.includes('Symptom codes: none-selected'));
  assert.ok(body.message.includes('Patient/observer-reported')); assert.equal(f.states[3].alertId, 17);
  assert.equal(f.timers.size, 0); f.unmount();
});

test('EN, Tamil and Sinhala requests contain only manual symptoms and notes with a saved-only receipt', async () => {
  for (const language of ['en', 'ta', 'si']) {
    const f = await fixture({ language, symptoms: ['breathingDifficulty', 'chestPain'], note: 'Synthetic report: started at noon.', expanded: true });
    await f.send();
    const copy = f.care.getFaceCareCopy(language), message = f.requests[0].body.message;
    assert.ok(message.includes('Difficulty breathing')); assert.ok(message.includes('Chest pain or pressure'));
    assert.ok(message.includes('Synthetic report: started at noon.'));
    if (language !== 'en') assert.ok(message.includes(copy.symptoms.chestPain));
    assert.equal(/data:image|expressionConfidence|stateScore|detectionConfidence/.test(message), false);
    assert.ok(text(f.render()).includes(copy.savedMessage));
    assert.equal(f.requests.length, 1); assert.equal(f.calls.length, 0); f.unmount();
  }
});

test('rapid help taps produce one request while another save is pending', async () => {
  const pending = deferred(); const f = await fixture({ apiFetch: () => pending.promise });
  const first = f.send(); await settle();
  const copy = f.care.getFaceCareCopy('en');
  const pendingButton = f.button(copy.sending); assert.equal(pendingButton.props.disabled, true);
  await pendingButton.props.onPress(); assert.equal(f.requests.length, 1);
  pending.resolve(saved()); await first; assert.equal(f.states[3].alertId, 17); f.unmount();
});

test('a lost acknowledgement reuses the exact UUID and message on an explicit retry', async () => {
  let attempts = 0;
  const f = await fixture({ symptoms: ['chestPain'], apiFetch: async () => { if (++attempts === 1) throw new Error('synthetic-lost-acknowledgement'); return saved({ replayed: true }); } });
  await f.send(); assert.equal(f.states[3], null); assert.equal(f.states[4], 'failed');
  await f.send(); assert.equal(f.requests.length, 2); assert.deepEqual(f.requests[0].body, f.requests[1].body);
  assert.equal(f.uuidCalls.length, 1); assert.equal(f.states[3].replayed, true); f.unmount();
});

test('changing a reported concern or language after failure creates a fresh request identity', async () => {
  const f = await fixture({ symptoms: ['chestPain'], expanded: true, apiFetch: async () => json(503, {}) });
  await f.send(); const first = f.requests[0].body;
  f.button(f.symptomCare.getPatientSymptomsCopy('en').symptoms.breathingDifficulty).props.onPress(); await f.send();
  assert.notEqual(f.requests[1].body.requestId, first.requestId); assert.notEqual(f.requests[1].body.message, first.message);
  f.setLanguage('ta'); await f.send();
  assert.notEqual(f.requests[2].body.requestId, f.requests[1].body.requestId); f.unmount();
});

test('HTTP errors and malformed success receipts never claim that an urgent request was saved', async () => {
  for (const response of [json(503, {}), json(401, {}), json(200, {}), json(200, { saved: true }), saved({ alertId: '17' }), saved({ alertId: 0 }), saved({ saved: false })]) {
    const f = await fixture({ apiFetch: async () => response }); await f.send();
    assert.equal(f.states[3], null); assert.ok(['auth', 'failed'].includes(f.states[4])); f.unmount();
  }
});

test('canceling an in-flight request stops waiting but retains its identity for a safe retry', async () => {
  const pending = deferred(); let attempts = 0;
  const f = await fixture({ apiFetch: () => ++attempts === 1 ? pending.promise : Promise.resolve(saved({ replayed: true })) });
  const first = f.send(); await settle();
  f.button(f.care.getFaceCareCopy('en').cancelPending).props.onPress();
  assert.equal(f.requests[0].options.signal.aborted, true); assert.equal(f.states[2], false); assert.equal(f.states[4], 'failed');
  pending.resolve(saved()); await first; assert.equal(f.states[3], null);
  await f.send(); assert.equal(f.requests[1].body.requestId, f.requests[0].body.requestId); f.unmount();
});

test('changing account while resident lookup is pending prevents sending another account request', async () => {
  const resident = deferred(); const f = await fixture({ getResidentId: () => resident.promise });
  const pending = f.send(); f.setAccount('synthetic-patient-b'); resident.resolve('synthetic-resident-a'); await pending;
  assert.equal(f.requests.length, 0); assert.equal(f.states[3], null); assert.equal(f.states[0].length, 0); f.unmount();
});

test('account changes, navigation blur and unmount abort a pending save and suppress its late receipt', async () => {
  for (const cancel of ['account', 'blur', 'unmount']) {
    const pending = deferred(); const f = await fixture({ apiFetch: () => pending.promise });
    const work = f.send(); await settle();
    if (cancel === 'account') f.setAccount('synthetic-patient-b'); else if (cancel === 'blur') f.blur(); else f.unmount();
    assert.equal(f.requests[0].options.signal.aborted, true);
    pending.resolve(saved()); await work; assert.equal(f.states[3], null);
    if (cancel !== 'unmount') f.unmount();
  }
});

test('a resolved replay is identified and a new explicit request receives a new UUID', async () => {
  const f = await fixture({ apiFetch: async () => saved({ replayed: true, isResolved: true }) });
  await f.send(); const first = f.requests[0].body.requestId;
  const copy = f.care.getFaceCareCopy('en'); assert.ok(text(f.render()).includes(copy.alreadyResolved));
  f.button(copy.newRequest).props.onPress(); await f.send();
  assert.notEqual(f.requests[1].body.requestId, first); f.unmount();
});

test('a timeout stops waiting even during resident lookup and suppresses a later request', async () => {
  const resident = deferred(); const f = await fixture({ getResidentId: () => resident.promise });
  const pending = f.send(); const timer = [...f.timers.values()][0];
  assert.equal(timer.delay, 20000); timer.callback();
  assert.equal(f.states[2], false); assert.equal(f.states[4], 'failed');
  resident.resolve('synthetic-resident-a'); await pending;
  assert.equal(f.requests.length, 0); assert.equal(f.states[3], null); f.unmount();
});

test('an account change during receipt JSON parsing cannot display the previous account confirmation', async () => {
  const parsing = deferred();
  const f = await fixture({ apiFetch: async () => ({ ok: true, status: 201, json: () => parsing.promise }) });
  const pending = f.send(); await settle(); f.setAccount('synthetic-patient-b');
  parsing.resolve({ saved: true, alertId: 17, replayed: false, isResolved: false }); await pending;
  assert.equal(f.states[3], null); assert.equal(f.states[2], false); f.unmount();
});

test('1990 is opened only by an explicit call button, independent of sign-in and server availability', async () => {
  const f = await fixture(); f.setAccount(null); await f.send(); assert.equal(f.requests.length, 0);
  assert.equal(f.calls.length, 0); await f.button(f.care.getFaceCareCopy('en').call1990).props.onPress();
  assert.deepEqual(f.calls, ['tel:1990']); f.unmount();
  const failed = await fixture({ callFailure: true }); await failed.button(failed.care.getFaceCareCopy('en').call1990).props.onPress();
  assert.equal(failed.states[4], 'call'); assert.ok(text(failed.render()).includes(failed.care.getFaceCareCopy('en').callFailed)); failed.unmount();
});

test('all 14 symptoms show immediate localized guidance without sending an alert or waiting for a model', async () => {
  for (const language of ['en', 'ta', 'si']) {
    const f = await fixture({ language, expanded: true });
    f.setAccount(null);
    const copy = f.symptomCare.getPatientSymptomsCopy(language);
    for (const key of f.symptomCare.PATIENT_SYMPTOM_KEYS) {
      f.button(copy.symptoms[key]).props.onPress();
      assert.ok(text(f.render()).includes(copy.urgentTitle));
      assert.ok(text(f.render()).includes(copy.guidance));
      assert.equal(f.requests.length, 0); assert.equal(f.calls.length, 0);
      const snapshot = f.snapshots.at(-1);
      assert.equal(snapshot.urgent, true); assert.ok(snapshot.symptomKeys.includes(key));
      assert.ok(Number.isFinite(Date.parse(snapshot.reportedAt)));
      f.button(copy.symptoms[key]).props.onPress(); f.render();
    }
    await f.button(f.care.getFaceCareCopy(language).call1990).props.onPress();
    assert.deepEqual(f.calls, ['tel:1990']); f.unmount();
  }
});

test('Share exports a localized selected symptom report without triggering SOS or a phone call', async () => {
  for (const language of ['en', 'ta', 'si']) {
    const f = await fixture({ language, symptoms: ['visionChanges'], note: 'Synthetic check-in.' });
    const copy = f.symptomCare.getPatientSymptomsCopy(language);
    await f.button(copy.share).props.onPress();
    assert.equal(f.shares.length, 1); assert.deepEqual(Object.keys(f.shares[0]), ['message']);
    assert.ok(f.shares[0].message.includes(copy.symptoms.visionChanges));
    assert.ok(f.shares[0].message.includes(copy.notSentStatus));
    assert.doesNotMatch(f.shares[0].message, /data:image|expressionConfidence|stateScore|detectionConfidence/);
    assert.equal(f.requests.length, 0); assert.equal(f.calls.length, 0); f.unmount();
  }
});

test('symptom reports record saved-only duplicate status, reset explicitly and discard former account notes', async () => {
  const f = await fixture({ symptoms: ['severeHeadache'], note: 'Synthetic private account A.', apiFetch: async () => saved({ replayed: true }) });
  await f.send(); f.render();
  assert.equal(f.snapshots.at(-1).receipt.saved, true); assert.equal(f.snapshots.at(-1).receipt.replayed, true);
  const copy = f.symptomCare.getPatientSymptomsCopy('en');
  assert.ok(text(f.render()).includes(copy.duplicate));
  await f.button(copy.share).props.onPress(); assert.ok(f.shares[0].message.includes(copy.savedStatus));
  f.setAccount('synthetic-patient-b');
  const snapshot = f.snapshots.at(-1); assert.deepEqual(Array.from(snapshot.symptomKeys), []);
  assert.equal(snapshot.note, ''); assert.equal(snapshot.reportedAt, null); assert.equal(snapshot.receipt, null);
  assert.doesNotMatch(text(f.render()), /Synthetic private account A/);
  f.unmount();
});

test('guidance and explicit 1990 calling stay available while saving, after a failure and after clearing', async () => {
  const pending = deferred(); const f = await fixture({ symptoms: ['breathingDifficulty'], apiFetch: () => pending.promise });
  const work = f.send(); await settle();
  const copy = f.symptomCare.getPatientSymptomsCopy('en');
  assert.ok(text(f.render()).includes(copy.guidance));
  await f.button(f.care.getFaceCareCopy('en').call1990).props.onPress();
  pending.reject(new Error('Synthetic offline')); await work;
  assert.ok(text(f.render()).includes(copy.guidance)); assert.equal(f.states[3], null);
  f.button(copy.reset).props.onPress(); f.render();
  assert.equal(f.snapshots.at(-1).urgent, false); assert.equal(f.snapshots.at(-1).reportedAt, null);
  await f.button(f.care.getFaceCareCopy('en').call1990).props.onPress();
  assert.deepEqual(f.calls, ['tel:1990', 'tel:1990']); f.unmount();
});

test('a Share failure is local and does not create a care request', async () => {
  const f = await fixture({ shareFailure: true, symptoms: ['chestPain'] });
  await f.button(f.symptomCare.getPatientSymptomsCopy('en').share).props.onPress();
  assert.equal(f.states[4], 'share'); assert.equal(f.requests.length, 0);
  assert.ok(text(f.render()).includes(f.symptomCare.getPatientSymptomsCopy('en').shareFailed)); f.unmount();
});

test('a currentUser change before the auth listener cannot send or share the former account report', async () => {
  for (const action of ['send', 'share']) {
    const f = await fixture({ symptoms: ['chestPain'], note: 'Synthetic private former-account note.' });
    // Intentionally do not invoke the auth listener: Firebase may notify after
    // currentUser changes, and an existing handler must still check ownership.
    f.auth.currentUser = { uid: 'synthetic-patient-b' };
    if (action === 'send') await f.send(); else await f.button(f.symptomCare.getPatientSymptomsCopy('en').share).props.onPress();
    f.render(); assert.equal(f.requests.length, 0); assert.equal(f.shares.length, 0);
    assert.equal(f.states[1], ''); assert.equal(f.states[0].length, 0); assert.equal(f.snapshots.at(-1).reportedAt, null);
    f.unmount();
  }
});
