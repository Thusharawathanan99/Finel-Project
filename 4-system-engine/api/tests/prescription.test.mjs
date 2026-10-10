// Offline regressions: node --experimental-vm-modules --test tests/prescription.test.mjs
// Loads actual API and client sources with cloud, router and database doubles.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SourceTextModule, SyntheticModule, createContext } from 'node:vm';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, dirname, extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { transform } from '../../../1-ui-ux/node_modules/esbuild/lib/main.js';
import { parseMedications, mergeCandidates, extractPrescriptionMetadata } from '../routes/ensemble.js';
import { testPNG, faceAnnotation } from './faceFixtures.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const quiet = { log() {}, warn() {}, error() {} };
const medication = (drugName, dosage, frequency, source = 'donut', confidence = 0.8) => ({ drugName, dosage, frequency, source, confidence, normalizedName: drugName.toLowerCase() });
const plainMedication = result => result.medication || result;

async function loadSource(relative, options = {}) {
  const routes = [], modelCalls = [], statements = [];
  const pool = { async execute(sql, values) { statements.push({ sql, values }); return options.execute ? options.execute(sql, values) : [[]]; } };
  const env = { GEMINI_API_KEY: 'offline-fake-key', GEMINI_MODELS: 'offline-test-model', ...options.env };
  const context = createContext({
    process: { env }, console: quiet, Buffer, AbortController,
    setTimeout: options.fastTimeout ? (callback, ms) => setTimeout(callback, Math.min(ms, 5)) : setTimeout,
    clearTimeout, performance,
    fetch: options.fetch || (async () => { throw new Error('Offline Donut unavailable'); }),
  });
  const cache = new Map();
  async function stub(name, exports) {
    if (!cache.has(name)) cache.set(name, new SyntheticModule(Object.keys(exports), function () {
      for (const [key, value] of Object.entries(exports)) this.setExport(key, value);
    }, { context }));
    return cache.get(name);
  }
  async function source(filename) {
    if (cache.has(filename)) return cache.get(filename);
    let code = await readFile(filename, 'utf8');
    if (['.ts', '.tsx'].includes(extname(filename))) code = (await transform(code, { loader: extname(filename) === '.tsx' ? 'tsx' : 'ts', format: 'esm', target: 'es2022', jsx: 'automatic' })).code;
    const module = new SourceTextModule(code, { context, identifier: filename,
      initializeImportMeta(meta) { meta.url = pathToFileURL(filename).href; meta.env = {}; },
    });
    cache.set(filename, module);
    return module;
  }
  async function linker(specifier, parent) {
    if (specifier === 'react') return stub(specifier, {
      useState(initial) {
        const index = options.componentHooks.index++;
        if (!(index in options.componentHooks.states)) options.componentHooks.states[index] = typeof initial === 'function' ? initial() : initial;
        return [options.componentHooks.states[index], value => { options.componentHooks.states[index] = typeof value === 'function' ? value(options.componentHooks.states[index]) : value; }];
      }, useEffect() {}, useRef: () => ({ current: null }),
    });
    if (specifier === 'react/jsx-runtime') return stub(specifier, { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }), Fragment: 'fragment' });
    if (specifier === 'lucide-react') return stub(specifier, Object.fromEntries('Upload Camera X FileText Sparkles Loader CheckCircle AlertTriangle Pill Cpu Brain Zap Calendar User UserCheck Clock ShieldAlert Edit2 Plus Trash2'.split(' ').map(name => [name, () => null])));
    if (options.componentHooks && specifier.endsWith('/OCREngine')) return stub('ocr', { OCREngine: class {} });
    if (options.componentHooks && specifier.endsWith('/NLPEngine')) return stub('nlp', { NLPEngine: class {} });
    if (specifier === 'crypto' || specifier.startsWith('node:')) return stub(specifier, await import(specifier));
    if (specifier === 'google-auth-library') return stub(specifier, { GoogleAuth: class { async getClient() { return { getAccessToken: async () => ({ token: 'offline-face-token' }) }; } } });
    if (specifier === 'express') return stub(specifier, { Router() {
      const router = {};
      for (const method of ['get', 'post', 'put', 'delete']) router[method] = (path, handler) => { routes.push({ method, path, handler }); return router; };
      return router;
    } });
    if (specifier.endsWith('/db.js')) return stub('db', { default: pool });
    if (specifier === '@google/generative-ai') return stub(specifier, { GoogleGenerativeAI: class {
      getGenerativeModel({ model }) {
        return { generateContent(parts) {
          modelCalls.push({ model, parts });
          if (options.generate) return options.generate(model, parts);
          return Promise.reject(new Error('Offline Gemini unavailable'));
        } };
      }
    } });
    if (specifier.endsWith('/geminiService')) return stub('geminiService', { isGeminiEnabled: () => Boolean(options.clientGemini), verifyPrescriptionWithGemini: async () => {
      if (options.clientGemini) return options.clientGemini;
      throw new Error('No cloud calls in client tests');
    } });
    if (specifier.endsWith('/donutService')) return stub('donutService', { checkDonutHealth: async () => ({ status: 'offline' }), isDonutEnabled: async () => false, analyzePrescriptionWithDonut: async () => { throw new Error('No model calls in client tests'); } });
    if (specifier.endsWith('/ModelAccuracyTracker')) return stub('tracker', { modelAccuracyTracker: { getScopeToken() {return 0;}, recordPrediction() {} } });
    if (specifier === 'firebase-admin') return stub(specifier, { default: { auth: () => ({ verifyIdToken: async () => ({ uid: 'offline' }) }), firestore: () => ({}) }, auth: () => ({ verifyIdToken: async () => ({ uid: 'offline' }) }), firestore: () => ({}) });
    const next = resolve(dirname(parent.identifier), specifier);
    const resolved = extname(next) ? next : (existsSync(`${next}.ts`) ? `${next}.ts` : `${next}.js`);
    return source(resolved);
  }
  const module = await source(resolve(root, relative));
  await module.link(linker);
  await module.evaluate();
  return { exports: module.namespace, routes, modelCalls, statements };
}

