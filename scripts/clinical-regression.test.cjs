const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');
const project = process.env.CARECONNECT_TEST_ROOT || path.resolve(__dirname, '..');
const esbuild = require(path.join(project, '1-ui-ux/node_modules/esbuild'));
const backend = import(pathToFileURL(path.join(project, '4-system-engine/api/routes/ensemble.js')));

function tsModule(source, globals = {}) {
  const output = esbuild.transformSync(source, {loader: 'ts', format: 'cjs'}).code;
  const sandbox = {module: {exports: {}}, exports: {}, ...globals};
  vm.runInNewContext(output, sandbox);
  return sandbox.module.exports;
}

function clientVariant(base) {
  // Evaluate the actual import graph; provider calls/telemetry are offline doubles.
  // Source reads happen in Node so this works in restricted Windows workspaces too.
  const cache = new Map();
  function load(filename) {
    if (cache.has(filename)) return cache.get(filename);
    const output = esbuild.transformSync(fs.readFileSync(filename, 'utf8'), {
      loader: 'ts', format: 'cjs', define: {'import.meta.env': '{}', 'import.meta.url': JSON.stringify(pathToFileURL(filename).href)},
    }).code;
    const module = {exports: {}};
    cache.set(filename, module.exports);
    vm.runInNewContext(output, {module, exports: module.exports, console: {log() {}, warn() {}}, setTimeout, clearTimeout, performance,
      require(specifier) {
        if (specifier.endsWith('geminiService')) return {isGeminiEnabled: () => false, verifyPrescriptionWithGemini() {throw new Error('Cloud calls are disabled in regression tests');}};
        if (specifier.endsWith('donutService')) return {isDonutEnabled: async () => false, analyzePrescriptionWithDonut() {throw new Error('Model calls are disabled in regression tests');}};
        if (specifier.endsWith('ModelAccuracyTracker')) return {modelAccuracyTracker: {getScopeToken() {return 0;}, recordPrediction() {return 'offline-prediction-id';}}};
        const target = path.resolve(path.dirname(filename), specifier);
        return load(path.extname(target) ? target : target + '.ts');
      },
    });
    cache.set(filename, module.exports);
    return module.exports;
  }
  return {...load(path.join(project, base, 'ensemble/EnsembleOrchestrator.ts')), ...load(path.join(project, base, 'nlp/MedicationParser.ts'))};
}

const variants = [
  ['backend', () => backend],
  ['website', () => clientVariant('1-ui-ux/src/app/ml')],
  ['prescription client', () => clientVariant('3-prescription-reader/client')],
];
function medication(result) { return result.medication || result; }
function candidate(source, dosage, frequency = 'twice daily', confidence = 0.9) {
  return {drugName: 'Metformin', normalizedName: 'metformin', dosage, frequency, duration: '7 days', instructions: 'after meals', source, confidence};
}

