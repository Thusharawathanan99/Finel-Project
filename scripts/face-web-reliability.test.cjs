const test = require('node:test');
const assert = require('node:assert/strict');
const { load, hooks, nodes, handler, apiDefaults } = require('./web-regression.cjs');

const projectModal = '1-ui-ux/src/app/components/EmotionLoggerModal.tsx';
const react = `export const useState=(...args)=>globalThis.hooks.useState(...args), useRef=(...args)=>globalThis.hooks.useRef(...args), useEffect=(effect,dependencies)=>globalThis.hooks.effect?.(effect,dependencies), useCallback=fn=>fn, useMemo=fn=>fn();`;
const firebaseAuth = `export const onAuthStateChanged=(_auth,callback)=>globalThis.faceAuthSubscribe?.(callback)||(()=>{});`;
const loaded = (async () => {
  globalThis.fakeAuth ||= { currentUser: null };
  globalThis.fakeAuth.currentUser = { uid: 'fixture-account-a' };
  const [{ EmotionLoggerModal }, { Resident }, panels, clock, quality, live, provider] = await Promise.all([
    load(projectModal, { EmotionLoggerModal: null, react, 'firebase/auth': firebaseAuth }),
    load('1-ui-ux/src/app/models/Resident.ts'),
    load('1-ui-ux/src/app/components/LiveFacePanel.tsx'),
    load('1-ui-ux/src/app/components/useFaceFrameClock.ts', { react }),
    load('1-ui-ux/src/app/components/FaceQualityPanel.tsx', { react }),
    load('shared/liveFace.js'), load('shared/faceProviderStatus.js'),
  ]);
  return { EmotionLoggerModal, Resident, panels, clock, quality, live, provider };
})();
const settle = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
const textOf = tree => Array.isArray(tree) ? tree.map(textOf).join(' ') :
  tree && typeof tree === 'object' ? textOf(tree.props?.children) : String(tree ?? '');
const component = (tree, name) => nodes(tree, node => node.type?.name === name)[0];
const makeFrame = capturedAt => {
  const scores = { angry: 1 / 60, disgusted: 1 / 60, fearful: 1 / 60, happy: 0.9, neutral: 1 / 60, sad: 1 / 60, surprised: 1 / 60 };
  return { version: 'live-face-v1', provider: 'face-api.js-local', width: 640, height: 480,
    capturedAt: new Date(capturedAt).toISOString(), processingTimeMs: 75, fps: 7,
    faces: [{ id: 'fixture-face', box: { x: 0.2, y: 0.1, width: 0.4, height: 0.6 },
      detectionConfidence: 0.95, scores, smoothedScores: scores,
      landmarks: Array.from({ length: 68 }, () => ({ x: 0.4, y: 0.4 })),
      expression: 'happy', expressionConfidence: 0.9, stable: true,
      evidenceMode: 'temporal', evidenceFrames: 3, evidenceDurationMs: 500 }] };
};
const photo = { dataUrl: 'data:image/jpeg;base64,/9j/AA==', width: 800, height: 600, capturedAt: '2026-10-01T12:00:00.000Z' };
function fixture(modules, overrides = {}) {
  const resident = new modules.Resident('R1', 'Local fixture', 65), effects = [];
  globalThis.fakeAuth.currentUser = { uid: 'fixture-account-a' };
  globalThis.fakeApi = apiDefaults();
  const state = hooks(overrides);
  state.effect = (effect, dependencies) => effects.push({ effect, dependencies });
  const render = () => { globalThis.hooks = state; state.reset(); effects.length = 0;
    return modules.EmotionLoggerModal({ resident, onClose() {}, onLogged() {} }); };
  render();
  // Existing hook fixture positions are retained. Provider/clock state is appended.
  const providerIndex = state.values.findIndex(value => value === 'checking');
  assert.ok(providerIndex > 40);
  return { state, render, effects, providerIndex, clockIndex: providerIndex + 4 };
}

