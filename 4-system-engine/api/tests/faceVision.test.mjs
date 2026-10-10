// Synthetic pictures and mocked OAuth/Vision only. No cloud, database or patient data.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFaceVisionHandler, normalizeFaceReport, validateFaceImage } from '../routes/faceVision.js';
import { MAX_FACE_IMAGE_BYTES, MAX_FACE_IMAGE_PIXELS, pngCRC } from '../routes/faceImage.js';
import { testPNG, testJPEG, pngChunk, faceAnnotation } from './faceFixtures.mjs';
import { validateFaceReport } from '../../../shared/faceReport.js';
const image = testPNG(), base64 = image.toString('base64'), metadata = { width: 512, height: 512 };
const provider = face => ({ responses: [{ faceAnnotations: face ? [face] : [] }] });
const response = () => ({ statusCode: 200, data: undefined, status(value) { this.statusCode = value; return this; }, json(data) { this.data = data; return this; } });
const request = image => ({ body: { image }, user: { uid: 'offline-user', profile: { role: 'patient' } } });
const credentialEnv = { FACE_VISION_CREDENTIALS: '{"type":"service_account","client_email":"offline@example.test","private_key":"offline-placeholder"}', FACE_VISION_PROJECT_ID: 'offline-project' };
const tokenFactory = async () => ({ getAccessToken: async () => ({ token: 'offline-access-token' }) });
async function run(options = {}, input = base64) {
  const res = response();
  await createFaceVisionHandler({ env: credentialEnv, authFactory: tokenFactory, fetchImpl: async () => Response.json(provider(faceAnnotation())), ...options })(request(input), res);
  return res;
}
test('PNG/JPEG dimensions come from validated bytes, not caller metadata', () => {
  assert.deepEqual({ ...validateFaceImage(base64), content: undefined }, { ...metadata, mimeType: 'image/png', content: undefined });
  const jpeg = validateFaceImage(`data:image/jpeg;base64,${testJPEG.toString('base64')}`);
  assert.equal(jpeg.width, 1); assert.equal(jpeg.height, 1); assert.equal(jpeg.mimeType, 'image/jpeg');
});
test('image parser rejects MIME mismatches, unsupported formats, malformed base64 and truncation', () => {
  for (const input of ['', 'not-base64', 'eA==', `data:image/webp;base64,${base64}`, `data:image/jpeg;base64,${base64}`,
    image.subarray(0, 33).toString('base64'), testJPEG.subarray(0, testJPEG.length - 2).toString('base64')]) assert.throws(() => validateFaceImage(input), /INVALID_IMAGE/);
  const corrupted = Buffer.from(image); corrupted[29] ^= 1; assert.throws(() => validateFaceImage(corrupted.toString('base64')), /INVALID_IMAGE/);
});
test('image dimensions and decoded bytes are bounded before authentication/provider access', async () => {
  const oversizedHeader = Buffer.from(image); oversizedHeader.writeUInt32BE(10000, 16); oversizedHeader.writeUInt32BE(10000, 20);
  oversizedHeader.writeUInt32BE(pngCRC(oversizedHeader.subarray(12, 29)), 29);
  assert.ok(10000 * 10000 > MAX_FACE_IMAGE_PIXELS);
  const inputs = [oversizedHeader.toString('base64'), Buffer.alloc(MAX_FACE_IMAGE_BYTES + 1).toString('base64')];
  for (const input of inputs) {
    let calls = 0;
    const res = await run({ authFactory: async () => { calls++; throw new Error('Must not run'); } }, input);
    assert.equal(res.statusCode, 400); assert.equal(res.data.errorCode, 'INVALID_IMAGE'); assert.equal(calls, 0);
  }
});
test('animated PNG and oriented JPEG require normalized re-export', () => {
  const animated = Buffer.concat([image.subarray(0, 33), pngChunk('acTL', Buffer.alloc(8)), image.subarray(33)]);
  assert.throws(() => validateFaceImage(animated.toString('base64')), /INVALID_IMAGE/);
  const tiff = Buffer.alloc(26); tiff.write('II'); tiff.writeUInt16LE(42, 2); tiff.writeUInt32LE(8, 4); tiff.writeUInt16LE(1, 8);
  tiff.writeUInt16LE(0x112, 10); tiff.writeUInt16LE(3, 12); tiff.writeUInt32LE(1, 14); tiff.writeUInt16LE(6, 18);
  const data = Buffer.concat([Buffer.from('Exif\0\0'), tiff]), length = Buffer.alloc(2); length.writeUInt16BE(data.length + 2);
  const oriented = Buffer.concat([testJPEG.subarray(0, 2), Buffer.from([255, 225]), length, data, testJPEG.subarray(2)]);
  assert.throws(() => validateFaceImage(oriented.toString('base64')), /INVALID_IMAGE/);
});
test('single clean face retains actual confidence, Google likelihoods and normalized box', () => {
  const report = normalizeFaceReport(provider(faceAnnotation()), metadata, '2026-10-05T12:00:00.000Z');
  assert.equal(report.version, 'face-report-v1'); assert.equal(report.provider, 'google-cloud-vision'); assert.equal(report.status, 'ready');
  assert.equal(report.faceCount, 1); assert.deepEqual(report.faces[0].box, { x: 0.25, y: 0.25, width: 0.5, height: 0.5 });
  assert.equal(report.faces[0].confidence, 0.934); assert.equal(report.faces[0].landmarkConfidence, 0.871);
  assert.equal(report.faces[0].signals.joy, 'LIKELY'); assert.equal(report.faces[0].signals.surprise, 'POSSIBLE');
  assert.equal('stateScore' in report, false); assert.equal('emotionLabel' in report, false); assert.equal('patient' in report, false);
});
test('zero faces is a valid retake report and never a fabricated neutral face', () => {
  for (const data of [provider(null), { responses: [{}] }]) {
    const report = normalizeFaceReport(data, metadata); assert.equal(report.status, 'retake'); assert.equal(report.faceCount, 0);
    assert.deepEqual(report.faces, []); assert.deepEqual(report.issues, ['no_face']);
  }
});
test('clear multiple faces including the maxResults cap stay ready with informational group guidance', () => {
  for (const count of [2, 20]) {
    const report = normalizeFaceReport({ responses: [{ faceAnnotations: Array.from({ length: count }, () => faceAnnotation()) }] }, metadata);
    assert.equal(report.faceCount, count); assert.equal(report.status, 'ready'); assert.deepEqual(report.issues, ['multiple_faces']);
    assert.equal(report.faces.length, count);
    assert.ok(report.faces.every(face => face.confidence === 0.934 && face.signals.joy === 'LIKELY'));
    assert.deepEqual(validateFaceReport(report), report);
  }
});
test('group face quality concerns still require retake without discarding or merging per-face evidence', () => {
  const annotations = [faceAnnotation(), faceAnnotation({ detectionConfidence: 0.799, sorrowLikelihood: 'LIKELY', joyLikelihood: 'UNLIKELY', blurredLikelihood: 'LIKELY' })];
  const report = normalizeFaceReport({ responses: [{ faceAnnotations: annotations }] }, metadata);
  assert.equal(report.status, 'retake'); assert.deepEqual(report.issues, ['multiple_faces', 'low_confidence', 'blurred']);
  assert.equal(report.faces[0].confidence, 0.934); assert.equal(report.faces[1].confidence, 0.799);
  assert.equal(report.faces[0].signals.joy, 'LIKELY'); assert.equal(report.faces[1].signals.joy, 'UNLIKELY');
  assert.equal(report.faces[1].signals.sorrow, 'LIKELY');
  assert.deepEqual(validateFaceReport(report), report);
});
test('all quality issues use descriptive documented thresholds and stable ordering', () => {
  const face = faceAnnotation({ detectionConfidence: 0.799, blurredLikelihood: 'LIKELY', underExposedLikelihood: 'VERY_LIKELY', panAngle: -36,
    boundingPoly: { vertices: [{}, { x: 40 }, { x: 40, y: 40 }, { y: 40 }] } });
  const report = normalizeFaceReport(provider(face), metadata);
  assert.equal(report.status, 'retake'); assert.deepEqual(report.issues, ['low_confidence', 'blurred', 'dark', 'angled', 'small_face']);
  const boundary = normalizeFaceReport(provider(faceAnnotation({ detectionConfidence: 0.8, panAngle: 35, blurredLikelihood: 'POSSIBLE' })), metadata);
  assert.equal(boundary.status, 'ready');
});
test('missing optional pose/landmark data is unknown, not invented confidence or angles', () => {
  const report = normalizeFaceReport(provider(faceAnnotation({ landmarkingConfidence: undefined, panAngle: undefined, rollAngle: undefined, tiltAngle: undefined, joyLikelihood: undefined })), metadata);
  assert.deepEqual(report.faces[0].pose, { roll: null, pan: null, tilt: null }); assert.equal(report.faces[0].landmarkConfidence, null);
  assert.equal(report.faces[0].signals.joy, 'UNKNOWN');
});
test('partial boxes clip to image edges and invalid geometry is rejected', () => {
  const report = normalizeFaceReport(provider(faceAnnotation({ boundingPoly: { vertices: [{ x: -10, y: -5 }, { x: 300, y: -5 }, { x: 300, y: 400 }, { x: -10, y: 400 }] } })), metadata);
  assert.equal(report.faces[0].box.x, 0); assert.equal(report.faces[0].box.y, 0);
  assert.throws(() => normalizeFaceReport(provider(faceAnnotation({ boundingPoly: { vertices: [{}, {}, {}, {}] } })), metadata), /FACE_UNAVAILABLE/);
});
test('malformed provider responses cannot become successful face or wellness reports', () => {
  const invalid = [{}, { responses: [] }, { responses: [[]] }, { responses: [true] }, { responses: [{ error: { message: 'private-provider-error' } }] }, { responses: [{ faceAnnotations: null }] },
    { responses: [{ faceAnnotations: Array.from({ length: 21 }, () => faceAnnotation()) }] },
    ...[undefined, '0.99', NaN, Infinity, -1, 1.01].map(detectionConfidence => provider(faceAnnotation({ detectionConfidence }))),
    provider(faceAnnotation({ landmarkingConfidence: '0.9' })), provider(faceAnnotation({ panAngle: 181 })), provider(faceAnnotation({ joyLikelihood: 'HAPPY' }))];
  for (const data of invalid) assert.throws(() => normalizeFaceReport(data, metadata), /FACE_UNAVAILABLE/);
});
test('relay requests only FACE_DETECTION, uses server OAuth and preserves no patient metadata', async () => {
  let authOptions, sent;
  const res = await run({ authFactory: async options => { authOptions = options; return { getAccessToken: async () => ({ token: 'offline-secret-token' }) }; },
    fetchImpl: async (url, options) => { sent = { url, ...options }; return Response.json(provider(faceAnnotation())); } });
  assert.equal(res.statusCode, 200); assert.equal(sent.url, 'https://vision.googleapis.com/v1/images:annotate');
  assert.equal(sent.headers.Authorization, 'Bearer offline-secret-token'); assert.equal(sent.headers['x-goog-user-project'], 'offline-project');
  const payload = JSON.parse(sent.body); assert.deepEqual(payload.requests[0].features, [{ type: 'FACE_DETECTION', maxResults: 20 }]);
  assert.equal(payload.requests.length, 1); assert.equal(payload.requests[0].image.content, base64);
  assert.equal(authOptions.scopes[0], 'https://www.googleapis.com/auth/cloud-vision'); assert.equal(authOptions.clientOptions.transporterOptions.retry, false);
  assert.equal(JSON.stringify(res.data).includes('secret-token'), false);
});
test('credentials are optional until configured and browser-style API keys cannot enable the relay', async () => {
  let calls = 0;
  for (const env of [{}, { GEMINI_API_KEY: 'offline-key', VITE_GOOGLE_CLOUD_API_KEY: 'offline-key' }, { FACE_VISION_CREDENTIALS: '{bad-json' }]) {
    const res = await run({ env, authFactory: async () => { calls++; return tokenFactory(); } });
    assert.equal(res.statusCode, 503); assert.equal(res.data.errorCode, 'FACE_NOT_CONFIGURED'); assert.equal(res.data.faces, undefined);
  }
  assert.equal(calls, 0);
});
test('credential file priority supports dedicated, application-default and Firebase paths', async () => {
  for (const [env, suffix] of [[{ FACE_VISION_CREDENTIALS: 'face.json', GOOGLE_APPLICATION_CREDENTIALS: 'adc.json', FIREBASE_SERVICE_ACCOUNT_KEY: 'firebase.json' }, 'face.json'],
    [{ GOOGLE_APPLICATION_CREDENTIALS: 'adc.json', FIREBASE_SERVICE_ACCOUNT_KEY: 'firebase.json' }, 'adc.json'], [{ FIREBASE_SERVICE_ACCOUNT_KEY: 'firebase.json' }, 'firebase.json']]) {
    let options; const res = await run({ env, authFactory: async value => { options = value; return tokenFactory(); } });
    assert.equal(res.statusCode, 200); assert.ok(options.keyFilename.endsWith(suffix));
  }
});
test('anonymous callers cannot start OAuth or provider work', async () => {
  let calls = 0;
  const handler = createFaceVisionHandler({ env: credentialEnv, authFactory: async () => { calls++; return tokenFactory(); } });
  const res = response(); await handler({ body: { image: base64 } }, res);
  assert.equal(res.statusCode, 403); assert.equal(calls, 0);
});
test('authentication failure is sanitized and identifies missing setup', async () => {
  const res = await run({ authFactory: async () => { throw new Error('private-key contents must never appear'); } });
  assert.equal(res.data.errorCode, 'FACE_NOT_CONFIGURED'); assert.equal(JSON.stringify(res.data).includes('private-key'), false);
});
test('provider status, JSON and response errors are sanitized without success fallbacks', async () => {
  for (const fetchImpl of [async () => Response.json({ error: { message: 'provider-secret' } }, { status: 429 }),
    async () => new Response('bad-json'), async () => Response.json({ responses: [{ error: { message: 'provider-secret' } }] }),
    async () => { throw new Error('provider-secret'); }]) {
    const res = await run({ fetchImpl }); assert.equal(res.statusCode, 503); assert.equal(res.data.errorCode, 'FACE_UNAVAILABLE');
    assert.equal(res.data.faces, undefined); assert.equal(JSON.stringify(res.data).includes('provider-secret'), false);
  }
});
test('provider authentication/permission failures report configuration without leaking details', async () => {
  for (const status of [401, 403]) {
    const res = await run({ fetchImpl: async () => Response.json({ error: { message: 'provider-secret' } }, { status }) });
    assert.equal(res.statusCode, 503); assert.equal(res.data.errorCode, 'FACE_NOT_CONFIGURED');
    assert.equal(JSON.stringify(res.data).includes('provider-secret'), false);
  }
});
test('independent backend normalization agrees with shared client contract and thresholds', () => {
  for (const data of [provider(null), provider(faceAnnotation()), { responses: [{ faceAnnotations: [faceAnnotation(), faceAnnotation()] }] },
    provider(faceAnnotation({ detectionConfidence: 0.5, panAngle: 40, blurredLikelihood: 'LIKELY', underExposedLikelihood: 'VERY_LIKELY' })),
    provider(faceAnnotation({ landmarkingConfidence: undefined, panAngle: undefined, rollAngle: undefined, tiltAngle: undefined }))]) {
    const report = normalizeFaceReport(data, metadata);
    assert.deepEqual(validateFaceReport(report), report);
  }
});
test('declared and streamed response sizes are bounded', async () => {
  for (const fetchImpl of [async () => new Response('{}', { headers: { 'content-length': '1048577' } }),
    async () => new Response(' '.repeat(1048577))]) {
    const res = await run({ fetchImpl }); assert.equal(res.statusCode, 503); assert.equal(res.data.errorCode, 'FACE_UNAVAILABLE');
  }
});
test('timeout bounds stalled authentication, fetch and body consumption', { timeout: 1000 }, async () => {
  for (const options of [{ authFactory: async () => new Promise(() => {}) }, { fetchImpl: async () => new Promise(() => {}) },
    { fetchImpl: async () => new Response(new ReadableStream({ pull() { return new Promise(() => {}); } })) }]) {
    const start = Date.now(), res = await run({ timeoutMs: 10, ...options });
    assert.equal(res.statusCode, 503); assert.equal(res.data.errorCode, 'FACE_UNAVAILABLE'); assert.ok(Date.now() - start < 300);
  }
});
