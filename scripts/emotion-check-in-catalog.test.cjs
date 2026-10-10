const test = require('node:test'), assert = require('node:assert/strict');
const path = require('node:path'), { pathToFileURL } = require('node:url');
const modulePromise = import(pathToFileURL(path.resolve(__dirname, '../shared/emotionCheckInCatalog.js')));
const exactUserList = [
  'happy', 'joyful', 'excited', 'cheerful', 'delighted', 'amused', 'content', 'satisfied', 'relaxed', 'calm',
  'peaceful', 'hopeful', 'optimistic', 'proud', 'confident', 'grateful', 'thankful', 'loving', 'affectionate', 'caring',
  'compassionate', 'inspired', 'motivated', 'enthusiastic', 'energetic', 'playful', 'curious', 'interested', 'focused', 'attentive',
  'surprised', 'amazed', 'astonished', 'shocked', 'startled', 'confused', 'puzzled', 'uncertain', 'doubtful', 'hesitant',
  'sad', 'unhappy', 'sorrowful', 'depressed', 'lonely', 'heartbroken', 'disappointed', 'hopeless', 'miserable', 'tearful',
  'grieving', 'regretful', 'guilty', 'ashamed', 'embarrassed', 'rejected', 'hurt', 'angry', 'furious', 'irritated',
  'annoyed', 'frustrated', 'enraged', 'resentful', 'hostile', 'aggressive', 'outraged', 'impatient', 'disgusted', 'repulsed',
  'contemptuous', 'afraid', 'fearful', 'scared', 'terrified', 'panicked', 'anxious', 'nervous', 'worried', 'concerned',
  'alarmed', 'tense', 'stressed', 'uneasy', 'insecure', 'overwhelmed', 'distressed', 'agitated', 'restless', 'uncomfortable',
  'tired', 'fatigued', 'exhausted', 'sleepy', 'drowsy', 'bored', 'apathetic', 'neutral', 'concentrated', 'relieved',
];

test('catalog preserves the exact 100 user choices and the existing pain check-in without invented predictions', async () => {
  const { EMOTION_CHECK_IN_STATES: states } = await modulePromise;
  assert.equal(states.length, 101);
  assert.equal(new Set(states.map(state => state.id)).size, 101);
  assert.deepEqual(states.map(state => state.id), [...exactUserList, 'pain']);
  for (const state of states) {
    assert.deepEqual(Object.keys(state).sort(), ['category', 'emoji', 'id', 'labels']);
    assert.match(state.id, /^[a-z]+$/);
    assert.equal(typeof state.emoji, 'string');
    assert.ok(state.emoji.length > 0);
  }
});

test('all choices and categories have nonempty English, Tamil and Sinhala labels', async () => {
  const { EMOTION_CHECK_IN_STATES: states, getEmotionCheckInCopy, getEmotionCheckInState } = await modulePromise;
  for (const lang of ['en', 'ta', 'si']) {
    const copy = getEmotionCheckInCopy(lang);
    for (const key of ['title', 'description', 'reportSource', 'searchPlaceholder', 'allStates', 'noResults', 'statesCountLabel', 'close',
      'reportTitle', 'shareReport', 'wellnessScore', 'note', 'recordedAt', 'clinicalLimit']) {
      assert.equal(typeof copy[key], 'string'); assert.ok(copy[key].trim());
    }
    for (const state of states) {
      assert.equal(typeof state.labels[lang], 'string'); assert.ok(state.labels[lang].trim());
      assert.equal(getEmotionCheckInState(state.id, lang).label, state.labels[lang]);
      assert.ok(copy.categories[state.category]);
      if (lang === 'ta') assert.match(state.labels[lang], /[\u0b80-\u0bff]/);
      if (lang === 'si') assert.match(state.labels[lang], /[\u0d80-\u0dff]/);
    }
  }
  assert.match(getEmotionCheckInCopy('en').description, /camera cannot identify these 100 states/i);
  assert.match(getEmotionCheckInCopy('en').reportSource, /Patient-reported/);
  assert.equal(getEmotionCheckInState('neutral', 'en').label, 'Neutral');
  assert.notEqual(getEmotionCheckInState('neutral', 'ta').label, 'இயல்பு');
});

