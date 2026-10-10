// Actual mobile component with the real pure observation engine, offline React
// hooks and Share adapters. Synthetic landmarks are not accuracy measurements.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');
const project = path.resolve(__dirname, '..');
const esbuild = require(path.join(project, '1-ui-ux/node_modules/esbuild'));
const helpers = import(pathToFileURL(path.join(project, 'shared/facialObservations.js')));
const code = esbuild.transformSync(fs.readFileSync(path.join(project, '5-patient/src/components/FacialObservationPanel.js'), 'utf8'), { loader: 'jsx', format: 'cjs', target: 'es2020' }).code;
const epoch = Date.UTC(2026, 9, 9);
function frame(ms = 0, extras = {}) {
  const points = Array.from({ length: 68 }, (_, i) => ({ x: 200 + i * 2, y: 240 }));
  const eye = (start, x) => [[-16, 0], [-8, -5], [8, -5], [16, 0], [8, 5], [-8, 5]].forEach(([dx, dy], i) => { points[start + i] = { x: x + dx, y: 205 + dy }; });
  eye(36, 280); eye(42, 360); points[30] = { x: 320, y: 235 };
  points[48] = { x: 290, y: 270 }; points[54] = { x: 350, y: 270 };
  [[-20, 0], [-10, -3], [0, -3], [10, -3], [20, 0], [10, 3], [0, 3], [-10, 3]].forEach(([dx, dy], i) => { points[60 + i] = { x: 320 + dx, y: 270 + dy }; });
  const face = { id: 'synthetic-anonymous-track', evidenceMode: 'temporal',
    box: { x: .25, y: .25, width: .5, height: .65 }, detectionConfidence: .96,
    scores: { angry: .02, disgusted: .02, fearful: .02, happy: .84, neutral: .06, sad: .02, surprised: .02 },
    landmarks: points.map(point => ({ x: point.x / 640, y: point.y / 480 })),
    imageQuality: { version: 'face-image-quality-v1', sampleWidth: 96, sampleHeight: 96,
      meanLuminance: 120, darkFraction: .05, clippedFraction: .01, laplacianVariance: 80, eyeTiltDegrees: 0 } };
  return { version: 'live-face-v1', provider: 'face-api.js-local', width: 640, height: 480,
    capturedAt: new Date(epoch + ms).toISOString(), completedAt: new Date(epoch + ms + 250).toISOString(),
    processingTimeMs: 250, ownerUid: 'synthetic-owner-a', image: 'PRIVATE SYNTHETIC IMAGE', faces: [face], ...extras };
}
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
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
async function fixture(overrides = {}) {
  const engine = await helpers;
  let props = { language: 'en', frame: frame(), active: true, ownerUid: 'synthetic-owner-a', ...overrides.props };
  let tree, stateIndex = 0, refIndex = 0, effectIndex = 0, dirty = false, mounted = true, lateWrites = 0;
  const states = [], refs = [], effects = [], queued = [], snapshots = [], shares = [];
  const React = { Fragment: 'Fragment', createElement: (type, input, ...children) => ({ type, props: input || {}, children }),
    useState(initial) { const index = stateIndex++; if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial;
      return [states[index], next => { if (!mounted) lateWrites++; const value = typeof next === 'function' ? next(states[index]) : next; if (!Object.is(states[index], value)) { states[index] = value; dirty = true; } }]; },
    useRef(initial) { const index = refIndex++; if (!refs[index]) refs[index] = { current: initial }; return refs[index]; },
    useEffect(callback, deps) { const index = effectIndex++, prior = effects[index];
      if (!prior || !deps || deps.some((value, i) => !Object.is(value, prior.deps[i]))) {
        queued.push(() => { prior?.cleanup?.(); const cleanup = callback(); effects[index] = { deps, cleanup }; });
      }
    } };
  const native = { StyleSheet: { create: styles => styles }, Share: { share: async payload => {
    shares.push(payload); return overrides.share ? overrides.share(payload) : { action: 'sharedAction' };
  } } };
  for (const component of ['View', 'Text', 'TouchableOpacity']) native[component] = component;
  const dependencies = { react: React, 'react-native': native, '@expo/vector-icons': { MaterialCommunityIcons: 'Icon' }, '../../../shared/facialObservations.js': engine };
  const mod = { exports: {} };
  vm.runInNewContext(code, { module: mod, exports: mod.exports, Date, console, require(name) {
    assert.ok(name in dependencies, 'Unexpected dependency (no network/auth service should be used): ' + name); return dependencies[name];
  } });
  const render = () => {
    let count = 0;
    do {
      if (++count > 8) throw new Error('Component update loop detected');
      dirty = false; stateIndex = refIndex = effectIndex = 0;
      tree = mod.exports.default({ ...props, onChange: value => snapshots.push(value) });
      while (queued.length) queued.shift()();
    } while (dirty);
    return tree;
  };
  render();
  const button = label => { const node = find(render(), current => current.type === 'TouchableOpacity' && text(current).trim() === label); assert.ok(node, 'Expected button ' + label); return node; };
  const expand = () => { const header = find(render(), current => current.type === 'TouchableOpacity' && Object.hasOwn(current.props.accessibilityState || {}, 'expanded')); header.props.onPress(); render(); };
  return { engine, states, snapshots, shares, render, button, expand,
    update(next) { props = { ...props, ...next }; return render(); },
    unmount() { mounted = false; for (const effect of effects) effect?.cleanup?.(); },
    get lateWrites() { return lateWrites; },
    snapshot() { return snapshots.at(-1); },
  };
}

