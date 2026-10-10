// Offline session regressions: fake timers, deferred requests and synthetic frames.
// No camera, cloud service, medical data or detector weights are used.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');
const project = path.resolve(__dirname, '..');
const esbuild = require(path.join(project, '1-ui-ux/node_modules/esbuild'));
const helpers = import(pathToFileURL(path.join(project, 'shared/liveFace.js')));
const providerHelpers = import(pathToFileURL(path.join(project, 'shared/faceProviderStatus.js')));
const source = fs.readFileSync(path.join(project, '5-patient/src/liveFaceSession.js'), 'utf8');
const moduleFixture = { exports: {} };
vm.runInNewContext(esbuild.transformSync(source, { format: 'cjs', target: 'es2020' }).code,
  { module: moduleFixture, exports: moduleFixture.exports, AbortController, Date, setTimeout, clearTimeout });
const { createLiveFrameLoop, createCloudFrameSampler, captureLiveCameraImage, isLiveFrameFresh } = moduleFixture.exports;

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function settle() { for (let i = 0; i < 8; i++) await Promise.resolve(); }
function fakeClock() {
  let now = Date.UTC(2026, 9, 5, 12), sequence = 0;
  const timers = new Map();
  return {
    clock: () => now,
    advance(milliseconds) { now += milliseconds; },
    schedule(callback, delay) { const id = ++sequence; timers.set(id, { callback, at: now + delay, delay }); return id; },
    cancel(id) { timers.delete(id); },
    pending: () => timers.size,
    nextDelay() { const task = [...timers.values()].sort((a, b) => a.at - b.at)[0]; return task ? task.at - now : null; },
    fire() {
      const entry = [...timers.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      assert.ok(entry, 'expected a scheduled tick');
      const [id, task] = entry;
      timers.delete(id); now = Math.max(now, task.at);
      return { completion: Promise.resolve(task.callback()) };
    },
  };
}
function photo(key = 'synthetic-frame') { return { key, uri: 'offline://synthetic', width: 640, height: 480 }; }
function detected(request) { return { id: request.id, width: request.image.width, height: request.image.height, faces: [] }; }
function localFixture(overrides = {}) {
  const time = fakeClock(), frames = [], errors = [];
  let uid = 'synthetic-account-a';
  const capture = overrides.capture || (async () => photo());
  const loop = createLiveFrameLoop({ capture, detect: async request => detected(request),
    onFrame: frame => frames.push(frame), onError: error => errors.push(error), getUid: () => uid,
    clock: time.clock, schedule: time.schedule, cancel: time.cancel, ...overrides });
  return { loop, time, frames, errors, setUid(value) { uid = value; } };
}
function cloudFixture(overrides = {}) {
  const time = fakeClock(), reports = [], errors = [], calls = [];
  let uid = 'synthetic-account-a';
  const sampler = createCloudFrameSampler({ getUid: () => uid, clock: time.clock,
    analyze: async (image, signal) => { calls.push({ image, signal }); return { synthetic: true }; },
    onReport: result => reports.push(result), onError: error => errors.push(error), ...overrides });
  return { sampler, time, reports, errors, calls, setUid(value) { uid = value; } };
}

test('local loop requires a signed-in session and starts only one scheduled tick', async () => {
  const f = localFixture();
  f.setUid(null); f.loop.start();
  assert.equal(f.loop.active(), false); assert.equal(f.time.pending(), 0);
  f.setUid('synthetic-account-a'); f.loop.start(); f.loop.start();
  assert.equal(f.loop.active(), true); assert.equal(f.time.pending(), 1);
  await f.time.fire().completion;
  assert.equal(f.frames.length, 1); assert.equal(f.time.pending(), 1);
  f.loop.stop(); assert.equal(f.time.pending(), 0);
});

test('local capture and inference remain single-inflight during stop/restart and repeated starts', async () => {
  const capture = deferred(); let captureCalls = 0, detectCalls = 0;
  const f = localFixture({ capture: () => { captureCalls += 1; return captureCalls === 1 ? capture.promise : Promise.resolve(photo('new-session')); },
    detect: async request => { detectCalls += 1; return detected(request); } });
  f.loop.start(); const oldTick = f.time.fire();
  assert.equal(f.loop.busy(), true); assert.equal(captureCalls, 1); assert.equal(f.time.pending(), 0);
  f.loop.start(); assert.equal(f.time.pending(), 0);
  f.loop.stop(); f.loop.start(); f.loop.start();
  await f.time.fire().completion;
  assert.equal(captureCalls, 1); assert.equal(detectCalls, 0); assert.equal(f.time.pending(), 1);
  assert.equal(f.time.nextDelay(), 25);
  capture.resolve(photo('old-session')); await oldTick.completion;
  assert.equal(detectCalls, 0); assert.equal(f.frames.length, 0); assert.equal(f.loop.busy(), false);
  await f.time.fire().completion;
  assert.equal(captureCalls, 2); assert.equal(detectCalls, 1); assert.equal(f.frames[0].image.key, 'new-session');
  f.loop.stop();
});

test('local sampling schedules the remainder of the interval and yields after slow inference', async () => {
  let cycle = 0;
  const f = localFixture({ capture: async () => { f.time.advance(40); return photo(); },
    detect: async request => { f.time.advance(++cycle === 1 ? 60 : 1060); return detected(request); } });
  f.loop.start(); await f.time.fire().completion;
  assert.equal(f.frames[0].elapsedMs, 100); assert.equal(f.time.nextDelay(), 150);
  await f.time.fire().completion;
  assert.equal(f.frames[1].elapsedMs, 1100); assert.equal(f.time.nextDelay(), 25);
  assert.notEqual(f.frames[0].id, f.frames[1].id);
  assert.equal(f.frames[1].sampledAt, new Date(f.time.clock()).toISOString());
  f.loop.stop();
});

test('fast local results publish every 250ms without queuing extra camera captures', async () => {
  let captures = 0;
  const f = localFixture({ capture: async () => { captures++; f.time.advance(35); return photo(); },
    detect: async request => { f.time.advance(65); return detected(request); } });
  f.loop.start();
  for (let i = 0; i < 5; i++) {
    await f.time.fire().completion;
    assert.equal(f.time.pending(), 1); assert.equal(f.loop.busy(), false);
  }
  assert.equal(captures, 5); assert.equal(f.frames.length, 5);
  for (let i = 1; i < f.frames.length; i++) assert.equal(Date.parse(f.frames[i].sampledAt) - Date.parse(f.frames[i - 1].sampledAt), 250);
  assert.equal(f.time.nextDelay(), 150); f.loop.stop();
});

test('slow local inference publishes immediately and yields only 25ms before the next sample', async () => {
  const f = localFixture({ capture: async () => { f.time.advance(120); return photo(); },
    detect: async request => { f.time.advance(680); return detected(request); } });
  f.loop.start(); await f.time.fire().completion;
  assert.equal(f.frames.length, 1); assert.equal(f.frames[0].elapsedMs, 800); assert.equal(f.time.nextDelay(), 25);
  await f.time.fire().completion;
  assert.equal(Date.parse(f.frames[1].sampledAt) - Date.parse(f.frames[0].sampledAt), 825); f.loop.stop();
});

function cameraFixture(overrides = {}) {
  const released = [], deleted = [], inputs = [], resized = [], options = [];
  const raw = { nativeRefType: 'image', width: 3024, height: 4032, release: () => released.push('camera') };
  const encoded = { uri: 'file://capture-cache/generated.jpg', base64: 'c3ludGhldGlj', width: 480, height: 640 };
  const rendered = { release: () => released.push('rendered'), saveAsync: async () => encoded };
  const context = { release: () => released.push('context'), resize: size => resized.push(size), renderAsync: async () => rendered };
  const deps = { platform: 'android', camera: { takePictureAsync: async value => { options.push(value); return raw; } },
    ImageManipulator: { manipulate: source => { inputs.push(source); return context; } }, SaveFormat: { JPEG: 'jpeg' },
    deleteFile: async (uri, value) => deleted.push({ uri, value }), clock: () => Date.UTC(2026, 9, 6, 8), ...overrides };
  return { deps, raw, encoded, rendered, context, released, deleted, inputs, resized, options };
}

test('native live capture uses an oriented in-memory image and releases all native resources', async () => {
  for (const platform of ['android', 'ios']) {
    const f = cameraFixture({ platform }); const result = await captureLiveCameraImage(f.deps);
    assert.equal(f.options[0].pictureRef, true); assert.equal(f.options[0].skipProcessing, false); assert.equal(f.options[0].shutterSound, false);
    assert.equal(f.inputs[0], f.raw, 'send the native image directly rather than a capture cache file');
    assert.deepEqual(JSON.parse(JSON.stringify(f.resized)), [{ height: 640 }]);
    assert.equal(result.dataUri, 'data:image/jpeg;base64,c3ludGhldGlj'); assert.equal(result.width, 480); assert.equal(result.height, 640);
    assert.equal(result.capturedAt, '2026-10-06T08:00:00.000Z'); assert.deepEqual(f.released, ['rendered', 'context', 'camera']);
    assert.deepEqual(JSON.parse(JSON.stringify(f.deleted)), [{ uri: 'file://capture-cache/generated.jpg', value: { idempotent: true } }]);
  }
});

test('a small web JPEG retains its exact pixels without another decode or JPEG recompression', async () => {
  const f = cameraFixture({ platform: 'web' });
  f.deps.camera.takePictureAsync = async options => { f.options.push(options); return { uri: 'data:image/jpeg;base64,d2ViZnJhbWU=', width: 640, height: 480 }; };
  const result = await captureLiveCameraImage(f.deps);
  assert.equal(f.options[0].imageType, 'jpg'); assert.equal(f.options[0].pictureRef, undefined); assert.equal(f.options[0].skipProcessing, false);
  assert.equal(result.dataUri, 'data:image/jpeg;base64,d2ViZnJhbWU='); assert.equal(result.width, 640); assert.equal(result.height, 480);
  assert.equal(f.inputs.length, 0); assert.equal(f.deleted.length, 0);
});

test('large web frames are resized and only generated capture files are deleted', async () => {
  const f = cameraFixture({ platform: 'web' });
  f.deps.camera.takePictureAsync = async () => ({ uri: 'data:image/jpeg;base64,d2ViZnJhbWU=', width: 1920, height: 1080 });
  f.encoded.width = 640; f.encoded.height = 360;
  const result = await captureLiveCameraImage(f.deps);
  assert.equal(result.width, 640); assert.equal(result.height, 360);
  assert.deepEqual(JSON.parse(JSON.stringify(f.resized)), [{ width: 640 }]);
  assert.deepEqual(f.deleted.map(value => value.uri), ['file://capture-cache/generated.jpg']);
});

test('capture normalization failures still release camera memory and generated cache images', async () => {
  for (const failure of ['render', 'encoded']) {
    const f = cameraFixture();
    if (failure === 'render') f.context.renderAsync = async () => { throw new Error('synthetic-normalization-error'); };
    else f.encoded.width = 0;
    await assert.rejects(captureLiveCameraImage(f.deps), failure === 'render' ? /synthetic-normalization-error/ : /camera/);
    assert.ok(f.released.includes('context')); assert.ok(f.released.includes('camera'));
    if (failure === 'encoded') { assert.ok(f.released.includes('rendered')); assert.deepEqual(f.deleted.map(value => value.uri), ['file://capture-cache/generated.jpg']); }
  }
});

test('invalid camera dimensions never reach local inference or the image manipulator', async () => {
  const f = cameraFixture(); f.raw.width = NaN;
  await assert.rejects(captureLiveCameraImage(f.deps), /camera/);
  assert.equal(f.inputs.length, 0); assert.deepEqual(f.released, ['camera']);
});

test('cache deletion failures preserve a healthy captured frame and release native memory', async () => {
  for (const rejectAsync of [true, false]) {
    const f = cameraFixture({ deleteFile: rejectAsync
      ? async () => { throw new Error('synthetic-cache-refusal'); }
      : () => { throw new Error('synthetic-cache-refusal'); } });
    const result = await captureLiveCameraImage(f.deps);
    assert.equal(result.width, 480); assert.equal(result.height, 640);
    assert.equal(result.dataUri, 'data:image/jpeg;base64,c3ludGhldGlj');
    assert.deepEqual(f.released, ['rendered', 'context', 'camera']);
  }
});

function transpile(file, imports, runtime = {}) {
  const fixture = { exports: {} };
  const code = esbuild.transformSync(fs.readFileSync(path.join(project, file), 'utf8'), { loader: 'jsx', format: 'cjs', target: 'es2020' }).code;
  vm.runInNewContext(code, { module: fixture, exports: fixture.exports, require: id => {
    if (!(id in imports)) throw new Error('Unexpected screen import: ' + id);
    return imports[id];
  }, console, Date, setTimeout, clearTimeout, setInterval, clearInterval, AbortController, ...runtime });
  return fixture.exports;
}

// Preserve the logical slots used by the existing screen behavior fixtures.
// The two new panels own their engine tests; their snapshot hooks are separate.
const screenStateSlot = index => index === 13 ? 'movementSnapshot' : index === 14 ? 'symptomSnapshot' : index > 14 ? index - 2 : index;
const screenRefSlot = index => index === 0 ? 'movementSnapshotRef' : index === 1 ? 'symptomSnapshotRef' : index - 2;
function advancedScreenImports(live) {
  const faceCare = transpile('shared/faceCare.js', {});
  return {
    '../components/FacialObservationPanel': { default: 'FacialObservationPanel' },
    '../components/FaceMonitoringGuide': { default: 'FaceMonitoringGuide' },
    '../components/VocalToneModal': { default: 'VocalToneModal' },
    '../../../shared/facialObservations.js': transpile('shared/facialObservations.js', { './liveFace.js': live }),
    '../../../shared/patientSymptoms.js': transpile('shared/patientSymptoms.js', { './faceCare.js': faceCare }),
    '../../../shared/faceGuide.js': transpile('shared/faceGuide.js', {}),
  };
}

function renderCameraScreen(language, current, live, options = {}) {
  let stateIndex = 0, refIndex = 0;
  const states = options.states || { 0: language, 2: true, 3: true, 14: true, 15: current, 16: 'running' };
  const React = { Fragment: 'Fragment', createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    useState: initial => { const index = screenStateSlot(stateIndex++); if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial;
      return [states[index], value => { states[index] = typeof value === 'function' ? value(states[index]) : value; }]; },
    useRef: initial => { const index = screenRefSlot(refIndex++); if (!options.refs) return { current: initial };
      return options.refs[index] ||= { current: initial }; }, useEffect: (effect, dependencies) => options.effects?.push({ effect, dependencies }), useCallback: fn => fn };
  const native = { StyleSheet: { create: value => value, absoluteFillObject: {} }, Platform: { OS: options.platform || 'android' },
    AppState: { addEventListener: () => ({ remove() {} }) } };
  for (const component of ['View', 'Text', 'TouchableOpacity', 'ActivityIndicator', 'ScrollView', 'Image', 'TextInput']) native[component] = component;
  const faceUi = transpile('5-patient/src/faceUi.js', {});
  const photo = transpile('5-patient/src/faceReport.js', {});
  const copy = transpile('5-patient/src/liveMobileCopy.js', { '../../shared/liveFace.js': live });
  const quality = transpile('shared/liveFaceQuality.js', { './liveFace.js': live });
  const provider = transpile('shared/faceProviderStatus.js', {});
  const screen = transpile('5-patient/src/screens/LiveEmotionScreen.js', {
    '../../app.json': { expo: { version: options.appVersion || 'synthetic-build' } },
    react: React, 'react-native': native, 'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    '@expo/vector-icons': { MaterialCommunityIcons: 'Icon' },
    'expo-camera': { CameraView: 'CameraView', useCameraPermissions: () => [{ granted: true }, async () => ({ granted: true })] },
    'expo-image-picker': {}, 'expo-image-manipulator': {}, 'expo-file-system/legacy': {}, 'firebase/auth': {},
    '../apiHelper': options.api || {}, '../firebase/config': { auth: options.auth || { currentUser: { uid: 'synthetic-account-a' } } },
    '../faceUi': faceUi, '../faceReport': photo, '../../../shared/liveFace.js': live, '../liveMobileCopy': copy,
    '../liveFaceSession': options.session || moduleFixture.exports, '../components/LiveFaceBridge': { default: 'Bridge' },
    '../components/FaceCareHelpPanel': { default: 'FaceCareHelpPanel' }, '../components/FaceExpressionCheckIn': { default: 'FaceExpressionCheckIn' }, '../../../shared/liveFaceQuality.js': quality,
    '../components/EmotionCheckInPicker': { default: 'EmotionCheckInPicker' },
    '../../../shared/emotionCheckInCatalog.js': transpile('shared/emotionCheckInCatalog.js', {}),
    '../../../shared/faceProviderStatus.js': provider,
    ...advancedScreenImports(live),
  }, options.runtime);
  return screen.default({ navigation: { goBack() {} } });
}

function photoScreenFixture(live, { deleteFile, encodeError = false } = {}) {
  const selected = { id: 1, ownerUid: 'synthetic-account-a', width: 1600, height: 1200,
    dataUri: 'data:image/jpeg;base64,c3ludGhldGljLXNvdXJjZQ==', capturedAt: '2026-10-07T12:00:00.000Z' };
  const encoded = { uri: 'file://synthetic-cache/normalized.jpg', base64: 'c3ludGhldGljLW5vcm1hbGl6ZWQ=', width: 640, height: 480 };
  const states = { 1: selected, 14: true }, effects = [], analyzed = [], released = [], deleted = [];
  let stateIndex = 0, refIndex = 0;
  const bridge = { waitForIdle: async () => {}, analyze: async (image, options) => {
    analyzed.push({ ...image, detector: options?.detector });
    return { version: 'live-face-v1', provider: 'face-api.js-local', width: image.width, height: image.height,
      capturedAt: image.capturedAt, processingTimeMs: 10, faces: [] };
  } };
  const React = { Fragment: 'Fragment', createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    useState: initial => { const index = screenStateSlot(stateIndex++); if (!(index in states)) states[index] = initial;
      return [states[index], value => { states[index] = typeof value === 'function' ? value(states[index]) : value; }]; },
    useRef: initial => ({ current: screenRefSlot(refIndex++) === 11 ? bridge : initial }), useCallback: fn => fn,
    useEffect: (effect, dependencies) => { if (dependencies?.length === 2 && dependencies[0] === selected.id && dependencies[1] === true) effects.push(effect); } };
  const native = { StyleSheet: { create: value => value, absoluteFillObject: {} }, Platform: { OS: 'android' } };
  for (const component of ['View', 'Text', 'TouchableOpacity', 'ActivityIndicator', 'ScrollView', 'Image', 'TextInput']) native[component] = component;
  const rendered = { release: () => released.push('rendered'), saveAsync: async () => {
    if (encodeError) throw new Error('synthetic-encoding-failure');
    return encoded;
  } };
  const context = { resize() {}, renderAsync: async () => rendered, release: () => released.push('context') };
  const screen = transpile('5-patient/src/screens/LiveEmotionScreen.js', {
    '../../app.json': { expo: { version: 'synthetic-build' } },
    react: React, 'react-native': native, 'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    '@expo/vector-icons': { MaterialCommunityIcons: 'Icon' },
    'expo-camera': { CameraView: 'CameraView', useCameraPermissions: () => [{ granted: true }, async () => ({ granted: true })] },
    'expo-image-picker': {}, 'expo-image-manipulator': { ImageManipulator: { manipulate: () => context }, SaveFormat: { JPEG: 'jpeg' } },
    'expo-file-system/legacy': { deleteAsync: (uri, options) => { deleted.push({ uri, options }); return deleteFile?.(uri, options); } },
    'firebase/auth': {}, '../apiHelper': {}, '../firebase/config': { auth: { currentUser: { uid: selected.ownerUid } } },
    '../faceUi': transpile('5-patient/src/faceUi.js', {}), '../faceReport': transpile('5-patient/src/faceReport.js', {}),
    '../../../shared/liveFace.js': live, '../liveMobileCopy': transpile('5-patient/src/liveMobileCopy.js', { '../../shared/liveFace.js': live }),
    '../liveFaceSession': moduleFixture.exports, '../components/LiveFaceBridge': { default: 'Bridge' },
    '../components/FaceCareHelpPanel': { default: 'FaceCareHelpPanel' }, '../components/FaceExpressionCheckIn': { default: 'FaceExpressionCheckIn' },
    '../components/EmotionCheckInPicker': { default: 'EmotionCheckInPicker' },
    '../../../shared/emotionCheckInCatalog.js': transpile('shared/emotionCheckInCatalog.js', {}),
    '../../../shared/liveFaceQuality.js': transpile('shared/liveFaceQuality.js', { './liveFace.js': live }),
    '../../../shared/faceProviderStatus.js': transpile('shared/faceProviderStatus.js', {}),
    ...advancedScreenImports(live),
  });
  screen.default({ navigation: { goBack() {} } });
  assert.equal(effects.length, 1, 'run the actual selected-photo normalization effect');
  effects[0]();
  return { selected, encoded, states, analyzed, released, deleted };
}

test('selected-photo inference survives cache cleanup failures while retaining the original cloud photo', async () => {
  const live = await helpers;
  for (const asyncFailure of [true, false]) {
    const f = photoScreenFixture(live, { deleteFile: asyncFailure
      ? async () => { throw new Error('synthetic-cache-refusal'); }
      : () => { throw new Error('synthetic-cache-refusal'); } });
    for (let i = 0; i < 4; i++) await settle();
    assert.equal(f.states[24], 'ready'); assert.equal(f.analyzed.length, 1);
    assert.equal(f.analyzed[0].dataUri, 'data:image/jpeg;base64,' + f.encoded.base64);
    assert.equal(f.analyzed[0].width, 640); assert.equal(f.analyzed[0].height, 480);
    assert.equal(f.analyzed[0].detector, 'ssd');
    assert.equal(f.states[23].sourceDataUri, f.selected.dataUri); assert.equal(f.states[23].ownerUid, f.selected.ownerUid);
    assert.deepEqual(f.released, ['rendered', 'context']);
    assert.deepEqual(f.deleted.map(value => value.uri), [f.encoded.uri]);
    assert.equal(f.selected.width, 1600); assert.equal(f.selected.height, 1200);
  }
});

test('selected-photo encoding failures remain visible and never reach local inference', async () => {
  const f = photoScreenFixture(await helpers, { encodeError: true });
  await settle();
  assert.equal(f.states[24], 'error'); assert.equal(f.states[23], null); assert.equal(f.analyzed.length, 0);
  assert.deepEqual(f.released, ['rendered', 'context']); assert.deepEqual(f.deleted, []);
});
function screenText(node) {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(screenText).join(' ');
  return node?.children ? node.children.map(screenText).join(' ') : '';
}
function findScreenNode(node, predicate) {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node)) { for (const child of node) { const found = findScreenNode(child, predicate); if (found) return found; } return null; }
  if (predicate(node)) return node;
  return findScreenNode(node.children, predicate);
}

