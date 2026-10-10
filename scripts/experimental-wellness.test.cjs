const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '..'), esbuild = require(path.join(root, '1-ui-ux/node_modules/esbuild'));
const moduleValue = { exports: {} };
vm.runInNewContext(esbuild.transformSync(fs.readFileSync(path.join(root, 'shared/experimentalWellness.js'), 'utf8'), { format: 'cjs' }).code,
  { module: moduleValue, exports: moduleValue.exports, Float32Array, Date, Math, Number, Object, Array, Error });
const { assessExpressionFrame, combineExperimentalAssessment, experimentalObservation, analyzeAcousticSamples } = moduleValue.exports;
const persistence = import(pathToFileURL(path.join(root, '4-system-engine/api/routes/wellnessPersistence.js')));
function frame(label = 'happy') { return { capturedAt: new Date().toISOString(), faces: [{ detectionConfidence: 0.95, stable: true, expression: label,
  scores: Object.fromEntries(['happy','surprised','neutral','sad','fearful','disgusted','angry'].map(key => [key, key === label ? 1 : 0])) }] }; }
function sine(variable = false) { return Float32Array.from({ length: 32000 }, (_, i) => (variable ? 0.1 * (1 + 0.7 * Math.sin(i / 16000 * 2 * Math.PI * 4)) : 0.1) * Math.sin(i / 16000 * 2 * Math.PI * 180)); }
test('weighted facial scores follow the documented weights and remain experimental', () => {
  for (const [label, score] of [['happy',95],['neutral',60],['angry',10]]) {
    const result = combineExperimentalAssessment(assessExpressionFrame(frame(label)));
    assert.equal(result.stateScore, score); assert.equal(result.reviewRequired, true); assert.equal(result.clinicalDiagnosis, false);
  }
});
test('missing, ambiguous, uncertain and low-quality faces abstain without invented score', () => {
  for (const change of [value => value.faces = [], value => value.faces.push(value.faces[0]), value => value.faces[0].stable = false,
    value => value.faces[0].expression = 'uncertain', value => value.faces[0].detectionConfidence = 0.2,
    value => value.faces[0].scores.happy = NaN]) { const value = frame(); change(value); assert.equal(assessExpressionFrame(value), null); }
});
test('autocorrelation measures voiced pitch and exposes jitter, shimmer, spectral energy and RMS', () => {
  const measured = analyzeAcousticSamples(sine(), 16000);
  assert.ok(Math.abs(measured.features.pitchMean - 180) < 5);
  for (const key of ['jitter','shimmer','spectralEnergy','rmsVolume']) assert.ok(Number.isFinite(measured.features[key]));
  assert.ok(measured.stabilityScore >= 90); assert.equal(measured.stabilityScore + measured.distressScore, 100);
});
test('voice amplitude variation changes acoustic proxy and multimodal score', () => {
  const stable = analyzeAcousticSamples(sine(), 16000), variable = analyzeAcousticSamples(sine(true), 16000);
  assert.ok(variable.features.shimmer > stable.features.shimmer);
  const combined = combineExperimentalAssessment(assessExpressionFrame(frame()), variable);
  assert.equal(combined.stateScore, Math.round((95 + variable.wellnessScore) / 2)); assert.equal(combined.modalities.length, 2);
});
test('silent, short, non-finite and clipped recordings are rejected', () => {
  assert.throws(() => analyzeAcousticSamples(new Float32Array(16000), 16000));
  assert.throws(() => analyzeAcousticSamples(new Float32Array(100), 16000));
  const invalid = sine(); invalid[1] = NaN; assert.throws(() => analyzeAcousticSamples(invalid, 16000));
  assert.throws(() => analyzeAcousticSamples(Float32Array.from(sine(), value => Math.sign(value)), 16000));
});
test('reviewed assessment payload preserves medicine/note and rejects unreviewed or inconsistent save', async () => {
  const { validateObservation } = await persistence;
  const body = { residentId: 'synthetic-R1', ...experimentalObservation(combineExperimentalAssessment(assessExpressionFrame(frame())), 'Patient observation', 'Medicine A') };
  assert.equal(validateObservation(body), null); assert.equal(body.relatedMedicine, 'Medicine A'); assert.equal(body.note, 'Patient observation');
  assert.match(validateObservation({ ...body, reviewed: false }), /review/);
  assert.match(validateObservation({ ...body, stateScore: 10 }), /review/);
});
test('AI-derived low score records provenance and a review warning instead of critical conclusion', async () => {
  const { persistObservation } = await persistence, calls = [];
  const connection = { beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release() {}, async execute(sql, args) {
    calls.push({ sql, args }); if (sql.startsWith('SELECT name')) return [[{ name: 'Synthetic resident' }]];
    if (sql.startsWith('SELECT')) return [[]]; return [{ insertId: 123 }];
  } };
  const body = { residentId: 'synthetic-R1', ...experimentalObservation(combineExperimentalAssessment(assessExpressionFrame(frame('angry')))), observationId: 'synthetic-observation-id' };
  const result = await persistObservation({ getConnection: async () => connection }, body);
  assert.equal(result.severity, 'warning'); assert.match(result.note, /not a clinical diagnosis/);
  const history = calls.find(call => call.sql.startsWith('INSERT INTO emotional_states'));
  assert.ok(history); assert.match(history.args[5], /Experimental assessment/);
});
