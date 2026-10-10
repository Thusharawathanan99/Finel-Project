// Keep rotation processing enabled. Native image references avoid writing and decoding
// a full-resolution camera JPEG before the 640px live sample is produced.
export async function captureLiveCameraImage({ camera, platform, ImageManipulator, SaveFormat,
  deleteFile, clock = Date.now, maxDimension = 640 }) {
  let raw, encoded, context, rendered;
  const capturedAt = new Date(clock()).toISOString();
  const native = platform === 'android' || platform === 'ios';
  const validSize = image => Number.isInteger(image?.width) && image.width > 0 && Number.isInteger(image?.height) && image.height > 0;
  try {
    raw = await camera.takePictureAsync({ quality: 0.7, skipProcessing: false, shutterSound: false, ...(native ? { pictureRef: true } : { imageType: 'jpg' }) });
    if (!validSize(raw)) throw new Error('camera');
    // Expo's web camera already returns oriented canvas pixels as a data URI.
    // A small JPEG can be sent directly without a second decode/encode.
    if (!native && Math.max(raw.width, raw.height) <= maxDimension && /^data:image\/jpe?g;base64,/.test(raw.uri)) {
      const base64 = raw.uri.slice(raw.uri.indexOf(',') + 1);
      if (!base64 || base64.length > 2800000) throw new Error('camera');
      return { dataUri: 'data:image/jpeg;base64,' + base64, width: raw.width, height: raw.height, capturedAt };
    }
    const source = raw.nativeRefType === 'image' ? raw : raw.uri;
    if (!source) throw new Error('camera');
    context = ImageManipulator.manipulate(source);
    if (Math.max(raw.width, raw.height) > maxDimension) context.resize(raw.width >= raw.height ? { width: maxDimension } : { height: maxDimension });
    rendered = await context.renderAsync();
    encoded = await rendered.saveAsync({ base64: true, compress: 0.65, format: SaveFormat.JPEG });
    if (!validSize(encoded) || !encoded.base64 || encoded.base64.length > 2800000) throw new Error('camera');
    return { dataUri: 'data:image/jpeg;base64,' + encoded.base64, width: encoded.width, height: encoded.height, capturedAt };
  } finally {
    rendered?.release?.(); context?.release?.(); raw?.release?.();
    // These are generated capture files; gallery originals never enter this path.
    const cacheUris = [...new Set([raw?.uri, encoded?.uri].filter(uri => typeof uri === 'string' && uri.startsWith('file://')))];
    // Cache cleanup must not discard a healthy result if a file has already gone
    // away or the platform temporarily refuses deletion.
    await Promise.allSettled(cacheUris.map(async uri => deleteFile(uri, { idempotent: true })));
  }
}

// Each displayed result belongs to the exact frame that was analyzed. Sampling is
// adaptive: aim for four updates/second, with a short yield after a slower result.
export function createLiveFrameLoop({ capture, detect, onFrame, onError, getUid,
  onRecovering = () => {}, maxCaptureRetries = 2, onRecoverDetector, maxDetectorRetries = 2,
  clock = Date.now, schedule = setTimeout, cancel = clearTimeout, intervalMs = 250 }) {
  let active = false, generation = 0, busy = false, timer = null, uid = null, sequence = 0, captureFailures = 0, detectorFailures = 0;
  const retryLimit = Number.isInteger(maxCaptureRetries) ? Math.min(3, Math.max(0, maxCaptureRetries)) : 2;
  const detectorRetryLimit = Number.isInteger(maxDetectorRetries) ? Math.min(3, Math.max(0, maxDetectorRetries)) : 2;
  const queue = delay => { if (!active) return; if (timer !== null) cancel(timer); timer = schedule(tick, delay); };
  const stop = () => { active = false; generation += 1; if (timer !== null) cancel(timer); timer = null; };
  const tick = async () => {
    timer = null;
    if (!active) return;
    if (getUid() !== uid) { stop(); return; }
    if (busy) { queue(25); return; }
    const token = generation, started = clock();
    let capturing = true, retryDelay = null;
    busy = true;
    const current = () => active && token === generation && uid === getUid();
    try {
      const frame = await capture();
      if (!current()) return;
      capturing = false;
      captureFailures = 0;
      const id = generation + ':' + (++sequence);
      const result = await detect({ id, image: frame });
      if (!current()) return;
      if (!result || result.id !== id || result.width !== frame.width || result.height !== frame.height) throw new Error('mismatched_frame');
      detectorFailures = 0;
      const elapsed = Math.max(1, clock() - started);
      onFrame({ ...result, image: frame, elapsedMs: elapsed, sampledAt: new Date(clock()).toISOString() });
    } catch (error) {
      if (current()) {
        if (capturing && captureFailures < retryLimit) {
          captureFailures += 1;
          retryDelay = 375 * captureFailures;
          onRecovering(error, { kind: 'capture', attempt: captureFailures, maxRetries: retryLimit });
        } else if (!capturing && typeof onRecoverDetector === 'function' && detectorFailures < detectorRetryLimit &&
            error?.retryable !== false && !['mismatched_frame', 'invalid_frame', 'local_cancelled'].includes(error?.message)) {
          detectorFailures += 1;
          retryDelay = 375 * detectorFailures;
          const attempt = { kind: 'detector', attempt: detectorFailures, maxRetries: detectorRetryLimit };
          onRecovering(error, attempt);
          try {
            // Keep the loop busy until the old worker is destroyed and a new one
            // has loaded. Merely clearing a request timeout can overlap workers.
            await onRecoverDetector(error, attempt);
          } catch (recoveryError) {
            if (current()) { stop(); onError(recoveryError); }
          }
        } else { stop(); onError(error); }
      }
    }
    finally { busy = false; if (active) queue(retryDelay ?? Math.max(25, intervalMs - (clock() - started))); }
  };
  return { start() { if (active) return; uid = getUid(); if (!uid) return; captureFailures = 0; detectorFailures = 0; active = true; generation += 1; queue(0); },
    stop, active: () => active, busy: () => busy };
}