test('the face screen identifies its build version and studio consistently in all three languages', async () => {
  const live = await helpers;
  for (const language of ['en', 'ta', 'si']) {
    const text = screenText(renderCameraScreen(language, null, live, { appVersion: '1.0.6' }));
    assert.ok(text.includes('1.0.6'));
    assert.ok(text.includes(live.getLiveFaceCopy(language).studio));
    assert.equal(text.includes('Live Emotion Radar'), false);
  }
});

test('live results update outside the unobstructed camera with raw scores and uncertainty explanations in all three languages', async () => {
  const live = await helpers;
  const face = expression => ({ id: 'face-1', box: { x: .2, y: .2, width: .4, height: .5 }, landmarks: [], stable: true,
    expression, expressionConfidence: .8, detectionConfidence: .98,
    scores: Object.fromEntries(live.LIVE_EXPRESSIONS.map(key => [key, key === expression ? .8 : .2 / 6])),
    smoothedScores: Object.fromEntries(live.LIVE_EXPRESSIONS.map(key => [key, key === expression ? .8 : .2 / 6])) });
  const frame = faces => { const capturedAt = new Date().toISOString(); return { faces, capturedAt, completedAt: capturedAt, width: 640, height: 480, image: { width: 640, height: 480, dataUri: 'data:image/jpeg;base64,c3ludGhldGlj' }, fps: 4 }; };
  for (const language of ['en', 'ta', 'si']) {
    const copy = live.getLiveFaceCopy(language);
    for (const expression of ['happy', 'sad']) {
      const tree = renderCameraScreen(language, frame([face(expression)]), live);
      const panel = findScreenNode(tree, node => node.type === 'View' && node.props.testID === 'live-expression-results');
      assert.ok(panel, 'latest results must remain next to the camera');
      assert.equal(panel.props.style.position, undefined, 'results must not cover the face');
      const text = screenText(panel);
      assert.ok(text.includes(copy.expressions[expression])); assert.ok(text.includes(live.expressionEmoji[expression]));
      assert.ok(text.includes('80.0%')); assert.ok(text.includes(copy.updateRate)); assert.ok(text.includes('4.0'));
      assert.ok(text.includes(copy.highestModelScore)); assert.ok(text.includes(copy.rawModelScores));
      for (const key of live.LIVE_EXPRESSIONS) assert.ok(text.includes(copy.expressions[key]));
      const stage = findScreenNode(tree, node => node.type === 'View' && node.props.style?.height === 390);
      assert.ok(stage); assert.equal(screenText(stage).includes(copy.highestModelScore), false);
      const camera = findScreenNode(tree, node => node.type === 'CameraView'); assert.ok(camera);
      assert.deepEqual(camera.props.style, {}, 'the uninterrupted live camera always fills the main stage');
      const analyzed = findScreenNode(tree, node => node.type === 'Image' && node.props.accessibilityLabel !== undefined);
      assert.equal(analyzed.props.style.width, 102, 'the analyzed photograph is a small, labeled thumbnail');
    }
    const tree = renderCameraScreen(language, frame([]), live);
    const panel = findScreenNode(tree, node => node.type === 'View' && node.props.testID === 'live-expression-results');
    assert.ok(screenText(panel).includes(copy.noFaces)); assert.equal(screenText(panel).includes('80.0%'), false);
    const uncertainScores = Object.fromEntries(live.LIVE_EXPRESSIONS.map(key => [key, key === 'sad' ? .3 : .7 / 6]));
    const uncertain = { ...face('sad'), expression: 'uncertain', stable: false, expressionConfidence: .3,
      scores: uncertainScores, smoothedScores: uncertainScores, uncertaintyReason: 'weak-expression-score' };
    const uncertainTree = renderCameraScreen(language, frame([uncertain]), live);
    const uncertainPanel = findScreenNode(uncertainTree, node => node.type === 'View' && node.props.testID === 'live-expression-results');
    const uncertainText = screenText(uncertainPanel);
    assert.ok(uncertainText.includes(copy.expressions.uncertain)); assert.ok(uncertainText.includes(copy.notConfirmed));
    assert.ok(uncertainText.includes('30.0%')); assert.ok(uncertainText.includes(copy.highestModelScore));
    assert.ok(uncertainText.includes(copy.uncertaintyReasons['weak-expression-score']));
  }
});