test('the actual 500ms clock advances without an inference callback and releases its timer', async () => {
  const { clock } = await loaded;
  const originalNow = Date.now, originalInterval = globalThis.setInterval, originalClear = globalThis.clearInterval;
  let now = 10000, callback, cleaned = 0;
  try {
    Date.now = () => now;
    globalThis.setInterval = (fn, delay) => { assert.equal(delay, 500); callback = fn; return 71; };
    globalThis.clearInterval = id => { assert.equal(id, 71); cleaned++; };
    globalThis.hooks = hooks(); const effects = []; globalThis.hooks.effect = effect => effects.push(effect);
    assert.equal(clock.useFaceFrameClock(true), 10000);
    const cleanup = effects[0](); now += 2000; callback();
    globalThis.hooks.reset(); assert.equal(clock.useFaceFrameClock(true), 12000);
    cleanup(); assert.equal(cleaned, 1);
    globalThis.hooks = hooks(); globalThis.hooks.effect = effect => effects.push(effect);
    clock.useFaceFrameClock(false); assert.equal(effects.at(-1)(), undefined);
    assert.equal(cleaned, 1);
  } finally { Date.now = originalNow; globalThis.setInterval = originalInterval; globalThis.clearInterval = originalClear; }
});

test('a live stall hides overlays, expressions, measured rate, badge and report export until a fresh frame', async () => {
  const m = await loaded, captured = Date.now(), frame = makeFrame(captured);
  for (const language of ['en', 'ta', 'si']) {
    const f = fixture(m, { 0: language, 4: true, 23: frame, 25: 'running' }), copy = m.live.getLiveFaceCopy(language);
    f.state.values[f.clockIndex] = captured + 1500;
    let tree = f.render(); assert.equal(component(tree, 'FaceOverlay').props.frame, frame);
    assert.equal(nodes(tree, node => node.props?.onClick?.name === 'handleDownloadLive')[0].props.disabled, false);
    // Advance only the independent clock; no model result is produced.
    f.state.values[f.clockIndex] = captured + 1501; tree = f.render();
    assert.equal(component(tree, 'FaceOverlay').props.frame, null);
    const strip = component(tree, 'LiveResultStrip'), results = component(tree, 'LiveFaceResults');
    assert.equal(strip.props.frame, null); assert.equal(strip.props.fps, undefined); assert.equal(strip.props.stale, true);
    assert.equal(results.props.frame, null); assert.equal(results.props.fps, undefined);
    assert.ok(textOf(tree).includes(copy.waitingFresh));
    assert.ok(textOf(m.panels.LiveResultStrip(strip.props)).includes(copy.waitingFresh));
    assert.ok(textOf(m.panels.LiveFaceResults(results.props)).includes(copy.waitingFresh));
    assert.equal(textOf(m.panels.LiveFaceResults(results.props)).includes(copy.expressions.happy), false);
    assert.equal(nodes(tree, node => node.props?.onClick?.name === 'handleDownloadLive')[0].props.disabled, true);
    const quality = component(tree, 'FaceQualityPanel'); assert.equal(quality.props.frame, frame); assert.equal(quality.props.now, captured + 1501);
    globalThis.hooks = hooks(); assert.ok(textOf(m.quality.FaceQualityPanel(quality.props)).includes('1.5'));
    f.state.values[23] = makeFrame(captured + 1501); tree = f.render();
    assert.notEqual(component(tree, 'FaceOverlay').props.frame, null);
    assert.equal(component(tree, 'LiveFaceResults').props.stale, false);
    assert.equal(nodes(tree, node => node.props?.onClick?.name === 'handleDownloadLive')[0].props.disabled, false);
  }
});

test('the live report action rechecks wall-clock freshness before exporting bytes', async () => {
  const m = await loaded, originalNow = Date.now, originalDocument = globalThis.document;
  const originalCreate = URL.createObjectURL, originalRevoke = URL.revokeObjectURL, originalTimeout = globalThis.setTimeout;
  let now = originalNow(), exports = 0, clicks = 0;
  try {
    Date.now = () => now;
    globalThis.document = { createElement: () => ({ click() { clicks++; } }) };
    URL.createObjectURL = () => { exports++; return 'blob:local-fixture'; }; URL.revokeObjectURL = () => {};
    globalThis.setTimeout = () => 1;
    const f = fixture(m, { 4: true, 23: makeFrame(now), 25: 'running' });
    const action = handler(f.render(), 'handleDownloadLive');
    action(); assert.equal(exports, 1); assert.equal(clicks, 1);
    now += 1501; action(); assert.equal(exports, 1);
    globalThis.fakeAuth.currentUser = { uid: 'fixture-account-b' }; action(); assert.equal(exports, 1);
  } finally { Date.now = originalNow; globalThis.document = originalDocument;
    URL.createObjectURL = originalCreate; URL.revokeObjectURL = originalRevoke; globalThis.setTimeout = originalTimeout; }
});

