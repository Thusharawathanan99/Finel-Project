// Offline reliability checks. Synthetic frames and clocks; no patient images.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '..');
const esbuild = require(path.join(root, '1-ui-ux/node_modules/esbuild'));
const livePromise = import(pathToFileURL(path.join(root, 'shared/liveFace.js')));
function load(file, dependencies = {}, runtime = {}) {
  const module = { exports: {} };
  vm.runInNewContext(esbuild.transformSync(fs.readFileSync(path.join(root, file), 'utf8'), { format: 'cjs', target: 'es2020' }).code,
    { module, exports: module.exports, require: name => dependencies[name], Date, AbortController, setTimeout, clearTimeout, ...runtime });
  return module.exports;
}
const session = load('5-patient/src/liveFaceSession.js');
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
async function settle() { for (let i = 0; i < 8; i++) await Promise.resolve(); }
function timers() {
  let now = Date.UTC(2026, 9, 7, 12), sequence = 0;
  const tasks = new Map();
  return { clock: () => now, advance: ms => { now += ms; },
    schedule: (callback, delay) => { const id = ++sequence; tasks.set(id, { callback, at: now + delay }); return id; },
    cancel: id => tasks.delete(id), size: () => tasks.size,
    nextDelay: () => { const task = [...tasks.values()].sort((a, b) => a.at - b.at)[0]; return task ? task.at - now : null; },
    fire: () => { const item = [...tasks.entries()].sort((a, b) => a[1].at - b[1].at)[0]; assert.ok(item); const [id, task] = item; tasks.delete(id); now = Math.max(now, task.at); return Promise.resolve(task.callback()); },
  };
}
function fixture(overrides = {}) {
  const time = timers(), frames = [], errors = [], recoveries = [];
  let uid = 'synthetic-account-a';
  const loop = session.createLiveFrameLoop({ ...time, getUid: () => uid,
    capture: async () => ({ width: 640, height: 480, capturedAt: new Date(time.clock()).toISOString() }),
    detect: async request => ({ id: request.id, width: request.image.width, height: request.image.height }),
    onFrame: frame => frames.push(frame), onError: error => errors.push(error),
    onRecovering: (error, attempt) => recoveries.push({ error, ...attempt }), onRecoverDetector: async () => {}, ...overrides });
  return { time, loop, frames, errors, recoveries, setUid: value => { uid = value; } };
}

test('two transient detector errors recover without overlapping capture or inference', async () => {
  let calls = 0, restarts = 0;
  const f = fixture({ detect: async request => { if (++calls <= 2) throw new Error('local_timeout'); return { id: request.id, width: 640, height: 480 }; },
    onRecoverDetector: async () => { restarts++; } });
  f.loop.start(); await f.time.fire();
  assert.equal(f.time.nextDelay(), 375); assert.equal(f.frames.length, 0); assert.equal(f.errors.length, 0);
  await f.time.fire(); assert.equal(f.time.nextDelay(), 750);
  await f.time.fire(); assert.equal(f.frames.length, 1); assert.equal(restarts, 2); assert.equal(calls, 3);
  assert.deepEqual(f.recoveries.map(value => [value.kind, value.attempt]), [['detector', 1], ['detector', 2]]);
  f.loop.stop(); assert.equal(f.time.size(), 0);
});

test('successful capture alone cannot reset the detector failure limit', async () => {
  let captures = 0, restarts = 0;
  const failure = new Error('live_frame');
  const f = fixture({ capture: async () => { captures++; return { width: 640, height: 480 }; }, detect: async () => { throw failure; },
    onRecoverDetector: async () => { restarts++; } });
  f.loop.start(); for (let i = 0; i < 3; i++) await f.time.fire();
  assert.equal(captures, 3); assert.equal(restarts, 2); assert.equal(f.errors.length, 1); assert.equal(f.errors[0], failure);
  assert.equal(f.loop.active(), false); assert.equal(f.time.size(), 0);
});

test('a successful inference resets the bounded detector recovery budget', async () => {
  let calls = 0;
  const f = fixture({ detect: async request => { calls++; if ([1, 2, 4, 5].includes(calls)) throw new Error('local_model'); return { id: request.id, width: 640, height: 480 }; } });
  f.loop.start(); for (let i = 0; i < 6; i++) await f.time.fire();
  assert.equal(f.frames.length, 2); assert.equal(f.errors.length, 0);
  assert.deepEqual(f.recoveries.map(value => value.attempt), [1, 2, 1, 2]); f.loop.stop();
});