test('local results retain the exact sampled photo and dimensions', async () => {
  const image = photo('exact-photo');
  const f = localFixture({ capture: async () => image });
  f.loop.start(); await f.time.fire().completion;
  assert.equal(f.frames[0].image, image);
  assert.equal(f.frames[0].width, image.width); assert.equal(f.frames[0].height, image.height);
  assert.equal(f.errors.length, 0); f.loop.stop();
});

test('stopping during capture cancels timers and never launches inference for the discarded photo', async () => {
  const gate = deferred(); let detectedCount = 0;
  const f = localFixture({ capture: () => gate.promise, detect: async request => { detectedCount++; return detected(request); } });
  f.loop.start(); const tick = f.time.fire(); f.loop.stop();
  gate.resolve(photo()); await tick.completion;
  assert.equal(detectedCount, 0); assert.equal(f.frames.length, 0); assert.equal(f.errors.length, 0);
  assert.equal(f.loop.active(), false); assert.equal(f.loop.busy(), false); assert.equal(f.time.pending(), 0);
});

test('stopping during inference suppresses both late results and late failures', async () => {
  for (const outcome of ['resolve', 'reject']) {
    const gate = deferred(); let request;
    const f = localFixture({ detect: value => { request = value; return gate.promise; } });
    f.loop.start(); const tick = f.time.fire(); await settle();
    assert.ok(request); f.loop.stop();
    if (outcome === 'resolve') gate.resolve(detected(request)); else gate.reject(new Error('synthetic-late-error'));
    await tick.completion;
    assert.equal(f.frames.length, 0); assert.equal(f.errors.length, 0); assert.equal(f.time.pending(), 0);
  }
});

