import { GoogleAuth } from 'google-auth-library';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateFaceImage } from './faceImage.js';
export { validateFaceImage } from './faceImage.js';
export const FACE_LIKELIHOODS = ['UNKNOWN', 'VERY_UNLIKELY', 'UNLIKELY', 'POSSIBLE', 'LIKELY', 'VERY_LIKELY'];
export const FACE_ISSUES = ['no_face', 'multiple_faces', 'low_confidence', 'blurred', 'dark', 'angled', 'small_face'];
const MAX_RESPONSE_BYTES = 1024 * 1024;
const invalidProvider = () => { throw new Error('FACE_UNAVAILABLE'); };
const numeric = (value, minimum, maximum) => typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum;
function likelihood(value) {
  if (value === undefined) return 'UNKNOWN';
  if (!FACE_LIKELIHOODS.includes(value)) invalidProvider();
  return value;
}
function boxFor(face, image) {
  const vertices = (face.boundingPoly || face.fdBoundingPoly)?.vertices;
  if (!Array.isArray(vertices) || vertices.length < 3 || vertices.length > 8) invalidProvider();
  const points = vertices.map(vertex => {
    if (!vertex || typeof vertex !== 'object' || Array.isArray(vertex)) invalidProvider();
    // Google omits zero-valued vertex coordinates in its JSON representation.
    const x = vertex.x ?? 0, y = vertex.y ?? 0;
    if (!Number.isInteger(x) || !Number.isInteger(y) || Math.abs(x) > image.width * 2 || Math.abs(y) > image.height * 2) invalidProvider();
    return { x, y };
  });
  const left = Math.max(0, Math.min(image.width, Math.min(...points.map(point => point.x))));
  const top = Math.max(0, Math.min(image.height, Math.min(...points.map(point => point.y))));
  const right = Math.max(0, Math.min(image.width, Math.max(...points.map(point => point.x))));
  const bottom = Math.max(0, Math.min(image.height, Math.max(...points.map(point => point.y))));
  if (right <= left || bottom <= top) invalidProvider();
  return { x: left / image.width, y: top / image.height, width: (right - left) / image.width, height: (bottom - top) / image.height };
}
export function normalizeFaceReport(provider, image, analyzedAt = new Date().toISOString()) {
  if (!image || !Number.isInteger(image.width) || !Number.isInteger(image.height) || image.width < 1 || image.height < 1 ||
      typeof analyzedAt !== 'string' || !Number.isFinite(Date.parse(analyzedAt)) || !provider || typeof provider !== 'object' || Array.isArray(provider) || provider.error ||
      !Array.isArray(provider.responses) || provider.responses.length !== 1 || !provider.responses[0] ||
      typeof provider.responses[0] !== 'object' || Array.isArray(provider.responses[0]) || provider.responses[0].error) invalidProvider();
  const annotations = provider.responses[0].faceAnnotations === undefined ? [] : provider.responses[0].faceAnnotations;
  if (!Array.isArray(annotations) || annotations.length > 20) invalidProvider();
  const issues = new Set();
  if (!annotations.length) issues.add('no_face');
  if (annotations.length > 1) issues.add('multiple_faces');
  const faces = annotations.map(face => {
    if (!face || !numeric(face.detectionConfidence, 0, 1) ||
        face.landmarkingConfidence != null && !numeric(face.landmarkingConfidence, 0, 1)) invalidProvider();
    const box = boxFor(face, image), pose = {};
    for (const [key, providerKey] of [['roll', 'rollAngle'], ['pan', 'panAngle'], ['tilt', 'tiltAngle']]) {
      const value = face[providerKey];
      if (value != null && !numeric(value, -180, 180)) invalidProvider();
      pose[key] = value ?? null;
      if (value != null && Math.abs(value) > 35) issues.add('angled');
    }
    const quality = { blur: likelihood(face.blurredLikelihood), underExposure: likelihood(face.underExposedLikelihood) };
    const signals = { joy: likelihood(face.joyLikelihood), sorrow: likelihood(face.sorrowLikelihood), anger: likelihood(face.angerLikelihood), surprise: likelihood(face.surpriseLikelihood) };
    if (face.detectionConfidence < 0.8) issues.add('low_confidence');
    if (['LIKELY', 'VERY_LIKELY'].includes(quality.blur)) issues.add('blurred');
    if (['LIKELY', 'VERY_LIKELY'].includes(quality.underExposure)) issues.add('dark');
    if (box.width < 0.1 || box.height < 0.1 || box.width * image.width < 64 || box.height * image.height < 64) issues.add('small_face');
    return { box, confidence: face.detectionConfidence, landmarkConfidence: face.landmarkingConfidence ?? null, pose, quality, signals };
  });
  const orderedIssues = FACE_ISSUES.filter(issue => issues.has(issue));
  return { version: 'face-report-v1', provider: 'google-cloud-vision', analyzedAt, image: { width: image.width, height: image.height },
    faceCount: faces.length, status: orderedIssues.some(issue => issue !== 'multiple_faces') ? 'retake' : 'ready', faces, issues: orderedIssues };
}
function abortable(promise, signal) {
  if (signal.aborted) return Promise.reject(new Error('FACE_UNAVAILABLE'));
  return new Promise((resolvePromise, reject) => {
    const aborted = () => reject(new Error('FACE_UNAVAILABLE'));
    signal.addEventListener('abort', aborted, { once: true });
    Promise.resolve(promise).then(resolvePromise, reject).finally(() => signal.removeEventListener('abort', aborted));
  });
}
async function readProviderJSON(response, signal) {
  const length = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(length) && length > MAX_RESPONSE_BYTES) invalidProvider();
  if (!response.body?.getReader) invalidProvider();
  const reader = response.body.getReader(), chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await abortable(reader.read(), signal);
      if (done) break;
      if (!ArrayBuffer.isView(value) || value.BYTES_PER_ELEMENT !== 1 || (total += value.byteLength) > MAX_RESPONSE_BYTES) invalidProvider();
      chunks.push(Buffer.from(value));
    }
    return JSON.parse(Buffer.concat(chunks, total).toString('utf8'));
  } finally {
    if (signal.aborted || total > MAX_RESPONSE_BYTES) void reader.cancel().catch(() => {});
    try { reader.releaseLock(); } catch { /* A canceled pending read must not delay the response. */ }
  }
}
const defaultAuthFactory = options => new GoogleAuth(options).getClient();
export function createFaceVisionHandler({ env = process.env, fetchImpl = fetch, authFactory = defaultAuthFactory, timeoutMs = 18_000 } = {}) {
  return async (req, res) => {
    const fail = (status, errorCode) => res.status(status).json({ errorCode, error: {
      INVALID_IMAGE: 'Use a valid PNG or JPEG under 6 MB and 16 megapixels. Rotate and re-export images before uploading.',
      FACE_NOT_CONFIGURED: 'Face detection is not configured. Contact your administrator.',
      FACE_UNAVAILABLE: 'Face detection is temporarily unavailable. Please retry.',
    }[errorCode], retryable: errorCode === 'FACE_UNAVAILABLE' });
    if (!req.user?.uid || !req.user.profile) return fail(403, 'FACE_UNAVAILABLE');
    let image;
    try { image = validateFaceImage(req.body?.image); } catch { return fail(400, 'INVALID_IMAGE'); }
    const credentials = env.FACE_VISION_CREDENTIALS || env.GOOGLE_APPLICATION_CREDENTIALS || env.FIREBASE_SERVICE_ACCOUNT_KEY;
    const project = env.FACE_VISION_PROJECT_ID || env.GOOGLE_CLOUD_PROJECT || '';
    if (!credentials || typeof credentials !== 'string' || credentials.length > 64_000 ||
        project && !/^(?:[a-z][a-z0-9-]{4,28}[a-z0-9]|\d{1,30})$/.test(project)) return fail(503, 'FACE_NOT_CONFIGURED');
    let options;
    try {
      options = credentials.trim().startsWith('{') ? { credentials: JSON.parse(credentials) } :
        { keyFilename: resolve(dirname(fileURLToPath(import.meta.url)), '../../..', credentials) };
      if (options.credentials && (!options.credentials || typeof options.credentials !== 'object' || Array.isArray(options.credentials))) throw new Error('Invalid configuration');
    } catch { return fail(503, 'FACE_NOT_CONFIGURED'); }
    const controller = new AbortController();
    const timeout = Math.min(20_000, Math.max(1, Number.isFinite(timeoutMs) ? timeoutMs : 18_000));
    const timer = setTimeout(() => controller.abort(), timeout);
    const disconnected = () => { if (!res.writableEnded) controller.abort(); };
    req.once?.('aborted', disconnected); res.once?.('close', disconnected);
    try {
      let token;
      try {
        const client = await abortable(authFactory({ ...options, scopes: ['https://www.googleapis.com/auth/cloud-vision'], ...(project ? { projectId: project, quotaProjectId: project } : {}),
          clientOptions: { transporterOptions: { signal: controller.signal, timeout, retry: false } } }), controller.signal);
        const access = await abortable(client.getAccessToken(), controller.signal);
        token = typeof access === 'string' ? access : access?.token;
        if (typeof token !== 'string' || !token || /[\r\n]/.test(token)) throw new Error('Missing token');
      } catch { return fail(503, controller.signal.aborted ? 'FACE_UNAVAILABLE' : 'FACE_NOT_CONFIGURED'); }
      const response = await abortable(fetchImpl('https://vision.googleapis.com/v1/images:annotate', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(project ? { 'x-goog-user-project': project } : {}) },
        body: JSON.stringify({ requests: [{ image: { content: image.content }, features: [{ type: 'FACE_DETECTION', maxResults: 20 }] }] }), signal: controller.signal,
      }), controller.signal);
      if (!response.ok) { controller.abort(); return fail(503, [401, 403].includes(response.status) ? 'FACE_NOT_CONFIGURED' : 'FACE_UNAVAILABLE'); }
      const data = await readProviderJSON(response, controller.signal);
      return res.json(normalizeFaceReport(data, image));
    } catch { controller.abort(); return fail(503, 'FACE_UNAVAILABLE'); }
    finally { clearTimeout(timer); req.removeListener?.('aborted', disconnected); res.removeListener?.('close', disconnected); }
  };
}