test('invalid or mismatched outputs stop immediately without restarting a worker', async () => {
  for (const kind of ['mismatch', 'invalid']) {
    let restarts = 0;
    const f = fixture({ detect: async request => {
      if (kind === 'invalid') throw Object.assign(new Error('live_frame'), { retryable: false });
      return { id: request.id, width: 320, height: 480 };
    }, onRecoverDetector: async () => { restarts++; } });
    f.loop.start(); await f.time.fire(); assert.equal(restarts, 0); assert.equal(f.errors.length, 1);
    assert.equal(f.frames.length, 0); assert.equal(f.loop.active(), false); assert.equal(f.time.size(), 0);
  }
});

test('recovery blocks further camera work and suppresses late stop or account responses', async () => {
  for (const reason of ['stop', 'account']) {
    const restart = deferred(); let captures = 0;
    const f = fixture({ capture: async () => { captures++; return { width: 640, height: 480 }; }, detect: async () => { throw new Error('local_timeout'); },
      onRecoverDetector: () => restart.promise });
    f.loop.start(); const tick = f.time.fire(); await settle();
    assert.equal(f.loop.busy(), true); assert.equal(f.time.size(), 0); assert.equal(captures, 1);
    if (reason === 'stop') f.loop.stop(); else f.setUid('synthetic-account-b');
    restart.resolve(); await tick;
    if (reason === 'account') await f.time.fire();
    assert.equal(f.errors.length, 0); assert.equal(f.frames.length, 0); assert.equal(captures, 1); assert.equal(f.loop.active(), false);
  }
});

test('a failed worker restart terminates cleanly with one actionable error', async () => {
  const failure = new Error('local_model');
  const f = fixture({ detect: async () => { throw new Error('local_timeout'); }, onRecoverDetector: async () => { throw failure; } });
  f.loop.start(); await f.time.fire(); assert.equal(f.errors.length, 1); assert.equal(f.errors[0], failure);
  assert.equal(f.loop.active(), false); assert.equal(f.loop.busy(), false); assert.equal(f.time.size(), 0);
});

test('slow analysis remains visible after completion while old face geometry is hidden', () => {
  for (const latency of [1700, 4800, 16800, 21300]) {
    const completed = Date.UTC(2026, 9, 7, 12);
    const frame = { capturedAt: new Date(completed - latency).toISOString(), completedAt: new Date(completed).toISOString() };
    const first = session.getLiveFramePresentation(frame, completed);
    assert.equal(first.resultFresh, true); assert.equal(first.overlayFresh, false); assert.equal(first.sampled, true);
    assert.equal(first.captureAgeMs, latency); assert.equal(first.completionAgeMs, 0);
    assert.equal(session.getLiveFramePresentation(frame, completed + first.expiresAfterMs).resultFresh, true);
    assert.equal(session.getLiveFramePresentation(frame, completed + first.expiresAfterMs + 1).resultFresh, false);
  }
});

test('completion retention is bounded and malformed or future timestamps fail closed', () => {
  const now = Date.UTC(2026, 9, 7, 12), timestamp = value => new Date(value).toISOString();
  const fast = session.getLiveFramePresentation({ capturedAt: timestamp(now - 30), completedAt: timestamp(now) }, now);
  assert.equal(fast.resultFresh, true); assert.equal(fast.overlayFresh, true); assert.equal(fast.sampled, false); assert.equal(fast.expiresAfterMs, 5000);
  const slow = session.getLiveFramePresentation({ capturedAt: timestamp(now - 60000), completedAt: timestamp(now) }, now);
  assert.equal(slow.expiresAfterMs, 90000);
  for (const frame of [{}, { capturedAt: timestamp(now), completedAt: 'bad' },
    { capturedAt: 1, completedAt: timestamp(now) }, { capturedAt: timestamp(now - 1), completedAt: '2026' },
    { capturedAt: timestamp(now + 1), completedAt: timestamp(now) }, { capturedAt: timestamp(now), completedAt: timestamp(now + 1) },
    { capturedAt: timestamp(now), completedAt: timestamp(now - 1) }, { capturedAt: timestamp(now - 1) }]) {
    const result = session.getLiveFramePresentation(frame, now); assert.equal(result.resultFresh, false); assert.equal(result.overlayFresh, false);
  }
});

const source = data => JSON.stringify({ source: 'careconnect-live-face', ...data });
const image = { dataUri: 'data:image/jpeg;base64,c3ludGhldGlj', width: 640, height: 480, capturedAt: '2026-10-07T12:00:00.000Z' };
const rawFrame = () => ({ version: 'live-face-v1', provider: 'face-api.js-local', width: 640, height: 480,
  capturedAt: image.capturedAt, processingTimeMs: 30, faces: [] });