test('UID changes cannot publish old frames and stop the old local loop', async () => {
  const gate = deferred(); let request;
  const f = localFixture({ detect: value => { request = value; return gate.promise; } });
  f.loop.start(); const tick = f.time.fire(); await settle();
  f.setUid('synthetic-account-b'); gate.resolve(detected(request)); await tick.completion;
  assert.equal(f.frames.length, 0); assert.equal(f.errors.length, 0);
  await f.time.fire().completion;
  assert.equal(f.loop.active(), false); assert.equal(f.time.pending(), 0);
  f.loop.start(); assert.equal(f.loop.active(), true); f.loop.stop();
});

test('a restarted local session does not revive an old inference result', async () => {
  const gate = deferred(); let request, calls = 0;
  const f = localFixture({ detect: value => { calls++; if (calls === 1) { request = value; return gate.promise; } return Promise.resolve(detected(value)); } });
  f.loop.start(); const tick = f.time.fire(); await settle();
  f.loop.stop(); f.setUid('synthetic-account-b'); f.loop.start();
  await f.time.fire().completion;
  assert.equal(calls, 1); gate.resolve(detected(request)); await tick.completion;
  assert.equal(f.frames.length, 0);
  await f.time.fire().completion;
  assert.equal(f.frames.length, 1); assert.notEqual(f.frames[0].id, request.id);
  f.loop.stop();
});

test('mismatched frame identifiers or dimensions terminate detection without publishing a report', async () => {
  const bad = [() => null, request => ({ ...detected(request), id: 'wrong-request' }),
    request => ({ ...detected(request), width: 320 }), request => ({ ...detected(request), height: 240 })];
  for (const result of bad) {
    const f = localFixture({ detect: async request => result(request) });
    f.loop.start(); await f.time.fire().completion;
    assert.equal(f.frames.length, 0); assert.equal(f.errors.length, 1); assert.equal(f.errors[0].message, 'mismatched_frame');
    assert.equal(f.loop.active(), false); assert.equal(f.loop.busy(), false); assert.equal(f.time.pending(), 0);
  }
});

test('unrecoverable inference and explicitly non-retryable capture failures stop the loop once', async () => {
  for (const stage of ['capture', 'detect']) {
    const failure = new Error('synthetic-' + stage + '-failure');
    const f = localFixture({ [stage]: async () => { throw failure; }, maxCaptureRetries: 0 });
    f.loop.start(); await f.time.fire().completion;
    assert.equal(f.errors.length, 1); assert.equal(f.errors[0], failure); assert.equal(f.frames.length, 0);
    assert.equal(f.loop.active(), false); assert.equal(f.time.pending(), 0);
  }
});

test('two transient capture failures recover with bounded backoff and publish only the new exact frame', async () => {
  let captures = 0, detections = 0;
  const recovering = [];
  const f = localFixture({ capture: async () => {
    captures++;
    if (captures <= 2) throw new Error('synthetic-transient-camera');
    return photo('recovered-camera-frame');
  }, detect: async request => { detections++; return detected(request); }, onRecovering: (error, attempt) => recovering.push({ error, ...attempt }) });
  f.loop.start(); await f.time.fire().completion;
  assert.equal(f.frames.length, 0); assert.equal(f.errors.length, 0); assert.equal(f.loop.busy(), false);
  assert.equal(f.time.nextDelay(), 375); assert.equal(f.time.pending(), 1);
  await f.time.fire().completion;
  assert.equal(f.frames.length, 0); assert.equal(f.time.nextDelay(), 750);
  await f.time.fire().completion;
  assert.equal(captures, 3); assert.equal(detections, 1); assert.equal(f.frames.length, 1);
  assert.equal(f.frames[0].image.key, 'recovered-camera-frame'); assert.equal(f.errors.length, 0);
  assert.deepEqual(recovering.map(value => value.attempt), [1, 2]);
  f.loop.stop(); assert.equal(f.time.pending(), 0);
});

test('persistent camera failures terminate after two retries without an infinite capture loop', async () => {
  let captures = 0, recovering = 0;
  const failure = new Error('synthetic-camera-unavailable');
  const f = localFixture({ capture: async () => { captures++; throw failure; }, onRecovering: () => recovering++ });
  f.loop.start(); for (let i = 0; i < 3; i++) await f.time.fire().completion;
  assert.equal(captures, 3); assert.equal(recovering, 2); assert.equal(f.errors.length, 1);
  assert.equal(f.errors[0], failure); assert.equal(f.frames.length, 0); assert.equal(f.loop.active(), false);
  assert.equal(f.time.pending(), 0);
});

test('signing out or stopping between capture retries prevents further camera work', async () => {
  for (const signOut of [true, false]) {
    let captures = 0;
    const f = localFixture({ capture: async () => { captures++; throw new Error('synthetic-camera-retry'); } });
    f.loop.start(); await f.time.fire().completion;
    if (signOut) { f.setUid(null); await f.time.fire().completion; } else f.loop.stop();
    assert.equal(captures, 1); assert.equal(f.frames.length, 0); assert.equal(f.errors.length, 0);
    assert.equal(f.loop.active(), false); assert.equal(f.time.pending(), 0);
  }
});

test('frame freshness expires after 1.5 seconds and never accepts invalid or future capture timestamps', () => {
  const now = Date.now();
  assert.equal(isLiveFrameFresh({ capturedAt: new Date(now - 1500).toISOString() }, now), true);
  assert.equal(isLiveFrameFresh({ capturedAt: new Date(now - 1501).toISOString() }, now), false);
  for (const capturedAt of [undefined, 'invalid', new Date(now + 1).toISOString()]) assert.equal(isLiveFrameFresh({ capturedAt }, now), false);
});

function trackedCameraFrame(live, now) {
  const scores = Object.fromEntries(live.LIVE_EXPRESSIONS.map(expression => [expression, expression === 'happy' ? .8 : .2 / 6]));
  const face = { box: { x: .2, y: .2, width: .4, height: .5 }, detectionConfidence: .99, scores,
    landmarks: Array.from({ length: 68 }, (_, index) => ({ x: .25 + (index % 8) * .025, y: .3 + Math.floor(index / 8) * .025 })) };
  const tracker = live.createLiveFaceTracker();
  let current;
  for (const age of [500, 250, 0]) current = tracker.update({ version: 'live-face-v1', provider: 'face-api.js-local', width: 640, height: 480,
    capturedAt: new Date(now - age).toISOString(), processingTimeMs: 30, faces: [face] });
  return { ...current, ownerUid: 'synthetic-account-a', fps: 4, completedAt: new Date(now).toISOString(),
    image: { width: 640, height: 480, capturedAt: current.capturedAt, dataUri: 'data:image/jpeg;base64,c3ludGhldGlj' } };
}