// A completed result never becomes current merely because the detector has stopped
// producing updates. The screen supplies its own heartbeat clock while the camera runs.
export function isLiveFrameFresh(frame, now = Date.now(), maxAgeMs = 1500) {
  const captured = Date.parse(frame?.capturedAt);
  return Number.isFinite(captured) && Number.isFinite(now) && now >= captured && now - captured <= maxAgeMs;
}

// An analyzed sample can arrive after the camera has moved. Keep its result card
// briefly after completion, labelled as a sample, without painting old geometry
// over the current video. A bounded completion deadline also hides stalled output.
export function getLiveFramePresentation(frame, now = Date.now()) {
  const captured = Date.parse(frame?.capturedAt), completed = Date.parse(frame?.completedAt);
  const invalid = { resultFresh: false, overlayFresh: false, sampled: false,
    captureAgeMs: null, completionAgeMs: null, expiresAfterMs: 0 };
  if (typeof frame?.capturedAt !== 'string' || typeof frame?.completedAt !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(frame.capturedAt) ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(frame.completedAt) ||
      !Number.isFinite(now) || !Number.isFinite(captured) || !Number.isFinite(completed) ||
      completed < captured || now < captured || now < completed) return invalid;
  const delay = completed - captured;
  const expiresAfterMs = Math.min(90000, Math.max(5000, delay * 2.5));
  return { resultFresh: now - completed <= expiresAfterMs, overlayFresh: now - captured <= 1500,
    sampled: delay > 1500, captureAgeMs: now - captured, completionAgeMs: now - completed, expiresAfterMs };
}

// Cloud assistance is optional and shares at most one sampled frame per 15 seconds.
export function createCloudFrameSampler({ analyze, onReport, onError, getUid, clock = Date.now, intervalMs = 15000 }) {
  let enabled = false, generation = 0, busy = false, nextAt = 0, controller = null, consentUid = null;
  const disable = () => { enabled = false; consentUid = null; generation += 1; controller?.abort(); };
  return {
    enable() { const uid=getUid(); if (!uid || enabled && uid===consentUid) return; consentUid=uid; generation += 1; enabled = true; nextAt = Math.max(nextAt,clock()); }, disable,
    enabled: () => enabled,
    async sample(frame) {
      if (enabled && getUid() !== consentUid) { disable(); return; }
      if (!enabled || busy || clock() < nextAt) return;
      const uid = getUid(), token = generation;
      if (!uid || uid !== consentUid) { disable(); return; }
      busy = true; controller = new AbortController(); nextAt = clock() + Math.max(15000, intervalMs);
      const current = () => enabled && token === generation && uid === getUid();
      try {
        const report = await analyze(frame, controller.signal);
        if (current()) onReport({ report, image: frame });
      } catch (error) {
        if (current()) {
          if (['notConfigured', 'auth'].includes(error.message)) disable();
          else nextAt = clock() + (error.message === 'rateLimit' ? 60000 : 30000);
          onError(error);
        }
      } finally { busy = false; controller = null; }
    },
  };
}