for (const [name, get] of variants) {
  test(name + ': dosage disagreement selects stronger evidence and requires review', async () => {
    const {mergeCandidates} = await get();
    const result = mergeCandidates([candidate('donut', '50mg', 'twice daily', 0.4), candidate('gemini', '500mg', 'twice daily', 0.99)]);
    assert.equal(result.length, 1);
    assert.equal(medication(result[0]).dosage, '500mg');
    assert.equal(medication(result[0]).needsReview, true);
    assert.ok(result[0].confidence < 0.65);
  });
  test(name + ': distinct regimens from the same source are retained', async () => {
    const {mergeCandidates} = await get();
    const inputs = [candidate('gemini', '5mg', 'Monday'), candidate('gemini', '2.5mg', 'Tuesday')].map(c => ({...c, drugName: 'Warfarin', normalizedName: 'warfarin'}));
    const result = mergeCandidates(inputs);
    assert.equal(result.length, 2);
    assert.deepEqual(new Set(result.map(r => medication(r).frequency)), new Set(['Monday', 'Tuesday']));
  });
  test(name + ': duplicate observations do not inflate a model vote', async () => {
    const {mergeCandidates} = await get();
    const inputs = [candidate('donut', '500mg', 'twice daily', 0.4), candidate('gemini', '500mg', 'twice daily', 0.9)];
    const normal = mergeCandidates(inputs)[0].confidence;
    const repeated = mergeCandidates([...inputs, ...Array(8).fill(inputs[1])])[0].confidence;
    assert.equal(repeated, normal);
  });
  test(name + ': true agreement supports confidence without losing review fields', async () => {
    const {mergeCandidates} = await get();
    const result = mergeCandidates([candidate('donut', '500mg'), candidate('gemini', '500mg')]);
    assert.equal(result.length, 1);
    assert.equal(medication(result[0]).needsReview, false);
    assert.equal(medication(result[0]).duration, '7 days');
    assert.equal(medication(result[0]).instructions, 'after meals');
  });
  test(name + ': food instructions parse without a missing capture crash', async () => {
    const {parseMedications} = await get();
    const result = parseMedications('Metformin 500mg BID for 7 days after meals');
    assert.equal(result.length, 1);
    assert.equal(medication(result[0]).instructions, 'after meals');
    assert.equal(medication(result[0]).duration, '7 days');
  });
  test(name + ': repeated medicine with a different daily schedule is not discarded', async () => {
    const {parseMedications} = await get();
    const result = parseMedications('Warfarin 5mg Monday\nWarfarin 5mg Tuesday');
    assert.equal(result.length, 2);
    assert.deepEqual(new Set(result.map(r => medication(r).frequency)), new Set(['Monday', 'Tuesday']));
  });
}

function offlineModule(relative, stubs = {}, globals = {}) {
  const cache = new Map();
  function load(filename) {
    if (cache.has(filename)) return cache.get(filename);
    const output = esbuild.transformSync(fs.readFileSync(filename, 'utf8'), {loader: 'ts', format: 'cjs', define: {'import.meta.env': '{}', 'import.meta.url': JSON.stringify(pathToFileURL(filename).href)}}).code;
    const module = {exports: {}};
    cache.set(filename, module.exports);
    vm.runInNewContext(output, {module, exports: module.exports, console: {log() {}, warn() {}, error() {}}, process: {env: {}}, Buffer, performance, setTimeout, clearTimeout, File: class {}, ...globals,
      require(specifier) {
        if (specifier in stubs) return stubs[specifier];
        for (const [suffix, value] of Object.entries(stubs)) if (specifier.endsWith(suffix)) return value;
        if (specifier === 'firebase-admin') return { auth: () => ({ verifyIdToken: async () => ({ uid: 'offline' }) }), firestore: () => ({}) };
        if (specifier.startsWith('node:') || ['crypto', 'path'].includes(specifier)) return require(specifier);
        const target = path.resolve(path.dirname(filename), specifier);
        const resolved = path.extname(target) ? target : (fs.existsSync(target + '.ts') ? target + '.ts' : target + '.js');
        return load(resolved);
      },
    });
    cache.set(filename, module.exports);
    return module.exports;
  }
  return load(path.join(project, relative));
}
const faceBackend = import(pathToFileURL(path.join(project, '4-system-engine/api/routes/faceVision.js')));
const faceFixtures = import(pathToFileURL(path.join(project, '4-system-engine/api/tests/faceFixtures.mjs')));
async function emotionHandler(responseFactory, configured = true) {
  const {createFaceVisionHandler}=await faceBackend;
  const routes = new Map();
  const router = {post(route, handler) {routes.set(route, handler);}, get() {}, put() {}, delete() {}};
  offlineModule('4-system-engine/api/routes/emotions.js', {
    express: {Router: () => router},
    '/faceVision.js': {createFaceVisionHandler: () => createFaceVisionHandler({
      env: configured ? {FACE_VISION_CREDENTIALS:'{"type":"service_account","client_email":"offline@example.test","private_key":"offline-placeholder"}'} : {},
      authFactory:async()=>({getAccessToken:async()=>({token:'offline-token'})}),
      fetchImpl:responseFactory,
    })},
    '/db.js': {default: {execute() {throw new Error('No database calls allowed in analysis fixture');}}},
  });
  return routes.get('/emotions/analyze-image');
}
async function invoke(handler) {
  const {testPNG}=await faceFixtures;
  const response = {statusCode: 200, status(value) {this.statusCode = value; return this;}, json(value) {this.body = value; return this;}};
  await handler({body:{image:testPNG().toString('base64')},user:{uid:'offline-user',profile:{role:'patient'}}}, response);
  return response;
}
test('face route: provider failure is unavailable, never a fabricated wellness assessment', async () => {
  const response = await invoke(await emotionHandler(async () => {throw new Error('fixture offline');}));
  assert.equal(response.statusCode, 503);
  assert.equal(response.body.errorCode, 'FACE_UNAVAILABLE');
  assert.equal(response.body.stateScore, undefined);
});
test('face route: malformed or out-of-range detection confidence is rejected', async () => {
  const {faceAnnotation}=await faceFixtures;
  const response = await invoke(await emotionHandler(async () => Response.json({responses:[{faceAnnotations:[faceAnnotation({detectionConfidence:700})]}]})));
  assert.equal(response.statusCode, 503);
  assert.equal(response.body.errorCode, 'FACE_UNAVAILABLE');
});
test('face route: valid detection preserves measured confidence and never returns a health score', async () => {
  const {faceAnnotation}=await faceFixtures;
  const response = await invoke(await emotionHandler(async () => Response.json({responses:[{faceAnnotations:[faceAnnotation()]}]})));
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.version,'face-report-v1');
  assert.equal(response.body.faces[0].confidence,.934);
  assert.equal(response.body.faceCount,1);
  assert.equal(response.body.stateScore,undefined);
  assert.equal(response.body.emotionLabel,undefined);
});
test('face route: missing server credentials fail closed without invoking a provider', async () => {
  let calls=0;
  const response = await invoke(await emotionHandler(() => {calls++;throw new Error('Must not be invoked');}, false));
  assert.equal(response.statusCode, 503);
  assert.equal(response.body.errorCode, 'FACE_NOT_CONFIGURED');
  assert.equal(calls,0);
});