test('live preview geometry reflects complete face boxes and landmarks after aspect-fill cropping', () => {
  const { livePreviewFaceBox, livePreviewPoint } = transpile('5-patient/src/faceUi.js', {});
  const image = { width: 640, height: 480 }, frame = { width: 360, height: 480 };
  const box = { x: .2, y: .2, width: .4, height: .5 };
  const ordinary = livePreviewFaceBox(box, image, frame), mirrored = livePreviewFaceBox(box, image, frame, { mirrored: true });
  assert.equal(ordinary.left, -12); assert.equal(mirrored.left, 116);
  assert.equal(mirrored.top, 96); assert.equal(mirrored.width, 256); assert.equal(mirrored.height, 240);
  const landmark = livePreviewPoint({ x: .25, y: .3 }, image, frame, { mirrored: true });
  assert.equal(landmark.left, 340); assert.equal(landmark.top, 144);
  // Reflecting a box requires subtracting its width; reflecting only its left
  // point would incorrectly put the box's entire width past the face.
  assert.notEqual(mirrored.left, livePreviewPoint({ x: box.x, y: box.y }, image, frame, { mirrored: true }).left);
});

test('live preview horizontal reflection stays exact for portrait, landscape and differently cropped layouts', () => {
  const { livePreviewFaceBox, livePreviewPoint } = transpile('5-patient/src/faceUi.js', {});
  for (const image of [{ width: 640, height: 480 }, { width: 480, height: 640 }, { width: 1920, height: 1080 }]) {
    for (const frame of [{ width: 360, height: 480 }, { width: 720, height: 300 }, { width: 400, height: 400 }]) {
      for (const box of [{ x: .05, y: .1, width: .2, height: .4 }, { x: .65, y: .2, width: .25, height: .3 }]) {
        const ordinary = livePreviewFaceBox(box, image, frame), mirrored = livePreviewFaceBox(box, image, frame, { mirrored: true });
        assert.ok(Math.abs(mirrored.left - (frame.width - ordinary.left - ordinary.width)) < 1e-9);
        assert.equal(mirrored.top, ordinary.top); assert.equal(mirrored.width, ordinary.width); assert.equal(mirrored.height, ordinary.height);
        const plainPoint = livePreviewPoint({ x: box.x, y: box.y }, image, frame);
        const mirroredPoint = livePreviewPoint({ x: box.x, y: box.y }, image, frame, { mirrored: true });
        assert.ok(Math.abs(mirroredPoint.left - (frame.width - plainPoint.left)) < 1e-9);
        assert.equal(mirroredPoint.top, plainPoint.top);
      }
    }
  }
});

test('live preview geometry rejects invalid dimensions or coordinates without rendering a false overlay', () => {
  const { livePreviewFaceBox, livePreviewPoint } = transpile('5-patient/src/faceUi.js', {});
  const image = { width: 640, height: 480 }, frame = { width: 360, height: 480 }, box = { x: .2, y: .2, width: .4, height: .5 };
  for (const invalidImage of [null, { width: 0, height: 480 }, { width: NaN, height: 480 }, { width: 640, height: Infinity }]) {
    assert.equal(livePreviewFaceBox(box, invalidImage, frame), null); assert.equal(livePreviewPoint({ x: .5, y: .5 }, invalidImage, frame), null);
  }
  for (const invalidFrame of [null, { width: 0, height: 480 }, { width: 360, height: NaN }]) assert.equal(livePreviewFaceBox(box, image, invalidFrame), null);
  for (const invalidBox of [null, { ...box, x: -.1 }, { ...box, width: 0 }, { ...box, x: .8 }, { ...box, y: NaN }]) assert.equal(livePreviewFaceBox(invalidBox, image, frame), null);
  for (const invalidPoint of [null, { x: -.1, y: .5 }, { x: .5, y: Infinity }, { x: .5, y: 1.1 }]) assert.equal(livePreviewPoint(invalidPoint, image, frame), null);
});

test('actual front camera overlays are mirrored while exact analyzed thumbnails retain source coordinates', async () => {
  const live = await helpers;
  for (const platform of ['web', 'android', 'ios']) {
    const now = Date.now(), current = trackedCameraFrame(live, now);
    const states = { 0: 'en', 2: true, 3: true, 14: true, 15: current, 16: 'running', 7: { width: 360, height: 480 } };
    const tree = renderCameraScreen('en', current, live, { states, platform });
    const camera = findScreenNode(tree, node => node.type === 'CameraView');
    assert.equal(camera.props.facing, 'front'); assert.equal(camera.props.mirror, false);
    const box = findScreenNode(tree, node => node.type === 'View' && Array.isArray(node.props.style) && node.props.style[0]?.borderColor === '#58EDBC');
    assert.ok(box); assert.equal(box.props.style[1].left, 116); assert.equal(box.props.style[1].width, 256);
    const point = findScreenNode(tree, node => node.type === 'View' && Array.isArray(node.props.style) && node.props.style[0]?.width === 3);
    assert.ok(point); assert.equal(point.props.style[1].left, 338.5); assert.equal(point.props.style[1].top, 142.5);
    const snapshotBox = findScreenNode(tree, node => node.type === 'View' && Array.isArray(node.props.style) && node.props.style[0]?.borderColor === '#A5E6D0');
    assert.ok(snapshotBox); assert.ok(Math.abs(snapshotBox.props.style[1].left - 20.4) < 1e-9);
    assert.equal(current.faces[0].box.x, .2); assert.equal(current.faces[0].landmarks[0].x, .25);
    assert.equal(current.faces[0].scores.happy, .8, 'preview reflection never changes classifier scores');
  }
});

async function frozenPhotoFixture(live) {
  const initial = trackedCameraFrame(live, Date.now()), idle = deferred(), inference = deferred();
  const states = { 0: 'en', 2: true, 3: true, 14: true, 15: initial, 16: 'running' }, refs = [], effects = [], analyzed = [];
  const auth = { currentUser: { uid: initial.ownerUid } };
  let uploads = 0, idleCalls = 0, cameraCaptures = 0;
  const bridge = { waitForIdle: () => { idleCalls++; return idle.promise; }, analyze: (image, options) => {
    analyzed.push({ image, options }); return inference.promise;
  } };
  refs[0] = { current: { takePictureAsync() { cameraCaptures++; throw new Error('must freeze the exact completed image'); } } };
  refs[11] = { current: bridge }; refs[15] = { current: initial };
  const options = { states, refs, effects, auth, api: { apiFetch: async () => { uploads++; throw new Error('no cloud upload expected'); } } };
  const render = () => { effects.length = 0; return renderCameraScreen('en', initial, live, options); };
  const cameraTree = render(), capture = findScreenNode(cameraTree, node => node.props.onPress?.name === 'capturePhoto');
  assert.ok(capture); await capture.props.onPress();
  const selected = states[1], immediate = states[23];
  assert.equal(selected.dataUri, initial.image.dataUri); assert.equal(immediate.image, initial.image);
  assert.equal(immediate.faces[0].evidenceMode, 'single-frame'); assert.equal(immediate.localDetector, undefined);
  assert.equal(cameraCaptures, 0); assert.equal(states[24], 'ready');
  render();
  const photoEffect = effects.find(item => item.dependencies?.length === 2 && item.dependencies[0] === selected.id && item.dependencies[1] === true);
  assert.ok(photoEffect, 'run the actual frozen-photo refinement effect');
  const raw = { version: 'live-face-v1', provider: 'face-api.js-local', width: selected.width, height: selected.height,
    capturedAt: selected.capturedAt, processingTimeMs: 50, faces: initial.faces };
  return { states, refs, effects, auth, analyzed, idle, inference, selected, immediate, raw, render, photoEffect,
    uploads: () => uploads, idleCalls: () => idleCalls };
}

test('freezing a Tiny live result keeps the exact immediate photo and refines it once with local SSD after idle', async () => {
  const f = await frozenPhotoFixture(await helpers), cleanup = f.photoEffect.effect();
  assert.equal(f.states[24], 'processing'); assert.equal(f.states[23], f.immediate);
  assert.equal(f.analyzed.length, 0); assert.equal(f.idleCalls(), 1);
  f.idle.resolve(); await settle();
  assert.equal(f.analyzed.length, 1); assert.equal(f.analyzed[0].options.detector, 'ssd');
  assert.equal(f.analyzed[0].image.dataUri, f.selected.dataUri);
  assert.equal(f.analyzed[0].image.width, f.selected.width); assert.equal(f.analyzed[0].image.height, f.selected.height);
  assert.equal(f.states[23], f.immediate, 'do not blank the already available exact-photo output during refinement');
  f.inference.resolve(f.raw); await settle();
  assert.equal(f.states[24], 'ready'); assert.equal(f.states[23].localDetector, 'ssd');
  assert.equal(f.states[23].sourceDataUri, f.selected.dataUri); assert.equal(f.states[23].image.dataUri, f.selected.dataUri);
  assert.equal(f.states[23].faces[0].evidenceMode, 'single-frame'); assert.equal(f.states[23].faces[0].evidenceFrames, 1);
  assert.equal(f.uploads(), 0); cleanup();
  f.render();
  const repeated = f.effects.find(item => item.dependencies?.length === 2 && item.dependencies[0] === f.selected.id && item.dependencies[1] === true);
  assert.equal(repeated.effect(), undefined); await settle();
  assert.equal(f.analyzed.length, 1); assert.equal(f.idleCalls(), 1); assert.equal(f.uploads(), 0);
});

