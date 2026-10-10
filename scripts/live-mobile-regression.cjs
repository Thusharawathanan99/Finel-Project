const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const project = path.resolve(__dirname, '..');
function load(file, names, dependencies = {}) {
  const code = fs.readFileSync(path.join(project, file), 'utf8').replace(/^import .*;\r?\n/gm, '').replace(/export /g, '');
  const context = vm.createContext({ ...dependencies, console, setTimeout, clearTimeout, AbortController });
  vm.runInContext(code + '\nthis.result={' + names + '};', context);
  return context.result;
}
const face = load('shared/faceReport.js', 'getFaceCopy');
const live = load('shared/liveFace.js', 'validateLiveFrame,getLiveFaceCopy', face);
const bridge = load('5-patient/src/liveFaceBridgeClient.js', 'createLiveFaceBridgeClient', live);
const loops = load('5-patient/src/liveFaceSession.js', 'createLiveFrameLoop,createCloudFrameSampler');
const copy = load('5-patient/src/liveMobileCopy.js', 'getLiveMobileCopy', live);
const image = { dataUri: 'data:image/jpeg;base64,ZmFrZQ==', width: 640, height: 480, capturedAt: '2026-10-05T08:00:00.000Z' };
const frame = () => ({ version: 'live-face-v1', provider: 'face-api.js-local', width: 640, height: 480, capturedAt: image.capturedAt, processingTimeMs: 38, faces: [] });
const pending = () => { let resolve; const promise = new Promise(value => { resolve = value; }); return { promise, resolve }; };
const sent = value => JSON.stringify({ source: 'careconnect-live-face', ...value });
function timers() {
  let id = 0; const queue = new Map();
  return { schedule: (callback, delay) => { queue.set(++id, { callback, delay }); return id; }, cancel: key => queue.delete(key),
    next: async () => { const [key, timer] = queue.entries().next().value || []; if (!timer) throw new Error('No scheduled operation'); queue.delete(key); await timer.callback(); return timer.delay; }, size: () => queue.size };
}
const passed = [];
const test = async (name, work) => { await work(); passed.push(name); console.log('PASS ' + name); };
(async () => {
  await test('Offline bridge accepts only its source and exact request, dimensions and capture time', async () => {
    const calls = []; const timer = timers(); let ready = 0;
    const client = bridge.createLiveFaceBridgeClient({ send: packet => calls.push(packet), onReady: () => ready++, ...timer });
    client.receive(JSON.stringify({ source: 'another-page', type: 'ready' }));
    assert.equal(ready, 0);
    await assert.rejects(client.analyze(image), /local_model/);
    client.receive(sent({ type: 'ready', backend: 'cpu' })); assert.equal(ready, 1);
    const result = client.analyze(image); assert.equal(calls[0].id, 1);
    client.receive(sent({ type: 'result', id: 99, frame: frame() })); assert.equal(timer.size(), 1);
    client.receive(sent({ type: 'result', id: 1, frame: { ...frame(), width: 480, height: 640 } }));
    await assert.rejects(result, /live_frame/);
    const success = client.analyze(image);
    client.receive(sent({ type: 'result', id: 2, frame: { ...frame(), stateScore: 100, emotionLabel: 'Happy' } }));
    const raw = await success; assert.equal(raw.width, 640); assert.equal(raw.stateScore, undefined); assert.equal(raw.emotionLabel, undefined);
    client.dispose();
  });
  await test('Bridge rejects overlapping requests, times out and disposes pending inference', async () => {
    const timer = timers(); const client = bridge.createLiveFaceBridgeClient({ send() {}, ...timer });
    client.receive(sent({ type: 'ready' }));
    const first = client.analyze(image); await assert.rejects(client.analyze(image), /local_busy/);
    const rejected = assert.rejects(first, /local_timeout/); await timer.next(); await rejected;
    await assert.rejects(client.analyze(image), /local_model/);
    // The screen remounts the old worker after a deadline. Simulate only the
    // new generation becoming ready before testing its request cancellation.
    client.receive(sent({ type: 'ready' }));
    const second = client.analyze(image); const disposed = assert.rejects(second, /local_cancelled/); client.dispose(); await disposed;
    assert.equal(timer.size(), 0); await assert.rejects(client.analyze(image), /local_model/);
  });
  await test('An invalid timestamp or landmark response cannot become a live result', async () => {
    const timer = timers(); const client = bridge.createLiveFaceBridgeClient({ send() {}, ...timer });
    client.receive(sent({ type: 'ready' })); const result = client.analyze(image);
    client.receive(sent({ type: 'result', id: 1, frame: { ...frame(), capturedAt: '2026-10-05T08:00:01.000Z' } }));
    await assert.rejects(result, /live_frame/); client.dispose();
  });
  await test('Detailed CPU requests finish beyond 20 seconds while remaining bounded and single-inflight', async () => {
    let now = 0, sequence = 0; const tasks = new Map(), calls = [];
    const client = bridge.createLiveFaceBridgeClient({ send: packet => calls.push(packet),
      schedule: (callback, delay) => { const id = ++sequence; tasks.set(id, { callback, at: now + delay }); return id; },
      cancel: id => tasks.delete(id),
    });
    const advance = milliseconds => { now += milliseconds; for (const [id, task] of tasks) if (task.at <= now) { tasks.delete(id); task.callback(); } };
    client.receive(sent({ type: 'ready', backend: 'cpu' }));
    const detailed = client.analyze(image, { detector: 'ssd' });
    advance(25000);
    assert.equal(tasks.size, 1);
    await assert.rejects(client.analyze(image), /local_busy/);
    client.receive(sent({ type: 'result', id: calls[0].id, frame: frame() }));
    assert.equal((await detailed).width, image.width); assert.equal(tasks.size, 0);
    const stalled = client.analyze(image, { detector: 'ssd' });
    const expired = assert.rejects(stalled, /local_timeout/);
    advance(59999); assert.equal(tasks.size, 1);
    advance(1); await expired;
    await assert.rejects(client.analyze(image), /local_model/);
    client.receive(sent({ type: 'ready' }));
    const ordinary = client.analyze(image);
    const ordinaryExpiry = assert.rejects(ordinary, /local_timeout/);
    client.receive(sent({ type: 'result', id: calls[1].id, frame: frame() }));
    assert.equal(tasks.size, 1, 'a late detailed result cannot finish the next request');
    advance(20000); await ordinaryExpiry;
    client.dispose(); assert.equal(tasks.size, 0);
  });
  await test('Local loop samples adaptively, pairs the exact image and has one operation in flight', async () => {
    const timer = timers(); const capture = pending(); const displayed = []; let reads = 0, detects = 0, now = 0;
    const loop = loops.createLiveFrameLoop({ getUid: () => 'A', clock: () => now, ...timer,
      capture: async () => { reads++; return capture.promise; }, detect: async packet => { detects++; now = 250; return { ...frame(), id: packet.id }; },
      onFrame: value => displayed.push(value), onError: error => { throw error; },
    });
    loop.start(); loop.start(); const tick = timer.next(); assert.equal(reads, 1); assert.equal(timer.size(), 0);
    capture.resolve(image); await tick;
    assert.equal(detects, 1); assert.equal(displayed[0].image.dataUri, image.dataUri); assert.equal(displayed[0].width, image.width);
    assert.equal(await timer.next(), 25); loop.stop();
  });
  await test('Stopping or changing accounts discards late local frames', async () => {
    for (const stop of [true, false]) {
      const timer = timers(); const capture = pending(); let uid = 'A'; let detected = 0; let displayed = 0;
      const loop = loops.createLiveFrameLoop({ getUid: () => uid, ...timer, capture: () => capture.promise,
        detect: async packet => { detected++; return { ...frame(), id: packet.id }; }, onFrame: () => displayed++, onError() {},
      });
      loop.start(); const work = timer.next(); if (stop) loop.stop(); else uid = 'B';
      capture.resolve(image); await work; assert.equal(detected, 0); assert.equal(displayed, 0); loop.stop();
    }
  });
  await test('A mismatched decoded frame stops local sampling without a fabricated result', async () => {
    const timer = timers(); let errors = 0; let outputs = 0;
    const loop = loops.createLiveFrameLoop({ getUid: () => 'A', ...timer, capture: async () => image,
      detect: async packet => ({ ...frame(), id: packet.id, width: 320 }), onFrame: () => outputs++, onError: () => errors++,
    });
    loop.start(); await timer.next(); assert.equal(outputs, 0); assert.equal(errors, 1); assert.equal(loop.active(), false); assert.equal(timer.size(), 0);
  });
  await test('Cloud assistance is opt-in, never overlaps and waits at least 15 seconds', async () => {
    let uid = 'A', now = 0, requests = 0; const response = pending(); const reports = [];
    const sampler = loops.createCloudFrameSampler({ getUid: () => uid, clock: () => now,
      analyze: async () => { requests++; return response.promise; }, onReport: report => reports.push(report), onError() {},
    });
    await sampler.sample(image); assert.equal(requests, 0);
    sampler.enable(); const first = sampler.sample(image); await sampler.sample(image); assert.equal(requests, 1);
    response.resolve({ faceCount: 0 }); await first; assert.equal(reports[0].image.dataUri, image.dataUri);
    now = 14999; await sampler.sample(image); assert.equal(requests, 1);
    now = 15000; await sampler.sample(image); assert.equal(requests, 2); sampler.disable();
  });
  await test('Cloud setup failures stop sampling until another explicit enable', async () => {
    let calls = 0, errors = 0;
    const sampler = loops.createCloudFrameSampler({ getUid: () => 'A', clock: () => 100000,
      analyze: async () => { calls++; throw new Error('notConfigured'); }, onReport() { throw new Error('Unexpected report'); }, onError: () => errors++,
    });
    sampler.enable(); await sampler.sample(image); await sampler.sample(image);
    assert.equal(sampler.enabled(), false); assert.equal(calls, 1); assert.equal(errors, 1);
  });
  await test('Disabling cloud assistance or changing UID ignores late cloud reports', async () => {
    for (const disable of [true, false]) {
      let uid = 'A', reports = 0; const pendingResponse = pending();
      const sampler = loops.createCloudFrameSampler({ getUid: () => uid, analyze: () => pendingResponse.promise, onReport: () => reports++, onError() {} });
      sampler.enable(); const work = sampler.sample(image); if (disable) sampler.disable(); else uid = 'B';
      pendingResponse.resolve({ faceCount: 0 }); await work; assert.equal(reports, 0); sampler.disable();
    }
  });
  await test('Every live-control key has English, Tamil and Sinhala copy', async () => {
    const keys = language => Object.keys(copy.getLiveMobileCopy(language)).sort();
    assert.deepEqual(keys('en'), keys('ta')); assert.deepEqual(keys('en'), keys('si'));
    assert.notEqual(copy.getLiveMobileCopy('ta').cloudConsent, copy.getLiveMobileCopy('en').cloudConsent);
    assert.notEqual(copy.getLiveMobileCopy('si').freeze, copy.getLiveMobileCopy('en').freeze);
  });
  console.log('Passed ' + passed.length + ' live mobile regression checks.');
})().catch(error => { console.error(error); process.exitCode = 1; });
