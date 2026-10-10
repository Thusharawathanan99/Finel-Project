import { measureFaceImageQuality } from './faceImageQuality.js';
import { tryOfflineFaceAcceleration } from './localFaceAcceleration.js';

// One inference implementation for the browser worker and Expo WebView worker.
export function createLocalFaceRuntime({ faceapi, scope = globalThis, fetchImpl = scope.fetch?.bind(scope) }) {
  let loaded = false, loading = null, busy = false, disposed = false, detector = 'tiny', adaptiveDetailed = false, detailedFallbackMs = null, detailedFallbackCompletedAt = null;
  const names = ['tiny_face_detector', 'face_expression', 'face_landmark_68_tiny', 'ssd_mobilenetv1', 'face_landmark_68'];
  const nets = { tiny_face_detector: faceapi.nets.tinyFaceDetector, face_expression: faceapi.nets.faceExpressionNet,
    face_landmark_68_tiny: faceapi.nets.faceLandmark68TinyNet, ssd_mobilenetv1: faceapi.nets.ssdMobilenetv1,
    face_landmark_68: faceapi.nets.faceLandmark68Net };
  const clamp = value => Math.max(0, Math.min(1, value));
  function environment() {
      // All model inputs/crops are tensors. Media placeholders also allow CPU
      // inference in older workers that do not expose OffscreenCanvas.
      const DummyMedia = class {};
      faceapi.env.setEnv({ Canvas: scope.OffscreenCanvas || DummyMedia, CanvasRenderingContext2D: scope.OffscreenCanvasRenderingContext2D || DummyMedia,
        Image: DummyMedia, Video: DummyMedia, ImageData: scope.ImageData,
        createCanvasElement: () => { if(!scope.OffscreenCanvas)throw Error('UNSUPPORTED');return new scope.OffscreenCanvas(1, 1); }, createImageElement: () => { throw Error('UNSUPPORTED'); },
        fetch: fetchImpl, readFile: () => { throw Error('UNSUPPORTED'); } });
  }
  async function loadEmbedded(name, files) {
    const manifest = files[name + '_model-weights_manifest.json']?.json;
    if (!Array.isArray(manifest)) throw Error('MODEL_UNAVAILABLE');
    const weights = {};
    try {
      for (const group of manifest) {
        const chunks = group.paths.map(filename => {
          const encoded = files[filename]?.base64;
          if (typeof encoded !== 'string') throw Error('MODEL_UNAVAILABLE');
          const text = scope.atob(encoded), bytes = new Uint8Array(text.length);
          for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i);
          return bytes;
        });
        const bytes = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
        let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
        Object.assign(weights, faceapi.tf.io.decodeWeights(bytes.buffer, group.weights));
      }
      nets[name].loadFromWeightMap(weights);
    } catch (error) { Object.values(weights).forEach(tensor => tensor.dispose()); throw error; }
  }
  async function initialize({ modelsPath = '/models/face-api', embeddedModels, wasmAssets, preferRealtime = false, detector: chosen = 'tiny' } = {}) {
    if (disposed) throw Error('STOPPED');
    if (loaded) return { backend: faceapi.tf.getBackend(), detector };
    if (loading) return loading;
    detector = chosen === 'ssd' ? 'ssd' : 'tiny';
    loading = (async () => {
      environment();
      // WASM avoids the old JavaScript CPU kernels in mobile workers. Existing
      // web callers retain their GPU path and portable CPU fallback.
      let accelerated = await tryOfflineFaceAcceleration({ tf: faceapi.tf, scope, assets: wasmAssets });
      if (!accelerated && scope.OffscreenCanvas && faceapi.tf.webgl?.MathBackendWebGL) {
        try {
          const canvas = new scope.OffscreenCanvas(300, 150);
          const gl = canvas.getContext('webgl2', {alpha:false,antialias:false,depth:false,stencil:false});
          if (gl) {
            faceapi.tf.webgl.setWebGLContext(2,gl);
            faceapi.tf.env().set('WEBGL_VERSION',2);
            faceapi.tf.env().set('HAS_WEBGL',true);
            if (!faceapi.tf.findBackendFactory('webgl')) faceapi.tf.registerBackend('webgl',()=>new faceapi.tf.webgl.MathBackendWebGL(),2);
            accelerated = await faceapi.tf.setBackend('webgl');
          }
        } catch { accelerated = false; }
      }
      if (!accelerated) await faceapi.tf.setBackend('cpu');
      const required = chosen === 'auto' ? names : detector === 'ssd'
        ? ['face_expression', 'face_landmark_68', 'ssd_mobilenetv1'] : names.slice(0, 3);
      const results = await Promise.allSettled(required.map(name => embeddedModels ? loadEmbedded(name, embeddedModels) : nets[name].loadFromUri(modelsPath)));
      if (disposed || results.some(result => result.status === 'rejected')) {
        Object.values(nets).forEach(net => { if (net.isLoaded) net.dispose(); });
        throw Error(disposed ? 'STOPPED' : 'MODEL_UNAVAILABLE');
      }
      loaded = true;
      // Select a supported default from the actual inference backend. Both
      // detectors are available in auto mode; per-frame selection stays local.
      if (chosen === 'auto') detector = !preferRealtime && faceapi.tf.getBackend() === 'webgl' ? 'ssd' : 'tiny';
      adaptiveDetailed = chosen === 'auto' && preferRealtime && faceapi.tf.getBackend() === 'wasm';
      return { backend: faceapi.tf.getBackend(), detector };
    })();
    try { return await loading; } finally { loading = null; }
  }
  async function analyze({ width, height, pixels, capturedAt = new Date().toISOString(), detector: requested }) {
    if (!loaded || disposed || busy) throw Error(disposed ? 'STOPPED' : busy ? 'BUSY' : 'MODEL_UNAVAILABLE');
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width * height > 4_000_000 ||
        !(pixels instanceof Uint8Array || pixels instanceof Uint8ClampedArray) || pixels.length !== width * height * 4) throw Error('INVALID_FRAME');
    let selected = requested === undefined || requested === 'auto' ? detector : requested;
    if (selected !== 'tiny' && selected !== 'ssd') throw Error('INVALID_FRAME');
    if (!(selected === 'ssd' ? nets.ssd_mobilenetv1 : nets.tiny_face_detector).isLoaded) throw Error('MODEL_UNAVAILABLE');
    busy = true; const started = scope.performance.now();
    let tensor;
    try {
      tensor = faceapi.tf.browser.fromPixels({ data: new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength), width, height }, 3);
      const options = selected === 'ssd' ? new faceapi.SsdMobilenetv1Options({ minConfidence: 0.55, maxResults: 12 })
        : new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.55 });
      let detections = await faceapi.detectAllFaces(tensor, options).withFaceLandmarks(selected === 'tiny').withFaceExpressions();
      if (adaptiveDetailed && (requested === undefined || requested === 'auto') && selected === 'tiny' && !detections.length &&
          (detailedFallbackMs === null || detailedFallbackMs <= 1500 || scope.performance.now() - detailedFallbackCompletedAt >= 10_000)) {
        // Analyze the same pixels with the stronger face detector when Tiny
        // finds no face. If that extra pass is slow on this device, keep future
        // Adaptive frames fast during a cooldown. Retry after ten seconds so
        // a temporary busy/slow device does not permanently disable detection
        // of small or distant faces. Detailed remains an explicit choice.
        selected = 'ssd'; const fallbackStarted = scope.performance.now();
        detections = await faceapi.detectAllFaces(tensor, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.55, maxResults: 12 }))
          .withFaceLandmarks(false).withFaceExpressions();
        detailedFallbackCompletedAt = scope.performance.now();
        detailedFallbackMs = Math.max(0, detailedFallbackCompletedAt - fallbackStarted);
      }
      if (disposed) throw Error('STOPPED');
      const faces = detections.slice(0, 12).map(result => {
        const raw = result.detection.box;
        const x = clamp(raw.x / width), y = clamp(raw.y / height);
        const box = { x, y, width: clamp((raw.x + raw.width) / width) - x, height: clamp((raw.y + raw.height) / height) - y };
        const scores = Object.fromEntries(['angry','disgusted','fearful','happy','neutral','sad','surprised'].map(key => [key, result.expressions[key]]));
        return { box, detectionConfidence: result.detection.score, scores,
          landmarks: result.landmarks.positions.map(point => ({ x: clamp(point.x / width), y: clamp(point.y / height) })) };
      }).filter(face => face.box.width > 0 && face.box.height > 0).map(face => ({ ...face,
        imageQuality: measureFaceImageQuality({ width, height, pixels, box: face.box, landmarks: face.landmarks }) }));
      return { version: 'live-face-v1', provider: 'face-api.js-local', detector: selected, width, height, capturedAt,
        processingTimeMs: Math.max(0, scope.performance.now() - started), faces };
    } finally { tensor?.dispose(); busy = false; }
  }
  function dispose() { disposed = true; loaded = false; Object.values(nets).forEach(net => { if (net.isLoaded) net.dispose(); }); }
  return { initialize, analyze, dispose };
}