test('frozen-photo refinement never starts after selection, account, disposal or effect cancellation while waiting for idle', async () => {
  for (const action of ['selection', 'account', 'disposal', 'cleanup']) {
    const f = await frozenPhotoFixture(await helpers), cleanup = f.photoEffect.effect();
    if (action === 'selection') f.refs[5].current = { ...f.selected, id: f.selected.id + 1, dataUri: 'data:image/jpeg;base64,ZGlmZmVyZW50' };
    else if (action === 'account') f.auth.currentUser = { uid: 'synthetic-account-b' };
    else if (action === 'disposal') f.refs[1].current = false;
    else cleanup();
    f.idle.resolve(); await settle();
    assert.equal(f.analyzed.length, 0); assert.equal(f.states[23], f.immediate); assert.equal(f.uploads(), 0); cleanup();
  }
});

test('late SSD completion cannot replace a frozen-photo result after selection, account, disposal or cleanup', async () => {
  for (const action of ['selection', 'account', 'disposal', 'cleanup']) {
    const f = await frozenPhotoFixture(await helpers), cleanup = f.photoEffect.effect();
    f.idle.resolve(); await settle(); assert.equal(f.analyzed.length, 1);
    if (action === 'selection') f.refs[5].current = { ...f.selected, id: f.selected.id + 1 };
    else if (action === 'account') f.auth.currentUser = { uid: 'synthetic-account-b' };
    else if (action === 'disposal') f.refs[1].current = false;
    else cleanup();
    f.inference.resolve(f.raw); await settle();
    assert.equal(f.states[23], f.immediate); assert.equal(f.states[23].localDetector, undefined);
    assert.equal(f.uploads(), 0); cleanup();
  }
});

test('failed SSD refinement retains the immediate exact-photo estimate and does not claim refined output', async () => {
  const f = await frozenPhotoFixture(await helpers), cleanup = f.photoEffect.effect();
  f.idle.resolve(); await settle(); f.inference.reject(new Error('synthetic-model-failure')); await settle();
  assert.equal(f.states[24], 'error'); assert.equal(f.states[23], f.immediate);
  assert.equal(f.states[23].localDetector, undefined); assert.equal(f.uploads(), 0); cleanup();
});

test('the actual camera heartbeat hides stalled expressions and live result badges in all three languages', async () => {
  const live = await helpers;
  for (const language of ['en', 'ta', 'si']) {
    let now = Date.now(), callback, cleared = 0;
    class ClockDate extends Date { static now() { return now; } }
    const frame = trackedCameraFrame(live, now);
    const states = { 0: language, 2: true, 3: true, 14: true, 15: frame, 16: 'running' };
    const effects = [], runtime = { Date: ClockDate, setInterval: (tick, delay) => { assert.equal(delay, 250); callback = tick; return 17; },
      clearInterval: id => { assert.equal(id, 17); cleared++; } };
    const tree = renderCameraScreen(language, frame, live, { states, effects, runtime });
    const copy = transpile('5-patient/src/liveMobileCopy.js', { '../../shared/liveFace.js': live }).getLiveMobileCopy(language);
    assert.ok(screenText(tree).includes(copy.expressions.happy)); assert.ok(screenText(tree).includes(live.expressionEmoji.happy));
    const heartbeat = effects.find(value => value.dependencies?.length === 3 && value.dependencies[0] === true && value.dependencies[1] === null && value.dependencies[2] === false);
    assert.ok(heartbeat, 'use the actual active-camera heartbeat effect');
    const cleanup = heartbeat.effect(); assert.equal(typeof callback, 'function');
    now += 5250; callback();
    const stale = renderCameraScreen(language, frame, live, { states, runtime });
    assert.ok(screenText(stale).includes(copy.staleFrame));
    assert.equal(screenText(stale).includes(copy.expressions.happy), false); assert.equal(screenText(stale).includes(live.expressionEmoji.happy), false);
    assert.equal(findScreenNode(stale, node => node.type === 'Text' && screenText(node) === copy.sampled), null);
    const camera = findScreenNode(stale, node => node.type === 'CameraView'); assert.ok(camera, 'camera remains available while waiting for a fresh result');
    cleanup(); assert.equal(cleared, 1);
    for (const inactive of [{ ...states, 2: false }, { ...states, 20: true }]) {
      const inactiveEffects = [];
      renderCameraScreen(language, frame, live, { states: inactive, effects: inactiveEffects, runtime });
      const noCameraHeartbeat = inactiveEffects.find(value => value.dependencies?.length === 3 && value.dependencies[1] === null && typeof value.dependencies[2] === 'boolean');
      assert.equal(noCameraHeartbeat.effect(), undefined, 'paused or closed camera starts no heartbeat');
    }
  }
});

test('slow completed mobile estimates remain visible beside a full live camera without old face overlays', async () => {
  const live = await helpers;
  for (const language of ['en', 'ta', 'si']) {
    const now = Date.now();
    const fast = trackedCameraFrame(live, now);
    const slow = { ...fast, capturedAt: new Date(now - 21000).toISOString(), completedAt: new Date(now).toISOString(),
      processingTimeMs: 21000, sampledAnalysis: true,
      faces: fast.faces.map(face => ({ ...face, evidenceMode: 'single-frame', evidenceFrames: 1, evidenceDurationMs: 0 })) };
    const states = { 0: language, 2: true, 3: true, 14: true, 15: slow, 16: 'running', 7: { width: 360, height: 480 } };
    const tree = renderCameraScreen(language, slow, live, { states });
    const copy = transpile('5-patient/src/liveMobileCopy.js', { '../../shared/liveFace.js': live }).getLiveMobileCopy(language);
    const text = screenText(tree);
    assert.ok(text.includes(copy.expressions.happy)); assert.ok(text.includes(live.expressionEmoji.happy));
    assert.ok(text.includes(copy.sampledAnalysis)); assert.ok(text.includes(copy.sampledNotice));
    assert.ok(text.includes(copy.analysisDelay)); assert.ok(text.includes('21.0')); assert.ok(text.includes(copy.singleFrame));
    const camera = findScreenNode(tree, node => node.type === 'CameraView');
    assert.ok(camera); assert.deepEqual(camera.props.style, {});
    assert.equal(findScreenNode(tree, node => node.type === 'View' && Array.isArray(node.props.style) && node.props.style[0]?.borderColor === '#58EDBC'), null);
    assert.equal(findScreenNode(tree, node => node.type === 'View' && Array.isArray(node.props.style) && node.props.style[0]?.width === 3), null);
    const thumbnail = findScreenNode(tree, node => node.type === 'Image' && node.props.accessibilityLabel === copy.analyzedThumbnail);
    assert.ok(thumbnail); assert.equal(thumbnail.props.style.width, 102);
    const snapshotBox = findScreenNode(tree, node => node.type === 'View' && Array.isArray(node.props.style) && node.props.style[0]?.borderColor === '#A5E6D0');
    assert.ok(snapshotBox, 'face numbers remain attached to the exact analyzed thumbnail');
  }
});

test('the actual mobile frame callback uses single-image evidence for slow samples and retains three-frame support for fast samples', async () => {
  const live = await helpers, now = Date.now(), configs = [], states = { 0: 'en', 2: true, 3: true, 14: true, 15: null, 16: 'running' }, effects = [], refs = [];
  const session = { ...moduleFixture.exports, createLiveFrameLoop: config => { configs.push(config); return { stop() {}, start() {}, busy: () => false }; } };
  renderCameraScreen('en', null, live, { states, effects, refs, session });
  const setup = effects.find(value => Array.isArray(value.dependencies) && value.dependencies.length === 0);
  assert.ok(setup); const cleanup = setup.effect(); assert.equal(configs.length, 1);
  const tracked = trackedCameraFrame(live, now);
  const raw = (captured, completed) => ({ version: 'live-face-v1', provider: 'face-api.js-local', width: 640, height: 480,
    capturedAt: new Date(captured).toISOString(), sampledAt: new Date(completed).toISOString(), processingTimeMs: completed - captured,
    image: tracked.image, faces: tracked.faces.map(face => ({ box: face.box, detectionConfidence: face.detectionConfidence, landmarks: face.landmarks, scores: face.scores })) });
  configs[0].onFrame(raw(now - 2000, now));
  assert.equal(states[15].faces[0].expression, 'happy'); assert.equal(states[15].faces[0].evidenceMode, 'single-frame');
  assert.equal(states[15].faces[0].evidenceFrames, 1); assert.equal(states[15].sampledAnalysis, true);
  // The first frame after a long gap is sampled, then fast observations must rebuild evidence.
  configs[0].onFrame(raw(now + 2000, now + 2030));
  assert.equal(states[15].faces[0].evidenceMode, 'single-frame');
  for (const offset of [2250, 2500, 2750]) configs[0].onFrame(raw(now + offset, now + offset + 30));
  assert.equal(states[15].faces[0].expression, 'happy'); assert.equal(states[15].faces[0].evidenceMode, 'temporal');
  assert.equal(states[15].faces[0].evidenceFrames, 3); assert.equal(states[15].sampledAnalysis, false);
  const beforeRecovery = states[15];
  configs[0].onRecovering(new Error('synthetic-detector-timeout'), { attempt: 1 });
  assert.equal(states[15], beforeRecovery, 'retain the completed result while bounded recovery runs');
  assert.equal(states[16], 'recovering');
  configs[0].onFrame(raw(now + 3000, now + 3030));
  assert.equal(states[15].faces[0].expression, 'uncertain', 'recovery resets temporal support instead of reusing old evidence');
  assert.equal(states[15].faces[0].evidenceFrames, 1);
  cleanup();
});

