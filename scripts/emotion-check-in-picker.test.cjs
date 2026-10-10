// Offline UI regressions for patient-reported feelings. These checks do not
// exercise a camera, measure model accuracy, or send patient/caregiver requests.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '..');
const esbuild = require(path.join(root, '1-ui-ux/node_modules/esbuild'));
const catalogPromise = import(pathToFileURL(path.join(root, 'shared/emotionCheckInCatalog.js')));
const source = fs.readFileSync(path.join(root, '5-patient/src/components/EmotionCheckInPicker.js'), 'utf8');
const code = esbuild.transformSync(source, { loader: 'jsx', format: 'cjs', target: 'es2020' }).code;

function text(node) {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(text).join(' ');
  return node?.children ? text(node.children) : '';
}
function find(node, predicate) {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node)) {
    for (const child of node) { const result = find(child, predicate); if (result) return result; }
    return null;
  }
  return predicate(node) ? node : find(node.children, predicate);
}
async function fixture(initialProps = {}) {
  const catalog = await catalogPromise;
  let stateIndex = 0, props = { language: 'en', ...initialProps }, tree;
  const states = [], selected = [], importsUsed = [], networkAttempts = [];
  const React = {
    createElement: (type, elementProps, ...children) => ({ type, props: elementProps || {}, children }),
    useMemo: callback => callback(),
    useState: initial => {
      const index = stateIndex++;
      if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial;
      return [states[index], value => { states[index] = typeof value === 'function' ? value(states[index]) : value; }];
    },
  };
  const native = { StyleSheet: { create: value => value } };
  for (const name of ['View', 'Text', 'TouchableOpacity', 'TextInput', 'Modal', 'FlatList']) native[name] = name;
  const imports = {
    react: React, 'react-native': native,
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    '@expo/vector-icons': { MaterialCommunityIcons: 'Icon' },
    '../../../shared/emotionCheckInCatalog.js': catalog,
  };
  const mod = { exports: {} };
  const rejectNetwork = (...args) => { networkAttempts.push(args); throw Error('Network unavailable in check-in picker tests'); };
  vm.runInNewContext(code, {
    module: mod, exports: mod.exports,
    require: name => { importsUsed.push(name); if (!Object.hasOwn(imports, name)) throw Error('Unexpected picker import: ' + name); return imports[name]; },
    fetch: rejectNetwork,
    XMLHttpRequest: class { constructor() { rejectNetwork('XMLHttpRequest'); } },
  });
  const render = () => {
    stateIndex = 0;
    tree = mod.exports.default({ ...props, onChange: id => selected.push(id) });
    return tree;
  };
  const node = type => { render(); const found = find(tree, value => value.type === type); assert.ok(found, 'Expected ' + type); return found; };
  const button = label => { render(); const found = find(tree, value => value.type === 'TouchableOpacity' && text(value).trim().replace(/\s+/g, ' ') === label); assert.ok(found, 'Expected button ' + label); return found; };
  const rows = () => node('FlatList').props.data;
  const row = id => {
    const list = node('FlatList');
    const item = list.props.data.find(value => value.id === id);
    assert.ok(item, 'Expected feeling ' + id);
    return list.props.renderItem({ item });
  };
  render();
  return {
    catalog, selected, states, importsUsed, networkAttempts, render, node, rows, row, button,
    copy: () => catalog.getEmotionCheckInCopy(props.language),
    open() { button(catalog.getEmotionCheckInCopy(props.language).allStates).props.onPress(); render(); },
    search(query) { node('TextInput').props.onChangeText(query); render(); },
    setProps(values) { props = { ...props, ...values }; render(); },
  };
}

test('browse exposes all 101 canonical choices without choosing a feeling on mount', async () => {
  const f = await fixture();
  assert.deepEqual(f.selected, []);
  assert.equal(f.node('Modal').props.visible, false);
  f.open();
  assert.equal(f.node('Modal').props.visible, true);
  assert.equal(f.rows().length, 101);
  assert.equal(new Set(f.rows().map(state => state.id)).size, 101);
  assert.deepEqual(f.rows().map(state => state.id), f.catalog.EMOTION_CHECK_IN_STATES.map(state => state.id));
  assert.ok(f.rows().some(state => state.id === 'pain'), 'preserve existing pain check-ins');
  const list = f.node('FlatList');
  assert.equal(list.props.initialNumToRender, 12, 'virtualize the long picker');
  assert.equal(list.props.keyExtractor(f.rows().find(state => state.id === 'grateful')), 'grateful');
});