test('historic photos retain their boxes, estimates and download without a live expiry clock', async () => {
  const m = await loaded, old = makeFrame(Date.parse(photo.capturedAt));
  old.faces[0].evidenceMode = 'single-frame'; old.faces[0].evidenceFrames = 1; old.faces[0].evidenceDurationMs = 0;
  for (const language of ['en', 'ta', 'si']) {
    const f = fixture(m, { 0: language, 1: photo, 24: old, 25: 'running' });
    const tree = f.render(), copy = m.live.getLiveFaceCopy(language);
    assert.equal(component(tree, 'FaceOverlay').props.frame, old);
    const results = component(tree, 'LiveFaceResults'); assert.equal(results.props.frame, old); assert.equal(results.props.photo, true);
    assert.ok(textOf(m.panels.LiveFaceResults(results.props)).includes(copy.expressions.happy));
    assert.ok(nodes(tree, node => node.props?.onClick?.name === 'handleDownload').length);
    assert.equal(nodes(tree, node => node.props?.onClick?.name === 'handleDownloadLive').length, 0);
    const quality = component(tree, 'FaceQualityPanel'); globalThis.hooks = hooks();
    assert.equal(textOf(m.quality.FaceQualityPanel(quality.props)).includes('1.5'), false);
  }
});

test('all languages show the real provider configuration and disable unavailable setup controls', async () => {
  const m = await loaded;
  for (const language of ['en', 'ta', 'si']) for (const configuration of ['checking', 'missing', 'invalid', 'available', 'unavailable']) {
    const f = fixture(m, { 0: language, 4: true, 23: makeFrame(Date.now()), 25: 'running' });
    f.state.values[f.providerIndex] = configuration; const tree = f.render();
    assert.ok(textOf(tree).includes(m.provider.getFaceProviderStatusCopy(language).states[configuration]));
    const toggle = nodes(tree, node => node.type === 'input' && node.props.type === 'checkbox' && Object.hasOwn(node.props, 'disabled'))[0];
    assert.equal(toggle.props.disabled, ['checking', 'missing', 'invalid'].includes(configuration));
    assert.equal(toggle.props.checked, false);
    assert.ok(component(tree, 'FaceOverlay').props.frame);
    f.state.values[1] = photo;
    const photoTree = f.render(), button = nodes(photoTree, node => node.props?.onClick?.name === 'handleAnalyze')[0];
    assert.equal(button.props.disabled, ['checking', 'missing', 'invalid'].includes(configuration));
  }
});

test('checking setup sends one metadata request, never a photo or automatic cloud opt-in', async () => {
  const m = await loaded, originalTimeout = globalThis.setTimeout, originalClear = globalThis.clearTimeout;
  let timeout, uploads = 0, requests = [];
  try {
    globalThis.setTimeout = (fn, milliseconds) => { assert.equal(milliseconds, 10000); timeout = fn; return 81; };
    globalThis.clearTimeout = () => {};
    const f = fixture(m); globalThis.fakeApi.emotions.faceStatus = async options => {
      requests.push(options); return { provider: 'google-cloud-vision', configurationState: 'available', providerVerified: false };
    };
    globalThis.fakeApi.emotions.analyzeImage = async () => { uploads++; };
    const status = f.effects.find(item => item.dependencies?.length === 3 && item.dependencies[2] === 0);
    assert.ok(status); const cleanup = status.effect(); await settle();
    assert.equal(requests.length, 1); assert.deepEqual(Object.keys(requests[0]), ['signal']);
    assert.ok(requests[0].signal instanceof AbortSignal); assert.equal(f.state.values[f.providerIndex], 'available');
    assert.equal(f.state.values[29], false); assert.equal(uploads, 0); assert.equal(typeof timeout, 'function'); cleanup();
  } finally { globalThis.setTimeout = originalTimeout; globalThis.clearTimeout = originalClear; }
});

