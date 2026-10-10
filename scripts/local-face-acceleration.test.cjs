const test = require('node:test'), assert = require('node:assert/strict');
const path = require('node:path'), { pathToFileURL } = require('node:url');
const helper = import(pathToFileURL(path.resolve(__dirname, '../shared/localFaceAcceleration.js')));
function fixture() {
  const calls = {}, tf = { setPlatform: (name, platform) => { calls.platform = platform; },
    env: () => ({ set: (key, value) => { calls[key] = value; } }), setWasmPaths: (...args) => { calls.paths = args; },
    setBackend: async backend => { calls.backend = backend; return true; }, ready: async () => {}, getBackend: () => calls.backend };
  const scope = { WebAssembly, Response, TextEncoder, TextDecoder, performance, atob };
  const assets = { 'tfjs-backend-wasm.wasm': 'YWJj', 'tfjs-backend-wasm-simd.wasm': 'ZGVm' };
  return { calls, tf, scope, assets };
}
test('offline acceleration serves only bundled binaries and disables unsupported threading', async () => {
  const { tryOfflineFaceAcceleration } = await helper, f = fixture();
  assert.equal(await tryOfflineFaceAcceleration(f), true);
  assert.deepEqual(f.calls.paths, ['careconnect-offline-wasm/', true]); assert.equal(f.calls.WASM_HAS_MULTITHREAD_SUPPORT, false);
  assert.equal(await (await f.calls.platform.fetch('careconnect-offline-wasm/tfjs-backend-wasm.wasm')).text(), 'abc');
  await assert.rejects(f.calls.platform.fetch('https://example.com/private'), /OFFLINE_ASSET_UNAVAILABLE/);
  await assert.rejects(f.calls.platform.fetch('careconnect-offline-wasm/../secrets'), /OFFLINE_ASSET_UNAVAILABLE/);
});
test('unsupported, invalid or failed acceleration returns control to the runtime fallback', async () => {
  const { tryOfflineFaceAcceleration } = await helper;
  for (const change of [f => { f.assets = undefined; }, f => { delete f.scope.WebAssembly; },
    f => { f.assets['tfjs-backend-wasm.wasm'] = 'bad!'; }, f => { f.tf.setBackend = async () => false; },
    f => { f.tf.ready = async () => { throw Error('INIT_FAILED'); }; }]) {
    const f = fixture(); change(f); assert.equal(await tryOfflineFaceAcceleration(f), false);
  }
});
test('CPU fallback still has a worker platform when WASM is unavailable', async () => {
  const { tryOfflineFaceAcceleration } = await helper, f = fixture(); delete f.scope.WebAssembly;
  assert.equal(await tryOfflineFaceAcceleration(f), false);
  assert.equal(f.calls.platform.decode(f.calls.platform.encode('Tamil தமிழ்')), 'Tamil தமிழ்');
});