test('English, Tamil and Sinhala localized searches select the same canonical grateful ID', async () => {
  for (const language of ['en', 'ta', 'si']) {
    const f = await fixture({ language });
    const state = f.catalog.getEmotionCheckInState('grateful', language);
    f.open(); f.search(state.label);
    assert.ok(f.rows().some(item => item.id === 'grateful'));
    const row = f.row('grateful');
    assert.ok(text(row).includes(state.label));
    assert.ok(text(row).includes(f.copy().categories.positive));
    row.props.onPress();
    assert.deepEqual(f.selected, ['grateful']);
    assert.equal(f.node('Modal').props.visible, false);
    f.setProps({ value: 'grateful' });
    assert.ok(text(f.render()).includes(state.label));
    assert.ok(text(f.render()).includes(f.copy().reportSource));
    f.open();
    assert.equal(f.node('TextInput').props.value, '');
    assert.equal(f.rows().length, 101, 'opening again starts with the complete catalog');
  }
});

test('localized sadness category search returns sadness choices and keeps canonical sad selection', async () => {
  for (const language of ['ta', 'si']) {
    const f = await fixture({ language }); f.open(); f.search(f.copy().categories.sadness);
    assert.ok(f.rows().some(state => state.id === 'sad'));
    assert.ok(f.rows().some(state => state.id === 'grieving'));
    assert.ok(f.rows().every(state => state.category === 'sadness'));
    f.row('sad').props.onPress(); assert.deepEqual(f.selected, ['sad']);
  }
});

test('English names remain searchable while Tamil and Sinhala labels are displayed', async () => {
  for (const language of ['ta', 'si']) {
    const f = await fixture({ language }); f.open(); f.search('grateful');
    assert.equal(f.rows().length, 1);
    assert.equal(f.rows()[0].id, 'grateful');
    assert.equal(f.rows()[0].label, f.catalog.getEmotionCheckInState('grateful', language).label);
  }
});

test('unknown searches show an empty result and an unrecognized ID cannot be selected', async () => {
  const f = await fixture({ value: 'not-a-valid-feeling' }); f.open(); f.search('zzzz-no-match-102');
  assert.equal(f.rows().length, 0);
  assert.equal(text(f.node('FlatList').props.ListEmptyComponent), f.copy().noResults);
  const unknown = f.node('FlatList').props.renderItem({ item: { id: 'not-a-valid-feeling', category: 'positive', label: 'Synthetic unknown', emoji: '?' } });
  unknown.props.onPress();
  assert.deepEqual(f.selected, []);
  assert.equal(f.node('Modal').props.visible, true);
  assert.ok(!text(f.render()).includes(f.copy().reportSource), 'unknown value has no selected-feeling receipt');
});

test('disabled picker ignores common, browse, and catalog selection handlers', async () => {
  const f = await fixture({ disabled: true, value: 'neutral' });
  const happy = f.catalog.getEmotionCheckInState('happy');
  f.button(happy.emoji + ' ' + happy.label).props.onPress();
  f.open();
  f.row('grateful').props.onPress();
  assert.deepEqual(f.selected, []);
  assert.equal(f.node('Modal').props.visible, false);
  f.setProps({ disabled: false });
  assert.equal(f.node('Modal').props.visible, false, 'a disabled browse event cannot secretly open later');
});

test('every language shows explicit patient-reported and camera-limit notices', async () => {
  for (const language of ['en', 'ta', 'si']) {
    const f = await fixture({ language, value: 'sad' });
    assert.ok(f.copy().description.length > 80);
    assert.ok(f.copy().reportSource.length > 20);
    assert.ok(text(f.render()).includes(f.copy().description));
    assert.ok(text(f.render()).includes(f.copy().reportSource));
    f.open();
    const close = find(f.render(), node => node.type === 'TouchableOpacity' && node.props.accessibilityLabel === f.copy().close);
    assert.ok(typeof f.copy().close === 'string' && f.copy().close.length > 0, 'localized accessible close label is required');
    assert.ok(close);
    close.props.onPress();
    assert.equal(f.node('Modal').props.visible, false);
  }
});

test('system back dismisses browsing without changing the patient answer', async () => {
  const f = await fixture({ value: 'anxious' }); f.open(); f.search('happy');
  f.node('Modal').props.onRequestClose();
  assert.equal(f.node('Modal').props.visible, false);
  assert.deepEqual(f.selected, []);
});

test('browsing and choosing feelings perform no API requests or camera-score reads', async () => {
  let cameraReads = 0;
  const cameraScores = new Proxy({ happy: 1 }, { get() { cameraReads++; throw Error('Camera scores must not supply a patient answer'); } });
  const f = await fixture({ cameraScores, facialEmotion: 'happy' });
  f.open(); f.search('sad'); f.row('sad').props.onPress();
  assert.deepEqual(f.selected, ['sad'], 'camera Happy score must not choose the reported feeling');
  assert.equal(f.networkAttempts.length, 0);
  assert.equal(cameraReads, 0);
  assert.ok(f.importsUsed.every(name => !/apiHelper|firebase|liveFace|camera/i.test(name)), 'picker has no camera, authentication or API capability');
});
