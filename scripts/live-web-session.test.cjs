// Test the actual browser session service and shared tracker with offline browser doubles.
// No cameras, model downloads, worker inference, patient data or cloud requests.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const project = path.resolve(__dirname, '..');
const esbuild = require(path.join(project, '1-ui-ux/node_modules/esbuild'));
const entry = path.join(project, '1-ui-ux/src/app/ml/live/LiveFaceSession.ts');
const epoch = Date.UTC(2026, 9, 5, 12);

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function settle() { for (let i = 0; i < 12; i++) await Promise.resolve(); }
function rawFrame(request, overrides = {}) {
  const scores = Object.fromEntries(['angry', 'disgusted', 'fearful', 'happy', 'neutral', 'sad', 'surprised']
    .map(key => [key, key === 'happy' ? 0.9 : 0.1 / 6]));
  return { version: 'live-face-v1', provider: 'face-api.js-local', width: request.frame.width, height: request.frame.height,
    capturedAt: request.frame.capturedAt, processingTimeMs: 20,
    faces: [{ box: { x: 0.2, y: 0.1, width: 0.4, height: 0.6 }, detectionConfidence: 0.95, scores,
      landmarks: Array.from({ length: 68 }, () => ({ x: 0.4, y: 0.4 })) }], ...overrides };
}