function response() {
  return { statusCode: 200, body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}
function generateJson(data) { return async () => ({ response: { text: () => JSON.stringify(data) } }); }
async function requestRoute(relative, path, options = {}, body = { image: `data:image/png;base64,${testPNG().toString('base64')}` }) {
  const loaded = await loadSource(relative, options), res = response();
  const handler = loaded.routes.find(route => route.path === path && route.method === 'post').handler;
  await handler({ body, user: { uid: 'offline-user', profile: { role: 'patient' } } }, res);
  return { ...loaded, res };
}

const implementations = [
  ['API', async () => ({ parseMedications, mergeCandidates, extractPrescriptionMetadata })],
  ['website', async () => ({ ...(await loadSource('1-ui-ux/src/app/ml/ensemble/EnsembleOrchestrator.ts')).exports, ...(await loadSource('1-ui-ux/src/app/ml/nlp/MedicationParser.ts')).exports })],
  ['prescription client', async () => ({ ...(await loadSource('3-prescription-reader/client/ensemble/EnsembleOrchestrator.ts')).exports, ...(await loadSource('3-prescription-reader/client/nlp/MedicationParser.ts')).exports })],
];

for (const [label, load] of implementations) {
  test(`${label}: dosage disagreement selects strongest evidence and requires review`, async () => {
    const engine = await load();
    const results = engine.mergeCandidates([medication('Metformin', '50mg', 'BID', 'donut', 0.4), medication('Metformin', '500mg', 'twice daily', 'gemini', 0.99)]);
    assert.equal(results.length, 1);
    assert.equal(plainMedication(results[0]).dosage, '500mg');
    assert.equal(plainMedication(results[0]).needsReview, true);
    assert.ok(results[0].confidence <= 0.64);
    assert.equal(results[0].sourceDetails.donut.candidates[0].dosage, '50mg');
    assert.equal(results[0].sourceDetails.gemini.candidates[0].dosage, '500mg');
    assert.ok(results[0].conflictingFields.includes('dosage'));
  });
  test(`${label}: Monday and Tuesday regimens survive without a third conflicting dose`, async () => {
    const engine = await load();
    const results = engine.mergeCandidates([
      medication('Warfarin', '50mg', 'Monday', 'donut', 0.4), medication('Warfarin', '2.5mg', 'Tuesday', 'donut', 0.8),
      medication('Warfarin', '5mg', 'Monday', 'gemini', 0.99), medication('Warfarin', '2.5mg', 'Tuesday', 'gemini', 0.9),
    ]);
    assert.equal(results.length, 2);
    const monday = results.find(result => plainMedication(result).frequency === 'Monday');
    const tuesday = results.find(result => plainMedication(result).frequency === 'Tuesday');
    assert.equal(plainMedication(monday).dosage, '5mg');
    assert.equal(plainMedication(monday).needsReview, true);
    assert.equal(monday.sourceDetails.donut.candidates[0].dosage, '50mg');
    assert.equal(plainMedication(tuesday).dosage, '2.5mg');
  });
  test(`${label}: duplicate OCR evidence cannot inflate agreement`, async () => {
    const engine = await load();
    const candidate = medication('Metformin', '500mg', 'BID', 'donut', 0.4);
    const results = engine.mergeCandidates([candidate, candidate, { ...candidate, source: 'regex' }]);
    assert.equal(results.length, 1);
    assert.ok(results[0].confidence <= 0.4 + Number.EPSILON);
    assert.equal(plainMedication(results[0]).needsReview, true);
  });
  test(`${label}: parser separates schedule, duration and food without losing repeated drug lines`, async () => {
    const engine = await load();
    const results = engine.parseMedications('Metformin 500mg BID for 7 days after meals\nWarfarin 5mg Monday\nWarfarin 2.5mg Tuesday');
    assert.equal(results.length, 3);
    const first = results.map(plainMedication).find(result => result.drugName === 'Metformin');
    assert.equal(first.frequency, 'twice daily');
    assert.equal(first.duration, '7 days');
    assert.equal(first.instructions, 'after meals');
    const warfarin = results.map(plainMedication).filter(result => result.drugName === 'Warfarin');
    assert.equal(warfarin.length, 2);
    assert.equal(new Set(warfarin.map(result => result.frequency)).size, 2);
  });
  test(`${label}: same strength with two schedules remains two entries and missing schedule needs review`, async () => {
    const engine = await load();
    const results = engine.parseMedications('Warfarin 5mg Monday\nWarfarin 5mg Tuesday\nMetformin 500mg');
    assert.equal(results.length, 3);
    const first = results.map(plainMedication).find(result => result.drugName === 'Metformin');
    assert.equal(first.needsReview, true);
    assert.equal(first.frequency, 'Needs Review');
  });
}

test('lookalike drug names are not collapsed by substring matching', () => {
  const results = mergeCandidates([medication('Amlodipine', '5mg', 'daily'), medication('Amlodipine Plus', '10mg', 'daily')]);
  assert.equal(results.length, 2);
});
test('missing prescription issue date remains unknown', () => {
  assert.equal(extractPrescriptionMetadata('Metformin 500mg BID').date, 'Needs Review');
});
test('unmatched regimen evidence remains visible and marked for review', () => {
  const results = mergeCandidates([medication('Warfarin', '5mg', 'Monday'), medication('Warfarin', '2.5mg', 'Tuesday'), medication('Warfarin', '3mg', 'daily', 'gemini', 0.99)]);
  assert.equal(results.length, 3);
  assert.ok(results.every(result => result.needsReview && result.confidence <= 0.64));
});
test('distinct weekday doses read by different sources remain visible for review', () => {
  const results = mergeCandidates([medication('Warfarin', '5mg', 'Monday', 'donut', 0.8), medication('Warfarin', '2.5mg', 'Tuesday', 'gemini', 0.99)]);
  assert.equal(results.length, 2);
  assert.equal(new Set(results.map(result => result.dosage)).size, 2);
  assert.ok(results.every(result => result.needsReview && result.confidence <= 0.64));
});
test('API retains all regimen fields from Donut and regex', async () => {
  const result = await requestRoute('4-system-engine/api/routes/analyze.js', '/analyze-prescription', {
    env: { GEMINI_API_KEY: '', VITE_GEMINI_API_KEY: '' },
    fetch: async () => ({ ok: true, json: async () => ({ raw_text: 'Metformin 500mg BID for 7 days after meals', medications: [{ drugName: 'Metformin', dosage: '500mg', frequency: 'BID', duration: '7 days', instructions: 'after meals', confidence: 0.8 }] }) }),
  });
  assert.equal(result.res.statusCode, 200);
  const extracted = result.res.body.medications[0];
  assert.equal(extracted.duration, '7 days');
  assert.equal(extracted.instructions, 'after meals');
  assert.equal(extracted.sourceDetails.regex.candidates[0].duration, '7 days');
  assert.equal(extracted.sourceDetails.regex.candidates[0].rawMatch, 'Metformin 500mg BID for 7 days after meals');
});
test('API never promotes zero or missing provider confidence to a confident extraction', async () => {
  const result = await requestRoute('4-system-engine/api/routes/analyze.js', '/analyze-prescription', {
    env: { GEMINI_API_KEY: '', VITE_GEMINI_API_KEY: '' },
    fetch: async () => ({ ok: true, json: async () => ({ medications: [{ drugName: 'Metformin', dosage: '500mg', frequency: 'BID', confidence: 0 }] }) }),
  });
  assert.equal(result.res.statusCode, 200);
  assert.equal(result.res.body.medications[0].confidence, 0);
  assert.equal(result.res.body.medications[0].needsReview, true);
});
test('API returns unavailable when every prescription provider fails', async () => {
  const result = await requestRoute('4-system-engine/api/routes/analyze.js', '/analyze-prescription');
  assert.equal(result.res.statusCode, 503);
  assert.equal(result.res.body.code, 'PRESCRIPTION_ANALYSIS_UNAVAILABLE');
  assert.equal(result.res.body.success, false);
});
test('Donut timeout remains active while the response body is being read', { timeout: 500 }, async () => {
  const result = await requestRoute('4-system-engine/api/routes/analyze.js', '/analyze-prescription', {
    env: { GEMINI_API_KEY: '', VITE_GEMINI_API_KEY: '', DONUT_TIMEOUT_MS: '5' },
    fetch: async (_url, { signal }) => ({ ok: true, json: () => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('Offline response body timed out')), { once: true });
    }) }),
  });
  assert.equal(result.res.statusCode, 503);
  assert.equal(result.res.body.code, 'PRESCRIPTION_ANALYSIS_UNAVAILABLE');
});
test('face configuration failure never becomes Stable or a wellness score', async () => {
  const result = await requestRoute('4-system-engine/api/routes/emotions.js', '/emotions/analyze-image');
  assert.equal(result.res.statusCode, 503); assert.equal(result.res.body.errorCode, 'FACE_NOT_CONFIGURED');
  assert.equal(result.res.body.emotionLabel, undefined); assert.equal(result.res.body.stateScore, undefined); assert.equal(result.statements.length, 0);
});
test('face timeout returns unavailability and never saves an assessment', async () => {
  const result = await requestRoute('4-system-engine/api/routes/emotions.js', '/emotions/analyze-image', {
    env: { FACE_VISION_CREDENTIALS: 'offline.json' }, fastTimeout: true, fetch: () => new Promise(() => {}) });
  assert.equal(result.res.statusCode, 503); assert.equal(result.res.body.errorCode, 'FACE_UNAVAILABLE');
  assert.equal(result.res.body.stateScore, undefined); assert.equal(result.statements.length, 0);
});
test('legacy Gemini emotion JSON is not accepted as a face report', async () => {
  for (const data of [{}, { emotionLabel: 'Stable', stateScore: 70 }, { responses: [{ faceAnnotations: [{ detectionConfidence: '0.99' }] }] }]) {
    const result = await requestRoute('4-system-engine/api/routes/emotions.js', '/emotions/analyze-image', {
      env: { FACE_VISION_CREDENTIALS: 'offline.json' }, fetch: async () => Response.json(data) });
    assert.equal(result.res.statusCode, 503); assert.equal(result.res.body.errorCode, 'FACE_UNAVAILABLE'); assert.equal(result.res.body.stateScore, undefined);
  }
});
test('face endpoint preserves descriptive Google signals and never persists them as mood', async () => {
  const result = await requestRoute('4-system-engine/api/routes/emotions.js', '/emotions/analyze-image', {
    env: { FACE_VISION_CREDENTIALS: 'offline.json' }, fetch: async () => Response.json({ responses: [{ faceAnnotations: [faceAnnotation()] }] }) });
  assert.equal(result.res.statusCode, 200); assert.equal(result.res.body.version, 'face-report-v1');
  assert.equal(result.res.body.faces[0].confidence, 0.934); assert.equal(result.res.body.stateScore, undefined);
  assert.equal(result.statements.length, 0); assert.equal(result.modelCalls.length, 0);
});
test('Gemini configuration cannot enable face detection without OAuth credentials', async () => {
  const result = await requestRoute('4-system-engine/api/routes/emotions.js', '/emotions/analyze-image');
  assert.equal(result.res.statusCode, 503); assert.equal(result.res.body.errorCode, 'FACE_NOT_CONFIGURED'); assert.equal(result.modelCalls.length, 0);
});
test('authorized caretaker ID is used for wellness alerts instead of a colliding UID', async () => {
  const loaded = await loadSource('4-system-engine/api/routes/emotions.js', { execute: (sql, values) => {
    if (sql.includes('caretaker_residents')) { assert.equal(values[0], 'CT-OWN'); return [[]]; }
    throw new Error('A UID must not be reinterpreted as a caretaker ID');
  } });
  const res = response();
  await loaded.routes.find(route => route.path === '/emotions/wellness-alerts/:caretakerId').handler({ params: { caretakerId: 'CT-OTHER' }, authorizedCaretakerId: 'CT-OWN' }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(loaded.statements.length, 1);
});

for (const [label, path] of [['website', '1-ui-ux/src/app/models/NLPEngine.ts'], ['prescription client', '3-prescription-reader/models/NLPEngine.ts']]) {
  test(`${label}: unavailable Donut still uses safe dose reconciliation`, async () => {
    const loaded = await loadSource(path, { clientGemini: {
      medications: [{ drugName: 'Metformin', dosage: '500mg', frequency: 'twice daily', confidence: 0.99 }],
      corrections: [], rawText: 'Metformin 500mg BID',
    } });
    const result = await new loaded.exports.NLPEngine('offline-test').parseTextToMedication('Metformin 50mg BID');
    assert.equal(result.medications.length, 1);
    assert.equal(result.medications[0].dosage, '500mg');
    assert.equal(result.medications[0].needsReview, true);
    assert.equal(result.medications[0].sourceDetails.regex.candidates[0].dosage, '50mg');
    assert.equal(result.ensemble.donutAvailable, false);
  });
}

function elements(node) {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== 'object') return [];
  return [node, ...elements(node.props?.children)];
}
function words(node) {
  if (Array.isArray(node)) return node.map(words).join('');
  if (node && typeof node === 'object') return words(node.props?.children);
  return node === undefined || node === null ? '' : String(node);
}
test('website upload requires explicit verification and invalidates it after later edits', async () => {
  const reviewMedication = { drugName: 'Metformin', dosage: '500mg', frequency: 'twice daily', duration: '7 days', instructions: 'after meals', confidence: 0.64, needsReview: true, conflictingFields: ['dosage'], reviewReasons: ['Conflicting dosage readings.'] };
  // Patient, doctor, issue date, file, preview, busy, method, step, result, medications.
  const componentHooks = { index: 0, states: ['Fixture Resident', 'Dr. Fixture', '2026-10-04', null, null, false, 'file', 'complete', null, [reviewMedication]] };
  const loaded = await loadSource('1-ui-ux/src/app/components/PrescriptionUpload.tsx', { componentHooks });
  let saved = 0;
  const props = { residentName: 'Fixture Resident', onUpload: async () => { saved++; }, onClose() {} };
  const render = () => { componentHooks.index = 0; return elements(loaded.exports.PrescriptionUpload(props)); };
  const button = (tree, text) => tree.find(element => element.type === 'button' && words(element).includes(text));
  let tree = render();
  tree.find(element => element.type === 'input' && element.props.value === '500mg').props.onChange({ target: { value: '500 mg' } });
  assert.equal(componentHooks.states[9][0].needsReview, true);
  tree = render();
  await button(tree, 'Confirm & Save').props.onClick();
  assert.equal(saved, 0);
  button(tree, 'I checked this medicine').props.onClick();
  assert.equal(componentHooks.states[9][0].verifiedByUser, true);
  tree = render();
  tree.find(element => element.type === 'input' && element.props.value === 'twice daily').props.onChange({ target: { value: 'once daily' } });
  assert.equal(componentHooks.states[9][0].needsReview, true);
  assert.equal(componentHooks.states[9][0].verifiedByUser, false);
  tree = render();
  button(tree, 'I checked this medicine').props.onClick();
  tree = render();
  await button(tree, 'Confirm & Save').props.onClick();
  assert.equal(saved, 1);
});