function launchMode(mode) {
  const launches = [];
  vm.runInNewContext(fs.readFileSync(path.join(project, 'scripts/dev-runner.js'), 'utf8'), {
    require(name) {
      if (name === 'path') return path;
      if (name === 'os') return {platform: () => 'win32'};
      if (name === 'child_process') return {
        spawn(cmd, args, options) {
          launches.push({cmd, args, cwd: options.cwd});
          return {stdout: {on() {}}, stderr: {on() {}}, on() {}, pid: 1};
        },
        spawnSync() { return {status: 1}; },
      };
      if (name === 'fs') return {existsSync() { return false; }};
      throw new Error('Unexpected fixture require');
    },
    __dirname: path.join(project, 'scripts'), process: {argv: ['node', 'runner', mode], env: {}, on() {}},
    console: {log() {}, error() {}},
  });
  return launches;
}
for (const mode of ['app', 'mobile', 'all']) {
  test('launcher: ' + mode + ' starts both apps on different ports', () => {
    const apps = launchMode(mode).filter(c => /[56]-(?:patient|caretaker)$/.test(c.cwd));
    assert.equal(apps.length, 2);
    assert.deepEqual(new Set(apps.map(c => c.args[c.args.indexOf('--port') + 1])), new Set(['8081', '8082']));
  });
}