function browserFixture(options = {}) {
  let now = 0, timerSequence = 0, sessionSequence = 0;
  const timers = new Map(), workers = [], canvases = [], draws = [], reads = [], images = [], dimensionWrites = [];
  class FixtureDate extends Date {
    constructor(...args) { super(...(args.length ? args : [epoch + now])); }
    static now() { return epoch + now; }
  }
  const schedule = (callback, delay) => { const id = ++timerSequence; timers.set(id, { callback, at: now + delay, delay }); return id; };
  const cancel = id => timers.delete(id);
  class FixtureWorker {
    constructor(url, config) { this.url = url; this.config = config; this.messages = []; this.terminated = false; this.terminateCount = 0; workers.push(this); }
    postMessage(message, transfer) {
      if (this.terminated) throw new Error('synthetic-terminated-worker');
      this.messages.push({ ...message, transfer });
    }
    terminate() { this.terminated = true; this.terminateCount++; }
    reply(request, fields = {}) { this.onmessage?.({ data: { type: 'result', id: request.id, ...fields } }); }
    fail(request, code = 'MODEL_UNAVAILABLE') { this.onmessage?.({ data: { type: 'error', id: request.id, code } }); }
    crash() { this.onerror?.({ message: 'synthetic-worker-error' }); }
  }
  class FixtureImage {
    constructor() { this.naturalWidth = options.imageWidth ?? 1920; this.naturalHeight = options.imageHeight ?? 1080; images.push(this); }
    decode() { return options.decode ? options.decode(this) : Promise.resolve(); }
  }
  const document = { hidden: false, createElement(tag) {
    assert.equal(tag, 'canvas');
    const canvas = { width: 0, height: 0, getContext(kind, config) {
      assert.equal(kind, '2d');
      if (options.noContext) return null;
      return { drawImage(...args) { draws.push({ canvas, args }); }, getImageData(x, y, width, height) {
        const data = new Uint8ClampedArray(width * height * 4);
        reads.push({ canvas, x, y, width, height, data, config }); return { data };
      } };
    } };
    let canvasWidth=0,canvasHeight=0;
    Object.defineProperties(canvas, {
      width: { get:()=>canvasWidth, set:value=>{canvasWidth=value;dimensionWrites.push({axis:'width',value,canvas});} },
      height: { get:()=>canvasHeight, set:value=>{canvasHeight=value;dimensionWrites.push({axis:'height',value,canvas});} },
    });
    canvases.push(canvas); return canvas;
  } };
  const context = vm.createContext({ URL, Worker: FixtureWorker, Image: FixtureImage, document,
    location: { origin: 'https://offline.example' }, Date: FixtureDate,
    performance: { now: () => now }, setTimeout: schedule, clearTimeout: cancel,
    crypto: { randomUUID: () => 'synthetic-session-' + (++sessionSequence) }, console });
  const cache = new Map();
  function load(filename) {
    if (cache.has(filename)) return cache.get(filename).exports;
    const module = { exports: {} }; cache.set(filename, module);
    const code = esbuild.transformSync(fs.readFileSync(filename, 'utf8'), {
      loader: filename.endsWith('.ts') ? 'ts' : 'js', format: 'cjs', target: 'es2020',
      define: { 'import.meta.url': JSON.stringify('https://offline.example/LiveFaceSession.ts') },
    }).code;
    const wrapper = vm.runInContext('(function(require,module,exports){\n' + code + '\n})', context, { filename });
    wrapper(specifier => {
      assert.ok(specifier.startsWith('.'), 'only actual relative application modules are loaded');
      const resolved = path.resolve(path.dirname(filename), specifier);
      const target = [resolved, resolved + '.ts', resolved + '.js'].find(file => fs.existsSync(file) && fs.statSync(file).isFile());
      assert.ok(target, 'resolvable source import: ' + specifier); return load(target);
    }, module, module.exports);
    return module.exports;
  }
  const service = load(entry);
  const video = { videoWidth: options.videoWidth ?? 1920, videoHeight: options.videoHeight ?? 1080, readyState: 4, paused: false };
  return { service, video, workers, canvases, document, draws, reads, images, dimensionWrites,
    advance(milliseconds) { now += milliseconds; },
    pending: () => timers.size,
    pendingDelays: () => [...timers.values()].map(timer => timer.at - now),
    nextDelay: () => Math.min(...[...timers.values()].map(timer => timer.at - now)),
    async fireNext() {
      const next = [...timers.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      assert.ok(next, 'expected an outstanding browser timer');
      const [id, timer] = next; timers.delete(id); now = Math.max(now, timer.at);
      timer.callback(); await settle();
    },
  };
}
function latest(worker, type) { return worker.messages.filter(message => message.type === type).at(-1); }
async function initializeLive(f, options = {}) {
  const frames = [], statuses = [];
  const starting = f.service.startLiveFaceDetection(f.video, frame => frames.push(frame), status => statuses.push(status), options);
  const worker = f.workers[0], init = latest(worker, 'init');
  assert.ok(init); worker.reply(init, { backend: 'cpu' });
  const stop = await starting; await settle();
  return { worker, stop, frames, statuses };
}

test('browser service configures a module worker and initializes self-hosted selected models', async () => {
  const f = browserFixture(); const run = await initializeLive(f, { detector: 'ssd' });
  assert.ok(run.worker.url instanceof URL);
  assert.match(run.worker.url.href, /face\.worker\.ts$/); assert.equal(run.worker.config.type, 'module');
  const init = latest(run.worker, 'init');
  assert.equal(init.options.modelsPath, 'https://offline.example/models/face-api'); assert.equal(init.options.detector, 'ssd');
  assert.deepEqual(run.statuses.map(status => status.state), ['loading', 'running']);
  assert.equal(run.statuses[1].backend, 'cpu'); run.stop(); assert.equal(f.pending(), 0);
});

test('a signal aborted before initialization creates no request, result or running status', async () => {
  const f = browserFixture(), controller = new AbortController(), frames = [], statuses = [];
  controller.abort();
  const stop = await f.service.startLiveFaceDetection(f.video, frame => frames.push(frame), status => statuses.push(status), { signal: controller.signal });
  assert.equal(f.workers[0].messages.length, 0); assert.equal(f.workers[0].terminated, true);
  assert.equal(frames.length, 0); assert.equal(statuses.length, 0); assert.equal(f.pending(), 0);
  stop(); assert.equal(f.workers[0].terminateCount, 1);
});

test('aborting model initialization clears its timeout and ignores a late model response', async () => {
  const f = browserFixture(), controller = new AbortController(), frames = [], statuses = [];
  const starting = f.service.startLiveFaceDetection(f.video, frame => frames.push(frame), status => statuses.push(status), { signal: controller.signal });
  const worker = f.workers[0], init = latest(worker, 'init'); controller.abort();
  const stop = await starting; worker.reply(init, { backend: 'webgl' }); await settle();
  assert.equal(worker.terminated, true); assert.equal(f.pending(), 0); assert.equal(frames.length, 0);
  assert.deepEqual(statuses.map(status => status.state), ['loading']); stop();
});

test('live frames scale the long side to 640 pixels without upscaling or changing aspect ratio', async () => {
  for (const [width, height, expectedWidth, expectedHeight] of [[1920, 1080, 640, 360], [720, 1280, 360, 640], [320, 240, 320, 240]]) {
    const f = browserFixture({ videoWidth: width, videoHeight: height }); const run = await initializeLive(f);
    const request = latest(run.worker, 'frame');
    assert.equal(request.frame.width, expectedWidth); assert.equal(request.frame.height, expectedHeight);
    assert.equal(request.frame.pixels.byteLength, expectedWidth * expectedHeight * 4);
    assert.equal(request.transfer.length, 1); assert.equal(request.transfer[0], request.frame.pixels);
    assert.equal(f.reads[0].config.willReadFrequently, true);
    assert.equal(f.draws[0].args[0], f.video); assert.equal(f.draws[0].args[3], expectedWidth); assert.equal(f.draws[0].args[4], expectedHeight);
    assert.equal(latest(run.worker, 'init').options.detector, 'tiny'); run.stop(); assert.equal(f.pending(), 0);
  }
});

test('browser inference remains single-inflight and adapts scheduling after slow frames', async () => {
  const f = browserFixture(); const run = await initializeLive(f);
  const first = latest(run.worker, 'frame'); assert.ok(first);
  f.advance(1100); await settle(); assert.equal(run.worker.messages.filter(message => message.type === 'frame').length, 1);
  run.worker.reply(first, { frame: rawFrame(first) }); await settle();
  assert.equal(run.frames.length, 1); assert.equal(f.nextDelay(), 15);
  await f.fireNext(); const second = latest(run.worker, 'frame'); assert.notEqual(second.id, first.id);
  assert.equal(run.worker.messages.filter(message => message.type === 'frame').length, 2);
  f.advance(10); run.worker.reply(second, { frame: rawFrame(second) }); await settle();
  assert.equal(f.nextDelay(), 110); run.stop(); assert.equal(f.pending(), 0);
});

test('fast local inference uses a 120ms default cadence and preserves an explicit slower interval', async () => {
  for (const [options, interval] of [[{},120],[{minIntervalMs:240},240],[{minIntervalMs:NaN},120],[{minIntervalMs:0},120]]) {
    const f=browserFixture(),run=await initializeLive(f,options);
    const first=latest(run.worker,'frame');f.advance(20);run.worker.reply(first,{frame:rawFrame(first)});await settle();
    assert.equal(f.nextDelay(),interval-20);
    await f.fireNext();const second=latest(run.worker,'frame');
    assert.equal(Date.parse(second.frame.capturedAt)-Date.parse(first.frame.capturedAt),interval);
    assert.equal(run.worker.messages.filter(message=>message.type==='frame').length,2);
    run.stop();assert.equal(f.pending(),0);
  }
});

test('canvas backing dimensions are reused across frames and changed only for a real size change', async () => {
  const f=browserFixture(),run=await initializeLive(f);
  assert.equal(f.dimensionWrites.length,2);
  const reply=async()=>{const request=latest(run.worker,'frame');run.worker.reply(request,{frame:rawFrame(request)});await settle();};
  await reply();await f.fireNext();assert.equal(f.dimensionWrites.length,2);
  await reply();f.video.videoWidth=1280;f.video.videoHeight=720;await f.fireNext();
  assert.equal(f.dimensionWrites.length,2);assert.equal(latest(run.worker,'frame').frame.width,640);
  await reply();f.video.videoWidth=720;f.video.videoHeight=1280;await f.fireNext();
  assert.equal(f.dimensionWrites.length,4);
  assert.equal(latest(run.worker,'frame').frame.width,360);assert.equal(latest(run.worker,'frame').frame.height,640);
  run.stop();assert.equal(f.pending(),0);
});

test('unchanged presented video frames are not re-inferred or used to stabilize an uncertain estimate', async () => {
  const f=browserFixture();let totalVideoFrames=1,droppedVideoFrames=0;
  f.video.currentTime=0;f.video.getVideoPlaybackQuality=()=>({totalVideoFrames,droppedVideoFrames});
  const run=await initializeLive(f),first=latest(run.worker,'frame');
  run.worker.reply(first,{frame:rawFrame(first)});await settle();
  assert.equal(run.frames[0].faces[0].expression,'uncertain');
  for(let i=0;i<3;i++)await f.fireNext();
  assert.equal(f.reads.length,1);assert.equal(run.worker.messages.filter(message=>message.type==='frame').length,1);
  totalVideoFrames++;droppedVideoFrames++;await f.fireNext();
  assert.equal(f.reads.length,1,'dropped frames do not imply new camera pixels');
  totalVideoFrames++;await f.fireNext();const second=latest(run.worker,'frame');
  assert.notEqual(second.id,first.id);assert.equal(f.reads.length,2);
  run.worker.reply(second,{frame:rawFrame(second)});await settle();
  assert.equal(run.frames.length,2);assert.equal(run.frames[1].faces[0].expression,'uncertain');
  run.stop();assert.equal(f.pending(),0);
});

test('media-time freshness is a safe fallback when playback statistics are absent, malformed or throw', async () => {
  for(const quality of [undefined,()=>({totalVideoFrames:0,droppedVideoFrames:0}),()=>({totalVideoFrames:NaN}),()=>{throw Error('NO_STATISTICS');}]){
    const f=browserFixture();f.video.currentTime=0;
    if(quality)f.video.getVideoPlaybackQuality=quality;
    const run=await initializeLive(f),first=latest(run.worker,'frame');
    run.worker.reply(first,{frame:rawFrame(first)});await settle();await f.fireNext();
    assert.equal(f.reads.length,1);
    f.video.currentTime=0.033;await f.fireNext();const second=latest(run.worker,'frame');
    assert.notEqual(second.id,first.id);assert.equal(f.reads.length,2);
    run.stop();assert.equal(f.pending(),0);
  }
});

test('stop clears freshness polling and an inference completed on a hidden page is not published', async () => {
  const f=browserFixture();f.video.currentTime=0;
  const run=await initializeLive(f),first=latest(run.worker,'frame');f.document.hidden=true;
  run.worker.reply(first,{frame:rawFrame(first)});await settle();
  assert.equal(run.frames.length,0);await f.fireNext();assert.equal(f.reads.length,1);
  f.document.hidden=false;f.video.currentTime=0.05;await f.fireNext();
  const second=latest(run.worker,'frame');run.worker.reply(second,{frame:rawFrame(second)});await settle();
  assert.equal(run.frames.length,1);await f.fireNext();assert.equal(f.reads.length,2);
  run.stop();assert.equal(f.pending(),0);assert.equal(run.worker.terminated,true);
});

test('explicit stop and abort during inference prevent late frame publication and clear every timer', async () => {
  for (const action of ['stop', 'abort']) {
    const f = browserFixture(), controller = new AbortController(); const run = await initializeLive(f, { signal: controller.signal });
    const request = latest(run.worker, 'frame');
    if (action === 'stop') run.stop(); else controller.abort();
    run.worker.reply(request, { frame: rawFrame(request) }); await settle();
    assert.equal(run.frames.length, 0); assert.equal(run.worker.terminated, true); assert.equal(f.pending(), 0);
    assert.equal(run.statuses.some(status => status.state === 'unavailable'), false);
    const terminated = run.worker.terminateCount; run.stop(); assert.equal(run.worker.terminateCount, terminated);
  }
});

test('late results from a stopped worker cannot appear in a restarted browser session', async () => {
  const f = browserFixture(), old = await initializeLive(f); const oldRequest = latest(old.worker, 'frame'); old.stop();
  const frames = [], statuses = [];
  const restarting = f.service.startLiveFaceDetection(f.video, frame => frames.push(frame), status => statuses.push(status));
  const worker = f.workers[1]; worker.reply(latest(worker, 'init'), { backend: 'webgl' }); const stop = await restarting;
  old.worker.reply(oldRequest, { frame: rawFrame(oldRequest) }); await settle();
  assert.equal(old.frames.length, 0); assert.equal(frames.length, 0);
  const next = latest(worker, 'frame'); worker.reply(next, { frame: rawFrame(next) }); await settle();
  assert.equal(frames.length, 1); assert.equal(statuses[1].backend, 'webgl'); stop(); assert.equal(f.pending(), 0);
});

test('hidden pages pause capture and inference until the page becomes visible', async () => {
  const f = browserFixture(); f.document.hidden = true; const run = await initializeLive(f);
  assert.equal(run.worker.messages.filter(message => message.type === 'frame').length, 0); assert.equal(f.draws.length, 0);
  await f.fireNext(); assert.equal(f.reads.length, 0);
  f.document.hidden = false; await f.fireNext(); const request = latest(run.worker, 'frame'); assert.ok(request);
  run.worker.reply(request, { frame: rawFrame(request) }); await settle();
  f.document.hidden = true; await f.fireNext();
  assert.equal(run.worker.messages.filter(message => message.type === 'frame').length, 1);
  f.document.hidden = false; await f.fireNext();
  assert.equal(run.worker.messages.filter(message => message.type === 'frame').length, 2); run.stop();
});

test('paused or unready video does not capture stale or empty camera pixels', async () => {
  for (const fields of [{ paused: true }, { readyState: 1 }, { videoWidth: 0 }, { videoHeight: 0 }]) {
    const f = browserFixture(); Object.assign(f.video, fields); const run = await initializeLive(f);
    assert.equal(run.worker.messages.filter(message => message.type === 'frame').length, 0); assert.equal(f.draws.length, 0);
    run.stop(); assert.equal(f.pending(), 0);
  }
});

test('worker crashes during initialization or inference report unavailable and release resources', async () => {
  for (const stage of ['init', 'frame']) {
    const f = browserFixture(), frames = [], statuses = [];
    const starting = f.service.startLiveFaceDetection(f.video, frame => frames.push(frame), status => statuses.push(status));
    const worker = f.workers[0];
    if (stage === 'frame') { worker.reply(latest(worker, 'init'), { backend: 'cpu' }); await starting; await settle(); }
    worker.crash(); await starting; await settle();
    assert.equal(worker.terminated, true); assert.equal(f.pending(), 0); assert.equal(frames.length, 0);
    assert.equal(statuses.at(-1).state, 'unavailable'); assert.equal(statuses.at(-1).code, 'MODEL_UNAVAILABLE');
  }
});

test('model initialization and frame timeouts terminate the worker and stop future detection', async () => {
  for (const stage of ['init', 'frame']) {
    const f = browserFixture(), frames = [], statuses = [];
    const starting = f.service.startLiveFaceDetection(f.video, frame => frames.push(frame), status => statuses.push(status));
    const worker = f.workers[0];
    if (stage === 'frame') { worker.reply(latest(worker, 'init'), { backend: 'cpu' }); await starting; await settle(); }
    assert.equal(f.nextDelay(), 30000); await f.fireNext(); await starting; await settle();
    assert.equal(worker.terminated, true); assert.equal(f.pending(), 0); assert.equal(frames.length, 0);
    assert.equal(statuses.at(-1).state, 'unavailable');
  }
});

test('missing canvas support and malformed worker output fail safely without publishing invented scores', async () => {
  const missing = browserFixture({ noContext: true }); const unavailable = await initializeLive(missing);
  assert.equal(unavailable.worker.terminated, true); assert.equal(unavailable.statuses.at(-1).state, 'unavailable'); assert.equal(missing.pending(), 0);
  const f = browserFixture(); const run = await initializeLive(f); const request = latest(run.worker, 'frame');
  const invalid = rawFrame(request); invalid.faces[0].scores.happy = NaN;
  run.worker.reply(request, { frame: invalid }); await settle();
  assert.equal(run.frames.length, 0); assert.equal(run.statuses.at(-1).state, 'unavailable');
  assert.equal(run.worker.terminated, true); assert.equal(f.pending(), 0);
});

test('still-photo analysis preserves its selected timestamp, scales to 960 and uses a stable one-frame estimate', async () => {
  const f = browserFixture(), capturedAt = '2026-10-05T10:00:00.123Z', dataUrl = 'data:image/jpeg;base64,AA==';
  const analysis = f.service.analyzeFacePhoto(dataUrl, 'ssd', { capturedAt }); const worker = f.workers[0];
  assert.equal(latest(worker, 'init').options.detector, 'ssd');
  worker.reply(latest(worker, 'init'), { backend: 'cpu' }); await settle();
  assert.equal(f.images[0].src, dataUrl);
  const request = latest(worker, 'frame'); assert.ok(request);
  assert.equal(request.frame.width, 960); assert.equal(request.frame.height, 540); assert.equal(request.frame.capturedAt, capturedAt);
  assert.equal(request.transfer[0], request.frame.pixels);
  worker.reply(request, { frame: rawFrame(request) }); const result = await analysis;
  assert.equal(result.width, 960); assert.equal(result.height, 540); assert.equal(result.capturedAt, capturedAt);
  assert.equal(result.faces[0].expression, 'happy'); assert.equal(result.faces[0].stable, true);
  assert.ok(Math.abs(result.faces[0].expressionConfidence - 0.9) < 0.000001);
  assert.equal(worker.terminated, true); assert.equal(f.pending(), 0);
});

test('still-photo abort before initialization and during inference rejects and releases its worker', async () => {
  for (const stage of ['before', 'init', 'frame']) {
    const f = browserFixture(), controller = new AbortController(); if (stage === 'before') controller.abort();
    const analysis = f.service.analyzeFacePhoto('data:image/jpeg;base64,AA==', 'tiny', { signal: controller.signal });
    const rejected = assert.rejects(analysis, /STOPPED/), worker = f.workers[0];
    if (stage === 'frame') { worker.reply(latest(worker, 'init'), { backend: 'cpu' }); await settle(); assert.ok(latest(worker, 'frame')); }
    if (stage !== 'before') controller.abort(); await rejected;
    assert.equal(worker.terminated, true); assert.equal(f.pending(), 0);
  }
});

test('still-photo cancellation during decode never submits decoded private pixels for inference', async () => {
  const decode = deferred(), f = browserFixture({ decode: () => decode.promise }), controller = new AbortController();
  const analysis = f.service.analyzeFacePhoto('data:image/jpeg;base64,AA==', 'tiny', { signal: controller.signal });
  const rejected = assert.rejects(analysis, /STOPPED/), worker = f.workers[0];
  worker.reply(latest(worker, 'init'), { backend: 'cpu' }); await settle(); assert.equal(f.images.length, 1);
  controller.abort(); decode.resolve(); await rejected;
  assert.equal(worker.messages.filter(message => message.type === 'frame').length, 0);
  assert.equal(worker.terminated, true); assert.equal(f.pending(), 0);
});

test('a photo cancelled after worker reply but before promise continuation cannot return a late private report', async () => {
  const f = browserFixture(), controller = new AbortController();
  const analysis = f.service.analyzeFacePhoto('data:image/jpeg;base64,AA==', 'tiny', { signal: controller.signal });
  const rejected = assert.rejects(analysis, /STOPPED/), worker = f.workers[0];
  worker.reply(latest(worker, 'init'), { backend: 'cpu' }); await settle();
  const request = latest(worker, 'frame'); worker.reply(request, { frame: rawFrame(request) });
  controller.abort(); await rejected;
  assert.equal(worker.terminated, true); assert.equal(f.pending(), 0);
});

test('still-photo decode and worker errors reject without retaining a worker or timeout', async () => {
  const broken = browserFixture({ decode: async () => { throw new Error('synthetic-decode-failure'); } });
  const decodeResult = broken.service.analyzeFacePhoto('data:image/jpeg;base64,AA==');
  const decodeRejected = assert.rejects(decodeResult, /synthetic-decode-failure/); broken.workers[0].reply(latest(broken.workers[0], 'init'), { backend: 'cpu' });
  await decodeRejected; assert.equal(broken.workers[0].terminated, true); assert.equal(broken.pending(), 0);
  const f = browserFixture(); const result = f.service.analyzeFacePhoto('data:image/jpeg;base64,AA=='); const rejected = assert.rejects(result, /SYNTHETIC_WORKER_FAILURE/);
  f.workers[0].fail(latest(f.workers[0], 'init'), 'SYNTHETIC_WORKER_FAILURE'); await rejected;
  assert.equal(f.workers[0].terminated, true); assert.equal(f.pending(), 0);
});
