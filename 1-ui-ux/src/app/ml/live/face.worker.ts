import * as faceapi from 'face-api.js';
import { createLocalFaceRuntime } from '../../../../../shared/localFaceRuntime.js';

const scope: any = globalThis;
const runtime = createLocalFaceRuntime({ faceapi, scope });
let working = false;
scope.onmessage = async ({ data }: MessageEvent) => {
  if (working) return scope.postMessage({ type:'error', id:data.id, code:'BUSY' });
  working = true;
  try {
    if (data.type === 'init') { const info = await runtime.initialize(data.options); scope.postMessage({type:'ready',id:data.id,...info}); }
    else if (data.type === 'frame') {
      const frame = await runtime.analyze({ ...data.frame, pixels:new Uint8Array(data.frame.pixels) });
      scope.postMessage({type:'result',id:data.id,frame});
    }
  } catch { scope.postMessage({type:'error',id:data.id,code:'MODEL_UNAVAILABLE'}); }
  finally { working = false; }
};