async function bridgeFixture() {
  const live = await livePromise;
  const bridge = load('5-patient/src/liveFaceBridgeClient.js', { '../../shared/liveFace.js': live });
  const time = timers(), sends = [], errors = [], restarts = [], ready = [];
  const controller = bridge.createLiveFaceBridgeController({ ...time, send: (packet, generation) => sends.push({ packet, generation }),
    onRestart: generation => restarts.push(generation), onReady: backend => ready.push(backend), onError: error => errors.push(error) });
  controller.start(); controller.receive(source({ type: 'ready', backend: 'cpu' }), 0);
  return { controller, time, sends, errors, restarts, ready };
}

test('worker restart replaces its generation and ignores late responses with reused request ids', async () => {
  const f = await bridgeFixture();
  const old = f.controller.analyze(image); const cancelled = assert.rejects(old, /local_cancelled/);
  const restart = f.controller.restart(); await cancelled;
  assert.deepEqual(f.restarts, [1]); assert.equal(f.controller.generation(), 1);
  f.controller.receive(source({ type: 'ready', backend: 'webgl' }), 0);
  assert.equal(f.ready.length, 1); await assert.rejects(f.controller.analyze(image), /local_model/);
  f.controller.receive(source({ type: 'ready', backend: 'cpu' }), 1); await restart;
  const next = f.controller.analyze(image); let resolved = false; next.then(() => { resolved = true; });
  f.controller.receive(source({ type: 'result', id: 1, frame: rawFrame() }), 0); await settle(); assert.equal(resolved, false);
  f.controller.receive(source({ type: 'result', id: 1, frame: rawFrame() }), 1);
  assert.equal((await next).width, 640); f.controller.dispose(); assert.equal(f.time.size(), 0);
});

test('timeout makes the old client unavailable until a new worker becomes ready', async () => {
  const f = await bridgeFixture(); const stalled = f.controller.analyze(image);
  const rejected = assert.rejects(stalled, /local_timeout/); await f.time.fire(); await rejected;
  await assert.rejects(f.controller.analyze(image), /local_model/);
  const restarted = f.controller.restart(); f.controller.receive(source({ type: 'ready', backend: 'cpu' }), 1); await restarted;
  const result = f.controller.analyze(image); f.controller.receive(source({ type: 'result', id: 1, frame: rawFrame() }), 1);
  assert.equal((await result).width, 640); f.controller.dispose();
});

test('automatic requests use the reported detector deadline without assuming GPU means SSD', async () => {
  const bridge = load('5-patient/src/liveFaceBridgeClient.js', { '../../shared/liveFace.js': await livePromise });
  for (const [backend, preferred, selected, deadline] of [
    ['cpu', 'tiny', 'auto', 20000], ['cpu', 'ssd', 'auto', 60000], ['webgl', 'ssd', 'auto', 60000],
    ['webgl', undefined, 'auto', 20000], ['webgl', 'SSD', 'auto', 20000],
    ['webgl', { detector: 'ssd' }, 'auto', 20000], ['cpu', 'ssd', 'tiny', 20000], ['cpu', 'tiny', 'ssd', 60000],
  ]) {
    const time = timers();
    const client = bridge.createLiveFaceBridgeClient({ ...time, send() {} });
    client.receive(source({ type: 'ready', backend, detector: preferred }));
    const inference = client.analyze(image, { detector: selected });
    assert.equal(time.nextDelay(), deadline);
    if (deadline === 60000) {
      time.advance(25000);
      assert.equal(time.nextDelay(), 35000, 'automatic SSD remains pending beyond the tiny deadline');
      client.receive(source({ type: 'result', id: 1, frame: rawFrame() }));
      assert.equal((await inference).width, 640);
    } else {
      const failed = assert.rejects(inference, /local_timeout/); await time.fire(); await failed;
    }
    client.dispose(); assert.equal(time.size(), 0);
  }
});

test('restart initialization failure is bounded and does not issue duplicate screen errors', async () => {
  const f = await bridgeFixture(); const restarting = f.controller.restart();
  assert.equal(f.controller.restart(), restarting, 'repeated restart callers share one worker');
  const rejected = assert.rejects(restarting, /local_model/); await f.time.fire(); await rejected;
  assert.equal(f.errors.length, 0); assert.equal(f.time.size(), 0);
  await assert.rejects(f.controller.analyze(image), /local_model/); f.controller.dispose();
});

