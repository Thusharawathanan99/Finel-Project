import { validateLiveFrame } from '../../shared/liveFace.js';

export function createLiveFaceBridgeClient({ send, onReady = () => {}, onError = () => {},
  schedule = setTimeout, cancel = clearTimeout }) {
  let ready = false, disposed = false, faulted = false, preferredDetector = null, sequence = 0, pending = null;
  const idleListeners = [];
  const notifyIdle = () => { for (const resolve of idleListeners.splice(0)) resolve(); };
  const fail = error => { if (pending) { cancel(pending.timer); pending.reject(error); pending = null; } notifyIdle(); };
  const invalidFrame = () => Object.assign(new Error('live_frame'), { retryable: false });
  return {
    receive(value) {
      if (disposed || typeof value !== 'string' || value.length > 1000000) return;
      let message;
      try { message = JSON.parse(value); } catch { return; }
      if (!message || message.source !== 'careconnect-live-face') return;
      if (message.type === 'ready') {
        preferredDetector = ['tiny', 'ssd'].includes(message.detector) ? message.detector : null;
        ready = true; faulted = false; onReady(message.backend || 'local'); return;
      }
      if (message.type === 'error' && !message.id) {
        if (faulted) return;
        const requested = !!pending;
        ready = false; faulted = true; fail(new Error('local_model'));
        // A running request is recovered by its loop. A second screen-level
        // error callback would stop that loop before recovery can start.
        if (!requested) onError(new Error('local_model'));
        return;
      }
      if (!pending || message.id !== pending.id) return;
      if (message.type === 'error') { fail(message.code === 'INVALID_FRAME' ? invalidFrame() : new Error('live_frame')); return; }
      if (message.type !== 'result') return;
      const current = pending;
      try {
        const frame = validateLiveFrame(message.frame);
        if (frame.width !== current.image.width || frame.height !== current.image.height || frame.capturedAt !== current.image.capturedAt) throw new Error('mismatched_frame');
        cancel(current.timer); pending = null; current.resolve(frame); notifyIdle();
      } catch { fail(invalidFrame()); }
    },
    analyze(image, { detector = 'auto' } = {}) {
      if (disposed || !ready) return Promise.reject(new Error('local_model'));
      if (pending) return Promise.reject(new Error('local_busy'));
      if (!['auto', 'tiny', 'ssd'].includes(detector)) return Promise.reject(invalidFrame());
      if (!image || typeof image.dataUri !== 'string' || !image.dataUri.startsWith('data:image/jpeg;base64,') || image.dataUri.length > 3000000 ||
          !Number.isInteger(image.width) || !Number.isInteger(image.height) || image.width < 1 || image.height < 1 || image.width * image.height > 1000000 || !image.capturedAt) return Promise.reject(invalidFrame());
      return new Promise((resolve, reject) => {
        const id = ++sequence;
        // SSD requests, including a reported automatic SSD choice, can take
        // longer. A GPU label alone does not establish which detector is used.
        const timeoutMs = detector === 'ssd' || detector === 'auto' && preferredDetector === 'ssd' ? 60000 : 20000;
        pending = { id, image, resolve, reject, timer: schedule(() => { ready = false; faulted = true; fail(new Error('local_timeout')); }, timeoutMs) };
        try { send({ type: 'analyze', id, image, detector }); } catch { fail(new Error('live_frame')); }
      });
    },
    waitForIdle() { return pending ? new Promise(resolve => idleListeners.push(resolve)) : Promise.resolve(); },
    dispose() { disposed = true; ready = false; fail(new Error('local_cancelled')); },
  };
}

// Own both the request client and the real rendering surface. Restart always
// changes the WebView/iframe key, destroying its document and worker. Responses
// from the destroyed generation cannot satisfy a new request with a reused id.
export function createLiveFaceBridgeController({ send, onReady = () => {}, onError = () => {},
  onRestart = () => {}, schedule = setTimeout, cancel = clearTimeout, startupTimeoutMs = 20000 }) {
  let generation = 0, disposed = false, ready = false, startupTimer = null, restartWaiter = null, client;
  const clearStartup = () => { if (startupTimer !== null) cancel(startupTimer); startupTimer = null; };
  const settleRestart = error => {
    if (!restartWaiter) return;
    const waiter = restartWaiter; restartWaiter = null;
    if (error) waiter.reject(error); else waiter.resolve();
  };
  const createClient = token => createLiveFaceBridgeClient({ schedule, cancel,
    send: packet => { if (disposed || token !== generation) throw new Error('local_cancelled'); send(packet, token); },
    onReady: backend => {
      if (disposed || token !== generation) return;
      ready = true; clearStartup(); settleRestart(); onReady(backend);
    },
    onError: error => {
      if (disposed || token !== generation) return;
      ready = false; clearStartup();
      const recovering = !!restartWaiter;
      settleRestart(error);
      // During a restart the awaiting loop owns the terminal recovery failure.
      if (!recovering) onError(error);
    },
  });
  const armStartup = () => {
    clearStartup();
    if (disposed || ready) return;
    const token = generation;
    startupTimer = schedule(() => {
      startupTimer = null;
      if (disposed || token !== generation || ready) return;
      client.receive(JSON.stringify({ source: 'careconnect-live-face', type: 'error', id: 0 }));
      client.dispose();
    }, Math.max(1000, Math.min(60000, startupTimeoutMs)));
  };
  client = createClient(generation);
  return {
    start: armStartup,
    generation: () => generation,
    receive(value, token = generation) { if (!disposed && token === generation) client.receive(value); },
    failSurface(token = generation) {
      if (disposed || token !== generation) return;
      ready = false; clearStartup();
      client.receive(JSON.stringify({ source: 'careconnect-live-face', type: 'error', id: 0 }));
      client.dispose();
    },
    analyze: (image, options) => client.analyze(image, options),
    waitForIdle: () => client.waitForIdle(),
    restart() {
      if (disposed) return Promise.reject(new Error('local_cancelled'));
      if (restartWaiter) return restartWaiter.promise;
      client.dispose(); ready = false; generation += 1;
      let resolve, reject;
      const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
      restartWaiter = { promise, resolve, reject };
      client = createClient(generation); armStartup();
      try { onRestart(generation); } catch (error) { clearStartup(); client.dispose(); settleRestart(error); }
      return promise;
    },
    dispose() {
      if (disposed) return;
      disposed = true; generation += 1; clearStartup(); client.dispose(); settleRestart(new Error('local_cancelled'));
    },
  };
}