test('mobile observation component publishes one frame without callback loops or automatic calibration', async () => {
  const f = await fixture();
  assert.equal(f.snapshot().state, 'observing'); assert.equal(f.snapshot().history.length, 1);
  assert.equal(f.snapshot().baseline.status, 'off'); assert.equal(f.snapshots.length, 1);
  for (let i = 0; i < 5; i++) f.render();
  assert.equal(f.snapshots.length, 1); assert.equal(f.shares.length, 0); f.unmount();
});

test('session calibration requires an explicit eligible consent button and deletes on user request', async () => {
  const f = await fixture(); const copy = f.engine.getFacialObservationCopy('en'); f.expand();
  assert.equal(f.button(copy.baselineStart).props.disabled, false);
  f.button(copy.baselineStart).props.onPress(); f.render(); assert.equal(f.snapshot().baseline.status, 'collecting');
  for (let i = 1; i <= 8; i++) f.update({ frame: frame(i * 750) });
  assert.equal(f.snapshot().baseline.status, 'ready'); assert.equal(f.snapshot().baseline.sampleCount, 8);
  f.button(copy.baselineReset).props.onPress(); f.render();
  assert.equal(f.snapshot().baseline.status, 'off'); assert.equal(f.snapshot().history.length, 0); f.unmount();
});

test('pause, a stale null frame and a sampled frame cannot retain current findings or calibration continuity', async () => {
  const f = await fixture(); const copy = f.engine.getFacialObservationCopy('en'); f.expand();
  f.button(copy.baselineStart).props.onPress(); f.render();
  f.update({ active: false }); assert.equal(f.snapshot().state, 'unavailable'); assert.equal(f.snapshot().baseline.status, 'off');
  assert.equal(f.button(copy.baselineStart).props.disabled, true);
  f.update({ active: true, frame: frame(1000) }); assert.equal(f.snapshot().state, 'observing');
  f.update({ frame: null }); assert.equal(f.snapshot().state, 'unavailable'); assert.equal(f.snapshot().history.length, 0);
  assert.equal(f.button(copy.baselineStart).props.disabled, true);
  f.update({ frame: frame(2000, { sampledAnalysis: true }) });
  assert.equal(f.snapshot().history.length, 1); assert.equal(f.snapshot().temporalContinuity, 'reset');
  assert.equal(f.button(copy.baselineStart).props.disabled, true); f.unmount();
});

test('owner change clears prior tracking and rejects a former owner frame', async () => {
  const f = await fixture();
  f.update({ ownerUid: 'synthetic-owner-b', frame: frame(1000, { ownerUid: 'synthetic-owner-a' }) });
  assert.equal(f.snapshot().state, 'unavailable'); assert.equal(f.snapshot().history.length, 0);
  assert.equal(f.snapshot().baseline.status, 'off');
  f.update({ frame: frame(2000, { ownerUid: 'synthetic-owner-b' }) });
  assert.equal(f.snapshot().state, 'observing'); assert.equal(f.snapshot().history.length, 1); f.unmount();
});

test('localized observation sharing exports numeric observations without identity, image or clinical diagnosis', async () => {
  for (const language of ['en', 'ta', 'si']) {
    const f = await fixture({ props: { language } }); const copy = f.engine.getFacialObservationCopy(language); f.expand();
    await f.button(copy.share).props.onPress();
    assert.equal(f.shares.length, 1); assert.ok(f.shares[0].message.includes(copy.report));
    assert.doesNotMatch(f.shares[0].message, /PRIVATE|synthetic-owner|synthetic-anonymous-track|heart attack detected|stroke detected/);
    f.unmount();
  }
});

test('late Share failures after unmount or owner change cannot update the former session', async () => {
  for (const change of ['unmount', 'owner']) {
    const pending = deferred(); const f = await fixture({ share: () => pending.promise });
    const copy = f.engine.getFacialObservationCopy('en'); f.expand();
    const work = f.button(copy.share).props.onPress();
    if (change === 'unmount') f.unmount(); else f.update({ ownerUid: 'synthetic-owner-b', frame: frame(1000, { ownerUid: 'synthetic-owner-b' }) });
    pending.reject(new Error('Synthetic share failure')); await work;
    assert.equal(f.lateWrites, 0);
    if (change === 'owner') { assert.equal(f.states[2], false); f.unmount(); }
  }
});

test('manual clear removes only observation history and leaves no automatic sharing', async () => {
  const f = await fixture(); const copy = f.engine.getFacialObservationCopy('en'); f.expand();
  f.button(copy.clearSession).props.onPress(); f.render();
  assert.equal(f.snapshot().state, 'unavailable'); assert.equal(f.snapshot().history.length, 0);
  assert.equal(f.snapshot().metrics, null); assert.equal(f.snapshot().baseline.status, 'off');
  assert.equal(f.shares.length, 0); f.unmount();
});