test('a render process failure rejects active inference so the loop can recover', async () => {
  const f = await bridgeFixture(); const inference = f.controller.analyze(image);
  const failed = assert.rejects(inference, /local_model/); f.controller.failSurface(0); await failed;
  f.controller.failSurface(0);
  assert.equal(f.errors.length, 0, 'no duplicate callback stops the recovery loop');
  const restarted = f.controller.restart(); f.controller.receive(source({ type: 'ready' }), 1); await restarted; f.controller.dispose();
});

test('disposing during restart rejects its waiter and removes every timer', async () => {
  const f = await bridgeFixture(); const restarting = f.controller.restart(); const failed = assert.rejects(restarting, /local_cancelled/);
  f.controller.dispose(); await failed; assert.equal(f.time.size(), 0);
  f.controller.receive(source({ type: 'ready' }), 1); assert.equal(f.ready.length, 1);
  await assert.rejects(f.controller.restart(), /local_cancelled/);
});

test('actual native and web bridge components replace surfaces and dispose the old worker', async () => {
  const bridge = load('5-patient/src/liveFaceBridgeClient.js', { '../../shared/liveFace.js': await livePromise });
  for (const platform of ['native', 'web']) {
    const references = [], state = [], effects = [], packets = [], time = timers(), handle = { current: null }, listeners = new Map();
    let refIndex = 0, stateIndex = 0, effectIndex = 0;
    const React = { createElement: (type, props, ...children) => ({ type, props, children }), forwardRef: component => component,
      useRef: initial => { const index = refIndex++; references[index] ||= { current: initial }; return references[index]; },
      useState: initial => { const index = stateIndex++; if (!(index in state)) state[index] = initial; return [state[index], value => { state[index] = value; }]; },
      useImperativeHandle: (ref, create) => { ref.current = create(); },
      useEffect: effect => { const index = effectIndex++; if (!(index in effects)) effects[index] = effect; } };
    const module = { exports: {} };
    const dependencies = { react: React, 'react-native': { View: 'View', StyleSheet: { create: value => value } },
      'react-native-webview': { WebView: 'WebView' }, '../generated/liveFaceRuntime': { LIVE_FACE_HTML: '<!doctype html>' }, '../liveFaceBridgeClient': bridge };
    vm.runInNewContext(esbuild.transformSync(fs.readFileSync(path.join(root, `5-patient/src/components/LiveFaceBridge.${platform}.js`), 'utf8'),
      { loader: 'jsx', format: 'cjs', target: 'es2020' }).code,
    { module, exports: module.exports, require: name => dependencies[name], setTimeout: time.schedule, clearTimeout: time.cancel,
      window: { addEventListener: (name, receive) => listeners.set(name, receive), removeEventListener: name => listeners.delete(name) } });
    const Component = module.exports.default;
    const render = () => {
      refIndex = stateIndex = effectIndex = 0;
      const tree = Component({}, handle);
      const surface = platform === 'native' ? tree.children[0] : tree;
      const host = platform === 'native' ? { injectJavaScript: code => packets.push(code) }
        : { contentWindow: { postMessage: packet => packets.push(packet) } };
      surface.props.ref.current = host;
      return { surface, host };
    };
    const initial = render(), cleanup = effects[0]();
    const receive = (rendered, data) => platform === 'native'
      ? rendered.surface.props.onMessage({ nativeEvent: { data: source(data) } })
      : listeners.get('message')?.({ source: rendered.host.contentWindow, data: source(data) });
    receive(initial, { type: 'ready', backend: 'cpu' });
    const restarting = handle.current.restart();
    const replacement = render();
    assert.notEqual(initial.surface.props.key, replacement.surface.props.key, 'React destroys the old rendering document');
    assert.ok(packets.some(packet => typeof packet === 'string' ? packet.includes('"type":"dispose"') : packet.type === 'dispose'));
    receive(initial, { type: 'ready', backend: 'cpu' });
    await assert.rejects(handle.current.analyze(image), /local_model/);
    receive(replacement, { type: 'ready', backend: 'cpu' }); await restarting;
    const result = handle.current.analyze(image); let resolved = false; result.then(() => { resolved = true; });
    receive(initial, { type: 'result', id: 1, frame: rawFrame() }); await settle(); assert.equal(resolved, false);
    receive(replacement, { type: 'result', id: 1, frame: rawFrame() }); assert.equal((await result).width, 640);
    cleanup(); assert.equal(time.size(), 0); assert.equal(listeners.size, 0);
  }
});