test('legacy status failure allows only a deliberate consented request and never fakes verified access', async () => {
  const m = await loaded, originalTimeout = globalThis.setTimeout, originalClear = globalThis.clearTimeout;
  let uploads = 0;
  try {
    globalThis.setTimeout = () => 81; globalThis.clearTimeout = () => {};
    const f = fixture(m); globalThis.fakeApi.emotions.faceStatus = async () => { throw new Error('legacy endpoint missing'); };
    globalThis.fakeApi.emotions.analyzeImage = async () => { uploads++; throw new Error('synthetic unavailable'); };
    const status = f.effects.find(item => item.dependencies?.length === 3 && item.dependencies[2] === 0);
    const cleanup = status.effect(); await settle();
    assert.equal(f.state.values[f.providerIndex], 'unavailable'); assert.equal(f.state.values[29], false); assert.equal(uploads, 0);
    let tree = f.render(); assert.ok(textOf(tree).includes(m.provider.getFaceProviderStatusCopy('en').states.unavailable));
    f.state.values[1] = photo; tree = f.render(); assert.equal(uploads, 0);
    await handler(tree, 'handleAnalyze')(); assert.equal(uploads, 1); cleanup();
  } finally { globalThis.setTimeout = originalTimeout; globalThis.clearTimeout = originalClear; }
});

test('disposed, changed-account and timed-out status responses cannot revive cloud access', async () => {
  const m = await loaded, originalTimeout = globalThis.setTimeout, originalClear = globalThis.clearTimeout;
  try {
    for (const action of ['cleanup', 'account-change', 'timeout']) {
      let resolve, timeout;
      globalThis.setTimeout = callback => { timeout = callback; return 81; }; globalThis.clearTimeout = () => {};
      const f = fixture(m); globalThis.fakeApi.emotions.faceStatus = () => new Promise(done => { resolve = done; });
      const status = f.effects.find(item => item.dependencies?.length === 3 && item.dependencies[2] === 0), cleanup = status.effect();
      if (action === 'cleanup') cleanup();
      else if (action === 'account-change') globalThis.fakeAuth.currentUser = { uid: 'fixture-account-b' };
      else timeout();
      resolve({ provider: 'google-cloud-vision', configurationState: 'available', providerVerified: false }); await settle();
      assert.notEqual(f.state.values[f.providerIndex], 'available'); assert.equal(f.state.values[29], false); cleanup();
    }
  } finally { globalThis.setTimeout = originalTimeout; globalThis.clearTimeout = originalClear; }
});

test('blocked cloud controls and an account change cannot send a still photo', async () => {
  const m = await loaded;
  for (const configuration of ['checking', 'missing', 'invalid']) {
    const f = fixture(m, { 1: photo }); f.state.values[f.providerIndex] = configuration;
    let uploads = 0; globalThis.fakeApi.emotions.analyzeImage = async () => { uploads++; };
    await handler(f.render(), 'handleAnalyze')(); assert.equal(uploads, 0);
  }
  const f = fixture(m, { 1: photo }); f.state.values[f.providerIndex] = 'available';
  let uploads = 0; globalThis.fakeApi.emotions.analyzeImage = async () => { uploads++; };
  const action = handler(f.render(), 'handleAnalyze'); globalThis.fakeAuth.currentUser = { uid: 'fixture-account-b' };
  await action(); assert.equal(uploads, 0);
});

test('the actual API face-status call is a cancellable authenticated GET without image bytes', async () => {
  const originalFetch = globalThis.fetch;
  try {
    const { emotionsApi } = await load('1-ui-ux/src/app/services/apiService.ts', {
      apiService: null, firebaseAuthService: `export const getIdToken=async()=> 'synthetic-token';`,
    });
    globalThis.fakeAuth.currentUser = { uid: 'fixture-account-a' };
    const requests = [], controller = new AbortController();
    globalThis.fetch = async (url, options) => { requests.push({ url, options }); return { ok: true, status: 200,
      json: async () => ({ provider: 'google-cloud-vision', configurationState: 'missing', providerVerified: false }) }; };
    const value = await emotionsApi.faceStatus({ signal: controller.signal });
    assert.equal(requests.length, 1); assert.equal(requests[0].url, 'http://offline/api/emotions/face-status');
    assert.equal(requests[0].options.method, 'GET'); assert.equal(requests[0].options.body, undefined);
    assert.equal(requests[0].options.signal, controller.signal); assert.equal(requests[0].options.headers.Authorization, 'Bearer synthetic-token');
    assert.equal(value.configurationState, 'missing');
  } finally { globalThis.fetch = originalFetch; }
});