test('camera readiness keeps actual CPU/GPU backend metadata and rejects unknown backend claims', async () => {
  const live = await helpers, frame = trackedCameraFrame(live, Date.now());
  const states = { 0: 'en', 2: true, 3: true, 14: true, 15: frame, 16: 'running' };
  const tree = renderCameraScreen('en', frame, live, { states });
  const bridge = findScreenNode(tree, node => typeof node.props.onReady === 'function'); assert.ok(bridge);
  for (const backend of ['cpu', 'wasm', 'webgl', 'webgl2']) { bridge.props.onReady(backend); assert.equal(states[26], backend); }
  bridge.props.onReady('invented-gpu'); assert.equal(states[26], null);
});

test('saved-photo output describes one image instead of live timing or repeated expression stability', async () => {
  const live = await helpers;
  for (const language of ['en', 'ta', 'si']) {
    const old = trackedCameraFrame(live, Date.now() - 86400000);
    const single = { ...live.createLiveFaceTracker({ stableFrames: 1 }).update(old), image: old.image, ownerUid: old.ownerUid, fps: null };
    const selected = { id: 7, ownerUid: old.ownerUid, ...old.image };
    const tree = renderCameraScreen(language, null, live, { states: { 0: language, 1: selected, 2: false, 14: true, 23: single, 24: 'ready' } });
    const copy = transpile('5-patient/src/liveMobileCopy.js', { '../../shared/liveFace.js': live }).getLiveMobileCopy(language);
    assert.ok(screenText(tree).includes(copy.photoResults)); assert.ok(screenText(tree).includes(copy.singleImage));
    assert.ok(screenText(tree).includes(copy.singleFrame)); assert.equal(screenText(tree).includes(copy.temporalEvidence), false);
    assert.equal(screenText(tree).includes(copy.staleFrame), false); assert.equal(screenText(tree).includes(copy.sampled), false);
    assert.equal(findScreenNode(tree, node => node.type === 'CameraView'), null);
  }
});

test('provider status accepts only unverified configuration metadata and strips any extra fields', async () => {
  const { validateFaceProviderStatus, getFaceProviderStatusCopy } = await providerHelpers;
  for (const configurationState of ['missing', 'invalid', 'available']) {
    const result = validateFaceProviderStatus({ provider: 'google-cloud-vision', configurationState, providerVerified: false, secret: 'synthetic-never-return' });
    assert.deepEqual(Object.keys(result).sort(), ['configurationState', 'provider', 'providerVerified']); assert.equal(Object.isFrozen(result), true);
  }
  for (const candidate of [null, [], {}, { provider: 'unknown', configurationState: 'available', providerVerified: false },
    { provider: 'google-cloud-vision', configurationState: 'available', providerVerified: true },
    { provider: 'google-cloud-vision', configurationState: 'checking', providerVerified: false }]) assert.throws(() => validateFaceProviderStatus(candidate), /cloud_status/);
  const expected = ['available', 'checking', 'invalid', 'missing', 'unavailable'];
  for (const language of ['en', 'ta', 'si']) assert.deepEqual(Object.keys(getFaceProviderStatusCopy(language).states).sort(), expected);
});

test('missing or invalid provider configuration disables cloud opt-in while preserving the live camera', async () => {
  const live = await helpers, provider = await providerHelpers;
  for (const language of ['en', 'ta', 'si']) for (const configurationState of ['checking', 'missing', 'invalid', 'available', 'unavailable']) {
    const frame = trackedCameraFrame(live, Date.now());
    const states = { 0: language, 2: true, 3: true, 14: true, 15: frame, 16: 'running', 27: { configurationState } };
    const tree = renderCameraScreen(language, frame, live, { states });
    const toggle = findScreenNode(tree, node => node.props.accessibilityRole === 'switch'); assert.ok(toggle);
    assert.equal(toggle.props.disabled, ['checking', 'missing', 'invalid'].includes(configurationState));
    assert.ok(screenText(tree).includes(provider.getFaceProviderStatusCopy(language).states[configurationState]));
    assert.ok(findScreenNode(tree, node => node.type === 'CameraView'));
  }
});

test('the actual provider configuration check sends no photo and suppresses stale account or disposed responses', async () => {
  const live = await helpers;
  for (const cancelled of ['account-change', 'cleanup']) {
    const gate = deferred(), requests = [], effects = [], auth = { currentUser: { uid: 'synthetic-account-a' } };
    const states = { 0: 'en', 2: true, 3: true, 14: true, 16: 'running' };
    renderCameraScreen('en', null, live, { states, effects, auth, api: { apiFetch: (path, options) => { requests.push({ path, options }); return gate.promise; } } });
    const status = effects.find(value => value.dependencies?.length === 3 && value.dependencies[0] === true && value.dependencies[1] === undefined && value.dependencies[2] === 0);
    assert.ok(status);
    const cleanup = status.effect(); assert.equal(requests.length, 1); assert.equal(requests[0].path, '/emotions/face-status');
    assert.equal(requests[0].options.body, undefined); assert.equal(requests[0].options.method, undefined);
    if (cancelled === 'account-change') auth.currentUser = { uid: 'synthetic-account-b' }; else cleanup();
    gate.resolve({ ok: true, json: async () => ({ provider: 'google-cloud-vision', configurationState: 'available', providerVerified: false }) });
    await settle();
    assert.equal(states[27].configurationState, 'checking');
    cleanup(); assert.equal(requests[0].options.signal.aborted, true);
  }
});

test('provider configuration timeout aborts the request and shows unconfirmed status without stopping local detection', async () => {
  const live = await helpers, effects = [], requests = [];
  let timeout, timeoutCleared = 0;
  const states = { 0: 'en', 2: true, 3: true, 14: true, 16: 'running' };
  renderCameraScreen('en', null, live, { states, effects, api: { apiFetch: (path, options) => {
    requests.push({ path, options });
    return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('synthetic-timeout')), { once: true }));
  } }, runtime: { setTimeout: (callback, delay) => { assert.equal(delay, 8000); timeout = callback; return 18; }, clearTimeout: id => { assert.equal(id, 18); timeoutCleared++; } } });
  const status = effects.find(value => value.dependencies?.length === 3 && value.dependencies[1] === undefined && value.dependencies[2] === 0);
  const cleanup = status.effect(); timeout(); await settle();
  assert.equal(requests[0].options.signal.aborted, true); assert.equal(states[27].configurationState, 'unavailable');
  assert.equal(states[14], true); assert.equal(states[16], 'running'); assert.ok(timeoutCleared >= 1); cleanup();
});

test('cloud sampling requires explicit opt-in and a signed-in account', async () => {
  const f = cloudFixture(); await f.sampler.sample(photo());
  assert.equal(f.calls.length, 0); assert.equal(f.sampler.enabled(), false);
  f.setUid(null); f.sampler.enable(); await f.sampler.sample(photo());
  assert.equal(f.calls.length, 0); assert.equal(f.sampler.enabled(), false);
  f.setUid('synthetic-account-a'); f.sampler.enable(); await f.sampler.sample(photo());
  assert.equal(f.calls.length, 1); assert.equal(f.reports.length, 1); f.sampler.disable();
});

test('cloud sampling is single-inflight and never runs more often than 15 seconds', async () => {
  const gate = deferred(), calls = [];
  const f = cloudFixture({ intervalMs: 1, analyze: (image, signal) => { calls.push({ image, signal }); return calls.length === 1 ? gate.promise : Promise.resolve({ synthetic: true }); } });
  f.sampler.enable(); const firstPhoto = photo('first'); const pending = f.sampler.sample(firstPhoto);
  await f.sampler.sample(photo('overlap')); assert.equal(calls.length, 1);
  gate.resolve({ synthetic: true }); await pending;
  assert.equal(f.reports[0].image, firstPhoto); assert.equal(calls[0].signal.aborted, false);
  f.time.advance(14999); await f.sampler.sample(photo('too-early')); assert.equal(calls.length, 1);
  f.time.advance(1); await f.sampler.sample(photo('next')); assert.equal(calls.length, 2);
  f.sampler.disable();
});

test('cloud sampling respects a longer configured interval', async () => {
  const f = cloudFixture({ intervalMs: 45000 }); f.sampler.enable();
  await f.sampler.sample(photo()); f.time.advance(44999); await f.sampler.sample(photo()); assert.equal(f.calls.length, 1);
  f.time.advance(1); await f.sampler.sample(photo()); assert.equal(f.calls.length, 2); f.sampler.disable();
});

