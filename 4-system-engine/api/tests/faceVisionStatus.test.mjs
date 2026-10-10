// Configuration inspection only: synthetic credentials, no OAuth or image calls.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, unlinkSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { faceVisionConfigurationState, createFaceVisionStatusHandler } from '../routes/faceVisionStatus.js';

const syntheticCredential = { type: 'service_account', client_email: 'synthetic@example.test', private_key: 'synthetic-offline-placeholder', project_id: 'private-test-project' };
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const envFor = credentials => ({ FACE_VISION_CREDENTIALS: credentials, FACE_VISION_PROJECT_ID: 'offline-project' });
const validEnv = envFor(JSON.stringify(syntheticCredential));
const request = () => ({ user: { uid: 'offline-user', profile: { role: 'patient' } } });
const response = () => ({ statusCode: 200, headers: {}, set(name, value) { this.headers[name] = value; return this; },
  status(code) { this.statusCode = code; return this; }, json(data) { this.data = data; return this; } });
const tempDirectory = mkdtempSync(join(tmpdir(), 'careconnect-face-status-'));
const fixture = join(tempDirectory, 'synthetic.json');
after(() => { try { unlinkSync(fixture); } catch (error) { if (error.code !== 'ENOENT') throw error; } rmdirSync(tempDirectory); });

test('missing credentials produce sanitized metadata without reading a file', () => {
  const res = response();
  createFaceVisionStatusHandler({ env: { GEMINI_API_KEY: 'irrelevant', VITE_GOOGLE_CLOUD_API_KEY: 'irrelevant' },
    readFile() { throw new Error('Status must not read a file without credentials'); } })(request(), res);
  assert.deepEqual(res.data, { provider: 'google-cloud-vision', configurationState: 'missing', providerVerified: false });
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['Cache-Control'], 'private, no-store');
});

test('readable credential structure stays unverified and reveals no private fields', () => {
  const res = response();
  createFaceVisionStatusHandler({ env: validEnv })(request(), res);
  assert.deepEqual(res.data, { provider: 'google-cloud-vision', configurationState: 'available', providerVerified: false });
  assert.equal(JSON.stringify(res.data).includes('synthetic'), false);
  assert.equal(JSON.stringify(res.data).includes('project'), false);
  assert.equal(JSON.stringify(res.data).includes('private_key'), false);
});

test('anonymous and unregistered callers are rejected before configuration inspection', () => {
  let reads = 0;
  const handler = createFaceVisionStatusHandler({ env: envFor('private-credential.json'), readFile() { reads++; return JSON.stringify(syntheticCredential); } });
  for (const [user, status] of [[undefined, 401], [{ profile: {} }, 401], [{ uid: 'new' }, 403], [{ uid: 'admin', role: 'admin' }, 403]]) {
    const res = response(); handler({ user }, res);
    assert.equal(res.statusCode, status); assert.equal(res.data.configurationState, undefined);
  }
  assert.equal(reads, 0);
});

test('credential priority matches the face relay and invalid preferred configuration cannot use a lower priority key', () => {
  const paths = [];
  const readFile = path => { paths.push(path); return JSON.stringify(syntheticCredential); };
  assert.equal(faceVisionConfigurationState({ FACE_VISION_CREDENTIALS: 'vision.json', GOOGLE_APPLICATION_CREDENTIALS: 'adc.json', FIREBASE_SERVICE_ACCOUNT_KEY: 'firebase.json' }, readFile), 'available');
  assert.equal(paths[0], resolve(projectRoot, 'vision.json'));
  assert.equal(faceVisionConfigurationState({ GOOGLE_APPLICATION_CREDENTIALS: 'adc.json', FIREBASE_SERVICE_ACCOUNT_KEY: 'firebase.json' }, readFile), 'available');
  assert.ok(paths[1].endsWith('adc.json'));
  assert.equal(faceVisionConfigurationState({ FIREBASE_SERVICE_ACCOUNT_KEY: 'firebase.json' }, readFile), 'available');
  assert.ok(paths[2].endsWith('firebase.json'));
  assert.equal(faceVisionConfigurationState({ FACE_VISION_CREDENTIALS: '{bad-json', GOOGLE_APPLICATION_CREDENTIALS: 'adc.json' }, readFile), 'invalid');
  assert.equal(paths.length, 3);
});

test('malformed, absent-field, unsupported and oversized credentials cannot become available', () => {
  for (const credential of [' ', '{bad', '{}', '{"type":"api_key","api_key":"offline"}',
    JSON.stringify({ ...syntheticCredential, private_key: '' }), JSON.stringify({ ...syntheticCredential, client_email: '' }),
    '{"type":"service_account","private_key":"' + 'x'.repeat(64000) + '"}', true, 123]) {
    assert.equal(faceVisionConfigurationState(envFor(credential), () => '[]'), 'invalid');
  }
  for (const json of ['', '[]', 'null', 'true', '{bad-json', JSON.stringify({ ...syntheticCredential, type: 'unknown' }), 'x'.repeat(64001)]) {
    assert.equal(faceVisionConfigurationState(envFor('private.json'), () => json), 'invalid');
  }
});

test('quota-project format is checked before reading configuration and fallback is honored', () => {
  for (const project of ['invalid project', 'short', 'UPPERCASE-PROJECT', 'bad/slash', {}, 'x'.repeat(31)]) {
    assert.equal(faceVisionConfigurationState({ ...validEnv, FACE_VISION_PROJECT_ID: project }, () => { throw new Error('Unexpected read'); }), 'invalid');
  }
  assert.equal(faceVisionConfigurationState({ ...validEnv, FACE_VISION_PROJECT_ID: '123456789' }), 'available');
  assert.equal(faceVisionConfigurationState({ FACE_VISION_CREDENTIALS: validEnv.FACE_VISION_CREDENTIALS, GOOGLE_CLOUD_PROJECT: 'invalid project' }), 'invalid');
});

test('supported OAuth credential shapes are inspected without retrieving tokens or subject credentials', () => {
  for (const credentials of [
    { type: 'authorized_user', client_id: 'offline', client_secret: 'offline', refresh_token: 'offline' },
    { type: 'external_account_authorized_user', client_id: 'offline', client_secret: 'offline', refresh_token: 'offline' },
    { type: 'external_account', audience: 'offline', subject_token_type: 'offline', token_url: 'https://offline.invalid/token', credential_source: { file: 'never-read' } },
    { type: 'impersonated_service_account', service_account_impersonation_url: 'https://offline.invalid/impersonate', source_credentials: syntheticCredential },
  ]) assert.equal(faceVisionConfigurationState(envFor(JSON.stringify(credentials))), 'available');
});

test('bounded local-file inspection reflects replacement/removal and never caches success', () => {
  writeFileSync(fixture, JSON.stringify(syntheticCredential));
  const env = envFor(fixture);
  assert.equal(faceVisionConfigurationState(env), 'available');
  writeFileSync(fixture, '{bad-json');
  assert.equal(faceVisionConfigurationState(env), 'invalid');
  writeFileSync(fixture, 'x'.repeat(64001));
  assert.equal(faceVisionConfigurationState(env), 'invalid');
  writeFileSync(fixture, '');
  assert.equal(faceVisionConfigurationState(env), 'invalid');
  unlinkSync(fixture);
  assert.equal(faceVisionConfigurationState(env), 'invalid');
  assert.equal(faceVisionConfigurationState(envFor(tempDirectory)), 'invalid');
});
