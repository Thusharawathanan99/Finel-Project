// Offline TensorFlow 4 WASM acceleration. It uses the SDK's own TensorFlow
// instance, so weights and kernels never cross incompatible engine versions.
export async function tryOfflineFaceAcceleration({ tf, scope, assets }) {
  if (!assets || typeof tf.setWasmPaths !== 'function' || typeof tf.setPlatform !== 'function') return false;
  const names = ['tfjs-backend-wasm.wasm', 'tfjs-backend-wasm-simd.wasm'];
  if (names.some(name => typeof assets[name] !== 'string' || assets[name].length > 2_000_000 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(assets[name]))) return false;
  const prefix = 'careconnect-offline-wasm/';
  // This fetch serves only the two bundled binaries, directly from memory. It
  // never forwards an unknown URL to a network or filesystem implementation.
  const offlineFetch = async input => {
    const name = typeof input === 'string' && input.startsWith(prefix) ? input.slice(prefix.length) : null;
    if (!names.includes(name)) throw Error('OFFLINE_ASSET_UNAVAILABLE');
    const raw = scope.atob(assets[name]), bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    return new scope.Response(bytes, { headers: { 'Content-Type': 'application/wasm' } });
  };
  try {
    tf.setPlatform('careconnect-offline', {
      now: () => scope.performance.now(), fetch: offlineFetch,
      encode: value => new scope.TextEncoder().encode(value),
      decode: (bytes, encoding) => new scope.TextDecoder(encoding).decode(bytes),
      isTypedArray: ArrayBuffer.isView,
    });
    if (!scope.WebAssembly || typeof scope.Response !== 'function') return false;
    // Cross-origin isolation is unavailable in the app's local WebView. SIMD
    // is detected normally; threads are disabled rather than relying on headers.
    tf.env().set('WASM_HAS_MULTITHREAD_SUPPORT', false);
    tf.setWasmPaths(prefix, true);
    const selected = await tf.setBackend('wasm');
    if (selected === false) return false;
    await tf.ready();
    return tf.getBackend() === 'wasm';
  } catch { return false; }
}