for (const [name, get] of variants) {
  test(name + ': negative food instructions stay negative and require review', async () => {
    const {parseMedications} = await get();
    const result = parseMedications('Metformin 500mg BID do not take with food');
    assert.equal(result.length, 1);
    assert.equal(medication(result[0]).instructions, 'do not take with food');
    assert.equal(medication(result[0]).needsReview, true);
    assert.equal(medication(result[0]).frequency, 'twice daily');
  });
  test(name + ': leading decimal and line boundaries preserve both real medicines', async () => {
    const {parseMedications} = await get();
    const result = parseMedications('Warfarin .5mg Monday\nMetformin 500mg BID');
    assert.equal(result.length, 2);
    assert.ok(result.some(r => medication(r).drugName === 'Warfarin' && medication(r).dosage === '0.5mg'));
    assert.ok(result.every(r => !medication(r).drugName.includes('\n')));
  });
  test(name + ': fractional schedules and unfamiliar text are preserved for review', async () => {
    const {parseMedications} = await get();
    const fractional = medication(parseMedications('Warfarin 1mg 0.5 - 0 - 1')[0]);
    assert.equal(fractional.frequency, '0.5 in the morning, 1 at night');
    const unknown = medication(parseMedications('Warfarin 1mg alternate per clinic instructions')[0]);
    assert.equal(unknown.needsReview, true);
    assert.match(unknown.frequency, /clinic/);
  });
}
const contextFixture = overrides => ({residentId: 'OFFLINE-ONLY', residentName: 'Synthetic fixture', age: 70, medications: [{name: 'Metformin', dosage: '500mg', frequency: 'BID'}], allergies: ['almonds'], medicalHistory: 'Fixture only', dietaryRestrictions: ['vegetarian'], calorieTarget: 2000, ...overrides});
const mealFixture = overrides => ({name: 'Lentil rice', description: 'Lentils with rice', ingredients: ['lentils', 'rice'], calories: 300, protein: 10, carbs: 40, fat: 5, fiber: 7, rationale: 'Fixture meal for review', warnings: [], tags: ['vegetarian'], ...overrides});
function weekFixture() {return {residentId: 'OFFLINE-ONLY', residentName: 'Synthetic fixture', generatedAt: new Date(), days: ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'].map(day => ({day, ...Object.fromEntries(['breakfast','morningSnack','lunch','afternoonSnack','dinner'].map(slot => [slot, mealFixture()])), totalCalories: -1})), dietaryNotes: 'Review this fixture', medicationConsiderations: [], calorieTarget: 2000, specialDiet: ['vegetarian']};}
function mealEngine(generate, api) {return offlineModule('1-ui-ux/src/app/ml/meal-plan/MealPlanEngine.ts', {'/geminiService': {isGeminiEnabled: () => true, callWithRetry: fn => fn({generateContent: generate})}, '/apiService': {mealPlansApi: api}});}
test('meal safety: reject duplicate days, missing ingredients and negative nutrients; recompute totals', () => {
  const safety = offlineModule('4-system-engine/api/routes/mealPlanSafety.js');
  assert.throws(() => safety.validateWeeklyMealPlan({...weekFixture(), days: Array(7).fill(weekFixture().days[0])}, contextFixture()), /distinct/);
  assert.throws(() => safety.validateMealItem(mealFixture({calories: -100}), contextFixture()), /calories/);
  assert.throws(() => safety.validateMealItem(mealFixture({ingredients: []}), contextFixture()), /ingredient/);
  assert.throws(() => safety.validateMealItem(mealFixture({protein: null}), contextFixture()), /protein/);
  const valid = safety.validateWeeklyMealPlan(weekFixture(), contextFixture());
  assert.equal(valid.days[0].totalCalories, 1500);
  assert.equal(valid.needsReview, true);
});
test('meal safety: all planning changes invalidate saved and cached plans despite same medication count', async () => {
  const safety = offlineModule('4-system-engine/api/routes/mealPlanSafety.js');
  const current = contextFixture();
  const saved = safety.validateWeeklyMealPlan(weekFixture(), current);
  let reads = 0;
  const engine = mealEngine(async () => {throw new Error('No cloud in load fixture');}, {getForResident: async () => {reads++; return {plan: saved, medicationCount: 1};}});
  assert.ok(await engine.loadSavedMealPlan(current.residentId, current));
  assert.ok(await engine.loadSavedMealPlan(current.residentId, current));
  assert.equal(reads, 1);
  for (const changed of [contextFixture({medications: [{name: 'Warfarin', dosage: '5mg', frequency: 'daily'}]}), contextFixture({allergies: ['peanuts']}), contextFixture({calorieTarget: 1800}), contextFixture({medicalHistory: 'Changed fixture'})]) assert.equal(await engine.loadSavedMealPlan(current.residentId, changed), null);
  assert.equal(await engine.loadSavedMealPlan(current.residentId, 1), null);
});
test('meal engine: replacement carries allergies and diet and rejects forbidden food without saving', async () => {
  const safety = offlineModule('4-system-engine/api/routes/mealPlanSafety.js');
  let prompt = '', saves = 0;
  const plan = safety.validateWeeklyMealPlan(weekFixture(), contextFixture());
  const engine = mealEngine(async parts => {prompt = parts.map(p => p.text).join('\n'); return {response: {text: () => JSON.stringify(mealFixture({name: 'Almond rice', ingredients: ['almonds', 'rice']}))}};}, {save: async () => {saves++;}});
  await assert.rejects(engine.regenerateMeal(plan, 0, 'lunch'), /allergen/);
  assert.match(prompt, /Allergies: almonds/);
  assert.match(prompt, /Dietary restrictions: vegetarian/);
  assert.equal(saves, 0);
  assert.equal(plan.days[0].lunch.name, 'Lentil rice');
  assert.throws(() => safety.validateMealItem(mealFixture({name: 'Chicken rice', ingredients: ['chicken', 'rice']}), contextFixture()), /restriction/);
});
test('meal engine: malformed model output never persists an empty week', async () => {
  let saves = 0;
  const engine = mealEngine(async () => ({response: {text: () => JSON.stringify({days: Array(7).fill({day: 'Monday', breakfast: {}, morningSnack: {}, lunch: {}, afternoonSnack: {}, dinner: {}})})}}), {save: async () => {saves++;}});
  await assert.rejects(engine.generateMealPlan(contextFixture()), /distinct/);
  assert.equal(saves, 0);
});
for (const vocalFile of ['1-ui-ux/src/app/ml/audio/VocalToneEngine.ts','2-emotion-detector/client/audio/VocalToneEngine.ts']) {
  test(vocalFile + ': silence, empty and nonfinite audio are unavailable; voiced heuristic is reviewable', async () => {
    const {VocalToneEngine} = offlineModule(vocalFile, {}, {window: {AudioContext: class {}}});
    const engine = new VocalToneEngine();
    for (const samples of [new Float32Array(16000), new Float32Array(0), Float32Array.from({length: 16000}, () => NaN)]) await assert.rejects(engine.analyzeBuffer({getChannelData: () => samples, sampleRate: 16000}), /speech|valid recording/);
    const samples = Float32Array.from({length: 16000}, (_, index) => 0.2 * Math.sin(2 * Math.PI * 220 * index / 16000));
    const result = await engine.analyzeBuffer({getChannelData: () => samples, sampleRate: 16000});
    assert.ok(Number.isFinite(result.wellnessScore));
    assert.equal(result.needsReview, true);
    assert.equal(result.analysisKind, 'acoustic-heuristic');
  });
}
for (const [base, prefix] of [['1-ui-ux/src/app/models','../ml'], ['2-emotion-detector/models','../client']]) {
  test(base + ': absent and failed modalities are not neutral measurements', async () => {
    let face = {faceDetected: false, wellnessScore: 50};
    const {EmotionAnalysisEngine} = offlineModule(base + '/EmotionAnalysisEngine.ts', {[prefix + '/emotion/FacialEmotionEngine']: {FacialEmotionEngine: class {async analyzeFromImage() {return face;}}}, [prefix + '/audio/VocalToneEngine']: {VocalToneEngine: class {async analyzeFile() {throw new Error('Offline vocal failure');}}}});
    const engine = new EmotionAnalysisEngine('offline');
    await assert.rejects(engine.analyzeResident(), /unavailable/);
    await assert.rejects(engine.analyzeResident('synthetic-image'), /unavailable/);
    face = {faceDetected: true, wellnessScore: 90};
    const result = await engine.analyzeResident('synthetic-image', {});
    assert.equal(result.emotionalState.stateScore, 90);
    assert.deepEqual(Array.from(result.unavailableModalities), ['vocal']);
    await assert.rejects(engine.analyzeVocalTone({}), /unavailable/);
  });
}

for (const [name, get] of variants.slice(1)) {
  test(name + ': generated prediction ID reaches the caller', async () => {
    const {runEnsemble} = await get();
    const result = await runEnsemble('Metformin 500mg BID', '');
    assert.equal(result.predictionId, 'offline-prediction-id');
  });
}

function deferredMeal() {let resolve; const promise = new Promise(done => {resolve = done;}); return {promise, resolve};}
const generatedMealFixture = value => ({response: {text: () => JSON.stringify(value)}});
test('meal scope: deferred generation after logout cannot launch a save or refill cache', async () => {
  const provider = deferredMeal(); let saves = 0, reads = 0;
  const engine = mealEngine(() => provider.promise, {save: async () => {saves++;}, getForResident: async () => {reads++; return {plan: null};}});
  const pending = engine.generateMealPlan(contextFixture());
  engine.clearAllMealPlanCaches();
  provider.resolve(generatedMealFixture(weekFixture()));
  await assert.rejects(pending, /account or resident details changed/);
  assert.equal(saves, 0);
  assert.equal(await engine.loadSavedMealPlan('OFFLINE-ONLY', contextFixture()), null);
  assert.equal(reads, 1);
});
test('meal scope: deferred saved-plan GET after logout cannot return or cache private data', async () => {
  const database = deferredMeal(); let reads = 0;
  const safety = offlineModule('4-system-engine/api/routes/mealPlanSafety.js');
  const oldPlan = safety.validateWeeklyMealPlan(weekFixture(), contextFixture());
  const engine = mealEngine(async () => {throw new Error('No provider in GET fixture');}, {getForResident: () => ++reads === 1 ? database.promise : Promise.resolve({plan: null})});
  const pending = engine.loadSavedMealPlan('OFFLINE-ONLY', contextFixture());
  engine.clearAllMealPlanCaches();
  database.resolve({plan: oldPlan});
  await assert.rejects(pending, /account or resident details changed/);
  assert.equal(await engine.loadSavedMealPlan('OFFLINE-ONLY', contextFixture()), null);
  assert.equal(reads, 2);
});
test('meal scope: deferred replacement after logout cannot save or mutate the old plan', async () => {
  const provider = deferredMeal(); let saves = 0;
  const safety = offlineModule('4-system-engine/api/routes/mealPlanSafety.js');
  const oldPlan = safety.validateWeeklyMealPlan(weekFixture(), contextFixture());
  const original = JSON.stringify(oldPlan.days);
  const engine = mealEngine(() => provider.promise, {save: async () => {saves++;}});
  const pending = engine.regenerateMeal(oldPlan, 0, 'lunch');
  engine.clearAllMealPlanCaches();
  provider.resolve(generatedMealFixture(mealFixture({name: 'Alternative rice'})));
  await assert.rejects(pending, /account or resident details changed/);
  assert.equal(saves, 0);
  assert.equal(JSON.stringify(oldPlan.days), original);
});
test('meal scope: save already started before logout cannot publish its completion into the new cache', async () => {
  const save = deferredMeal(); let writes = 0, reads = 0;
  const engine = mealEngine(async () => generatedMealFixture(weekFixture()), {save: () => {writes++; return save.promise;}, getForResident: async () => {reads++; return {plan: null};}});
  const pending = engine.generateMealPlan(contextFixture());
  await new Promise(done => setImmediate(done));
  assert.equal(writes, 1);
  engine.clearAllMealPlanCaches();
  save.resolve();
  await assert.rejects(pending, /account or resident details changed/);
  assert.equal(await engine.loadSavedMealPlan('OFFLINE-ONLY', contextFixture()), null);
  assert.equal(reads, 1);
});
test('meal scope: medication/profile invalidation also rejects an old resident generation', async () => {
  const provider = deferredMeal(); let saves = 0;
  const engine = mealEngine(() => provider.promise, {save: async () => {saves++;}});
  const pending = engine.generateMealPlan(contextFixture());
  engine.clearMealPlanCache('OFFLINE-ONLY');
  provider.resolve(generatedMealFixture(weekFixture()));
  await assert.rejects(pending, /account or resident details changed/);
  assert.equal(saves, 0);
});