test('search supports English, chosen localized language, categories, Latin accents and casing without corrupting Indic vowels', async () => {
  const { searchEmotionCheckInStates, getEmotionCheckInCopy, getEmotionCheckInState } = await modulePromise;
  assert.deepEqual(searchEmotionCheckInStates('  HÁPPY  ').map(state => state.id), ['happy', 'unhappy']);
  assert.equal(searchEmotionCheckInStates('', 'ta').length, 101);
  for (const lang of ['en', 'ta', 'si']) {
    const state = getEmotionCheckInState('panicked', lang);
    assert.ok(searchEmotionCheckInStates(state.label, lang).some(result => result.id === state.id));
    assert.ok(searchEmotionCheckInStates(state.label.normalize('NFD'), lang).some(result => result.id === state.id));
    assert.ok(searchEmotionCheckInStates('PANICKED', lang).some(result => result.id === state.id));
    const category = getEmotionCheckInCopy(lang).categories.affection;
    assert.equal(searchEmotionCheckInStates(category, lang).filter(result => result.category === 'affection').length, 4);
  }
  assert.ok(searchEmotionCheckInStates('வலி', 'ta').some(result => result.id === 'pain'));
  assert.ok(searchEmotionCheckInStates('වේදනාව', 'si').some(result => result.id === 'pain'));
  assert.deepEqual(searchEmotionCheckInStates('thisworddoesnotexist', 'en'), []);
  assert.deepEqual(searchEmotionCheckInStates({ toString: () => 'happy' }, 'en'), []);
});

test('unknown IDs are rejected, language falls back to English, and public catalog data cannot be mutated', async () => {
  const { EMOTION_CHECK_IN_STATES: states, getEmotionCheckInCopy, getEmotionCheckInState, searchEmotionCheckInStates } = await modulePromise;
  for (const id of ['normal', 'emergency', 'heartAttack', 'HAPPY', '__proto__', 'toString', '', null, 0, {}]) {
    assert.equal(getEmotionCheckInState(id, 'en'), null);
  }
  assert.equal(getEmotionCheckInState('happy', 'unknown').label, 'Happy');
  assert.equal(getEmotionCheckInCopy('unknown'), getEmotionCheckInCopy('en'));
  assert.ok(Object.isFrozen(states));
  assert.ok(Object.isFrozen(states[0])); assert.ok(Object.isFrozen(states[0].labels));
  assert.ok(Object.isFrozen(getEmotionCheckInCopy('ta')));
  assert.ok(Object.isFrozen(getEmotionCheckInCopy('ta').categories));
  assert.ok(Object.isFrozen(getEmotionCheckInState('happy', 'si')));
  const results = searchEmotionCheckInStates('happy'); results.pop();
  assert.equal(states.length, 101);
});

test('shared check-in reports preserve subjective source, localized labels, save date and clinical limits', async () => {
  const { buildEmotionCheckInReport, getEmotionCheckInState, getEmotionCheckInCopy } = await modulePromise;
  const recordedAt = '2026-10-08T00:20:00.000Z';
  for (const lang of ['en', 'ta', 'si']) {
    const copy = getEmotionCheckInCopy(lang), state = getEmotionCheckInState('panicked', lang);
    const report = buildEmotionCheckInReport({ stateId: 'panicked', wellnessScore: 25, note: 'Please check on me.', language: lang, recordedAt });
    for (const value of [copy.reportTitle, copy.reportSource, state.emoji, state.label, copy.wellnessScore, '25/100',
      recordedAt, copy.note, 'Please check on me.', copy.clinicalLimit]) assert.ok(report.includes(value));
  }
  const report = buildEmotionCheckInReport({ stateId: 'neutral', wellnessScore: 100, recordedAt: new Date(recordedAt) });
  assert.match(report, /not a camera estimate or a diagnosis/);
  assert.match(report, /cannot confirm or rule out an emergency/);
  assert.doesNotMatch(report, /100%|camera-detected|Emergency Alert|Normal:/);
  assert.ok(!report.includes('Patient note:'));
  const numericReport = buildEmotionCheckInReport({ stateId: 'pain', wellnessScore: 0, note: 'x'.repeat(4500), recordedAt: Date.parse(recordedAt) });
  assert.ok(numericReport.includes(recordedAt));
});

test('report rejects invalid state, score, note or missing save date rather than inventing a result', async () => {
  const { buildEmotionCheckInReport } = await modulePromise;
  const valid = { stateId: 'happy', wellnessScore: 60, note: '', recordedAt: '2026-10-08T00:20:00.000Z' };
  for (const overrides of [{ stateId: 'emergency' }, { wellnessScore: -1 }, { wellnessScore: 101 }, { wellnessScore: 50.5 },
    { wellnessScore: '60' }, { wellnessScore: NaN }, { note: 'x'.repeat(4501) }, { note: null }, { recordedAt: undefined },
    { recordedAt: null }, { recordedAt: '' }, { recordedAt: 'invalid-date' }, { recordedAt: NaN }, { recordedAt: new Date(NaN) }]) {
    assert.throws(() => buildEmotionCheckInReport({ ...valid, ...overrides }));
  }
  assert.throws(() => buildEmotionCheckInReport());
});