test('transient cloud failures back off for 30 seconds and rate limits for 60 seconds', async () => {
  for (const [code, milliseconds] of [['unavailable', 30000], ['rateLimit', 60000]]) {
    let calls = 0;
    const f = cloudFixture({ analyze: async () => { calls++; if (calls === 1) throw new Error(code); return { synthetic: true }; } });
    f.sampler.enable(); await f.sampler.sample(photo());
    assert.equal(f.errors.length, 1); assert.equal(f.errors[0].message, code); assert.equal(f.sampler.enabled(), true);
    f.time.advance(milliseconds - 1); await f.sampler.sample(photo()); assert.equal(calls, 1);
    f.time.advance(1); await f.sampler.sample(photo()); assert.equal(calls, 2); assert.equal(f.reports.length, 1);
    f.sampler.disable();
  }
});

test('configuration or authentication failures disable cloud checks and abort their signal', async () => {
  for (const code of ['notConfigured', 'auth']) {
    let calls = 0, signal;
    const f = cloudFixture({ analyze: async (image, nextSignal) => { calls++; signal = nextSignal; throw new Error(code); } });
    f.sampler.enable(); await f.sampler.sample(photo());
    assert.equal(f.sampler.enabled(), false); assert.equal(signal.aborted, true); assert.equal(f.errors[0].message, code);
    f.time.advance(90000); await f.sampler.sample(photo()); assert.equal(calls, 1); assert.equal(f.reports.length, 0);
  }
});

test('disabling cloud aborts its request and suppresses late success or failure', async () => {
  for (const outcome of ['resolve', 'reject']) {
    const gate = deferred(); let signal;
    const f = cloudFixture({ analyze: (image, nextSignal) => { signal = nextSignal; return gate.promise; } });
    f.sampler.enable(); const pending = f.sampler.sample(photo()); f.sampler.disable();
    assert.equal(signal.aborted, true);
    if (outcome === 'resolve') gate.resolve({ synthetic: true }); else gate.reject(new Error('synthetic-late-error'));
    await pending;
    assert.equal(f.reports.length, 0); assert.equal(f.errors.length, 0); assert.equal(f.sampler.enabled(), false);
  }
});

test('re-enabling cloud while an old request is pending never overlaps or revives the old report', async () => {
  const gate = deferred(); let calls = 0, firstSignal;
  const f = cloudFixture({ analyze: (image, signal) => { calls++; if (calls === 1) { firstSignal = signal; return gate.promise; } return Promise.resolve({ synthetic: true }); } });
  f.sampler.enable(); const pending = f.sampler.sample(photo('old'));
  f.sampler.disable(); f.sampler.enable(); await f.sampler.sample(photo('overlap'));
  assert.equal(calls, 1); assert.equal(firstSignal.aborted, true);
  gate.resolve({ synthetic: true }); await pending; assert.equal(f.reports.length, 0);
  f.time.advance(15000); await f.sampler.sample(photo('new')); assert.equal(calls, 2); assert.equal(f.reports[0].image.key, 'new');
  f.sampler.disable();
});

test('toggling cloud opt-in does not bypass the promised 15-second sampling limit', async () => {
  const f = cloudFixture(); f.sampler.enable(); await f.sampler.sample(photo('first'));
  f.sampler.disable(); f.sampler.enable(); await f.sampler.sample(photo('too-soon'));
  assert.equal(f.calls.length, 1, 'the same session must not upload twice inside 15 seconds after toggling');
  f.time.advance(14999); await f.sampler.sample(photo('still-too-soon')); assert.equal(f.calls.length, 1);
  f.time.advance(1); await f.sampler.sample(photo('next')); assert.equal(f.calls.length, 2);
  f.sampler.disable();
});

test('UID changes suppress late cloud reports and errors from the previous account', async () => {
  for (const outcome of ['resolve', 'reject']) {
    const gate = deferred();
    const f = cloudFixture({ analyze: () => gate.promise });
    f.sampler.enable(); const pending = f.sampler.sample(photo()); f.setUid('synthetic-account-b');
    if (outcome === 'resolve') gate.resolve({ synthetic: true }); else gate.reject(new Error('auth'));
    await pending; assert.equal(f.reports.length, 0); assert.equal(f.errors.length, 0); f.sampler.disable();
  }
});

test('UID changes abort a pending cloud request before the busy guard can skip the account check', async () => {
  const gate = deferred(); let signal;
  const f = cloudFixture({ analyze: (image, nextSignal) => { signal = nextSignal; return gate.promise; } });
  f.sampler.enable(); const pending = f.sampler.sample(photo('account-a'));
  f.setUid('synthetic-account-b'); await f.sampler.sample(photo('account-b'));
  assert.equal(f.sampler.enabled(), false); assert.equal(signal.aborted, true);
  gate.resolve({ synthetic: true }); await pending;
  assert.equal(f.reports.length, 0); assert.equal(f.errors.length, 0);
});

test('UID changes disable cloud consent immediately even before the next sampling deadline', async () => {
  const f = cloudFixture(); f.sampler.enable(); await f.sampler.sample(photo('account-a'));
  f.setUid('synthetic-account-b'); f.time.advance(1); await f.sampler.sample(photo('account-b'));
  assert.equal(f.calls.length, 1); assert.equal(f.sampler.enabled(), false);
});

test('cloud consent does not carry into another account without a fresh enable', async () => {
  const f = cloudFixture(); f.sampler.enable(); await f.sampler.sample(photo('account-a'));
  f.setUid('synthetic-account-b'); f.time.advance(15000); await f.sampler.sample(photo('account-b'));
  assert.equal(f.calls.length, 1, 'an account change must disable cloud sharing rather than reuse old consent');
  assert.equal(f.sampler.enabled(), false);
  f.sampler.enable(); await f.sampler.sample(photo('fresh-account-b-consent'));
  assert.equal(f.calls.length, 2); f.sampler.disable();
});

test('signed-out cloud sampling disables assistance instead of issuing another request', async () => {
  const f = cloudFixture(); f.sampler.enable(); f.setUid(null); await f.sampler.sample(photo());
  assert.equal(f.calls.length, 0); assert.equal(f.sampler.enabled(), false);
});

test('cloud expression display maps all four aliases in EN, TA and SI without fabricated probabilities', async () => {
  const { getCloudExpressionDisplay, getLiveFaceCopy, expressionEmoji } = await helpers;
  const unknown = { joy: 'UNKNOWN', sorrow: 'UNKNOWN', anger: 'UNKNOWN', surprise: 'UNKNOWN' };
  for (const language of ['en', 'ta', 'si']) {
    const copy = getLiveFaceCopy(language);
    for (const [signal, expression] of [['joy', 'happy'], ['sorrow', 'sad'], ['anger', 'angry'], ['surprise', 'surprised']]) {
      for (const value of ['LIKELY', 'VERY_LIKELY']) {
        const result = getCloudExpressionDisplay({ ...unknown, [signal]: value }, language);
        assert.deepEqual(result, { label: copy.expressions[expression], emoji: expressionEmoji[expression], valueText: copy.likelihood[value], kind: 'likelihood' });
        assert.equal(result.valueText.includes('%'), false);
      }
    }
    const strongest = getCloudExpressionDisplay({ ...unknown, joy: 'LIKELY', sorrow: 'VERY_LIKELY' }, language);
    assert.equal(strongest.label, copy.expressions.sad); assert.equal(strongest.valueText, copy.likelihood.VERY_LIKELY);
  }
});

test('weak, tied and malformed cloud expressions stay uncertain in every language', async () => {
  const { getCloudExpressionDisplay, getLiveFaceCopy, expressionEmoji } = await helpers;
  const unknown = { joy: 'UNKNOWN', sorrow: 'UNKNOWN', anger: 'UNKNOWN', surprise: 'UNKNOWN' };
  const weak = ['UNKNOWN', 'VERY_UNLIKELY', 'UNLIKELY', 'POSSIBLE'].map(value => ({ ...unknown, joy: value }));
  const malformed = [null, [], false, {}, { ...unknown, joy: .99 }, { ...unknown, joy: '0.99' }, { ...unknown, joy: 'CERTAIN' },
    { joy: 'LIKELY' }, { ...unknown, joy: null }, Object.create({ ...unknown, joy: 'LIKELY' })];
  const ties = [{ ...unknown, joy: 'LIKELY', anger: 'LIKELY' }, { ...unknown, joy: 'VERY_LIKELY', surprise: 'VERY_LIKELY' }];
  for (const language of ['en', 'ta', 'si']) {
    const copy = getLiveFaceCopy(language);
    for (const input of [...weak, ...malformed, ...ties]) {
      const result = getCloudExpressionDisplay(input, language);
      assert.deepEqual(result, { label: copy.expressions.uncertain, emoji: expressionEmoji.uncertain, valueText: copy.unknown, kind: 'unknown' });
      assert.equal(result.valueText.includes('%'), false);
    }
  }
});
