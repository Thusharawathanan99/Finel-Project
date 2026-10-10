import { createLiveFaceTracker } from '../../../../../shared/liveFace';
import type { TrackedLiveFrame } from '../../../../../shared/liveFace';

export interface LiveStatus { state:'loading'|'running'|'stopped'|'unavailable'; code?:string; backend?:string; }
export interface LiveOptions { signal?:AbortSignal; detector?:'tiny'|'ssd'; minIntervalMs?:number; maxWidth?:number; }
class FaceWorker {
  worker = new Worker(new URL('./face.worker.ts', import.meta.url), { type:'module' });
  pending = new Map<number,{resolve:(value:any)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
  id = 0;
  constructor() {
    this.worker.onmessage = ({data}) => { const pending = this.pending.get(data.id); if (!pending) return;
      clearTimeout(pending.timer); this.pending.delete(data.id);
      if (data.type === 'error') pending.reject(new Error(data.code)); else pending.resolve(data); };
    this.worker.onerror = () => this.stop();
  }
  request(type:string, payload:any = {}, transfer:Transferable[] = []) {
    return new Promise<any>((resolve,reject) => { const id=++this.id;
      const timer=setTimeout(()=>{ this.pending.delete(id); reject(Error('MODEL_TIMEOUT')); this.stop(); },30000);
      this.pending.set(id,{resolve,reject,timer}); this.worker.postMessage({type,id,...payload},transfer); });
  }
  stop() { this.worker.terminate(); for (const item of this.pending.values()) {clearTimeout(item.timer);item.reject(Error('STOPPED'));} this.pending.clear(); }
}

export async function startLiveFaceDetection(video:HTMLVideoElement, onFrame:(frame:TrackedLiveFrame)=>void,
  onStatus:(status:LiveStatus)=>void, options:LiveOptions = {}):Promise<()=>void> {
  const worker = new FaceWorker(), tracker = createLiveFaceTracker();
  let stopped=false, timer:ReturnType<typeof setTimeout>;
  const minInterval = Number.isFinite(options.minIntervalMs) && options.minIntervalMs! > 0
    ? Math.max(15, options.minIntervalMs!) : 120;
  let lastCapturedFrame:string|null=null;
  const decodedFrame=()=>{
    try {
      const quality=video.getVideoPlaybackQuality?.(), count=quality?.totalVideoFrames, dropped=quality?.droppedVideoFrames;
      // A zero count cannot establish frame freshness; use media time instead.
      if(Number.isInteger(count) && count!>0){
        const presented=Number.isInteger(dropped) && dropped!>=0 && dropped!<=count! ? count!-dropped! : count!;
        return 'frames:'+presented;
      }
    } catch { /* Media time still identifies fresh frames when playback statistics are unavailable. */ }
    return Number.isFinite(video.currentTime) ? 'time:'+video.currentTime : null;
  };
  const stop=()=>{ if(stopped)return;stopped=true;clearTimeout(timer);worker.stop();tracker.reset();options.signal?.removeEventListener('abort',stop); };
  options.signal?.addEventListener('abort',stop,{once:true});
  if(options.signal?.aborted){stop();return stop;}
  const canvas=document.createElement('canvas');
  const context=canvas.getContext('2d',{willReadFrequently:true});
  try {
    onStatus({state:'loading'});
    const info=await worker.request('init',{options:{modelsPath:new URL('/models/face-api',location.origin).href,detector:options.detector||'tiny'}});
    if(stopped)return stop;
    if(!context)throw Error('UNSUPPORTED');
    onStatus({state:'running',backend:info.backend});
    const tick=async()=>{
      if(stopped)return;
      const started=performance.now();
      try {
        if(!document.hidden && video.readyState>=2 && video.videoWidth>0 && video.videoHeight>0 && !video.paused){
          const currentFrame=decodedFrame();
          if(currentFrame!==null && currentFrame===lastCapturedFrame){
            timer=setTimeout(tick,minInterval);return;
          }
          const scale=Math.min(1,(options.maxWidth||640)/Math.max(video.videoWidth,video.videoHeight));
          const width=Math.max(1,Math.round(video.videoWidth*scale)), height=Math.max(1,Math.round(video.videoHeight*scale));
          // Assigning a canvas dimension clears its backing store, even when the value is unchanged.
          if(canvas.width!==width)canvas.width=width;
          if(canvas.height!==height)canvas.height=height;
          context.drawImage(video,0,0,canvas.width,canvas.height);
          const pixels=context.getImageData(0,0,canvas.width,canvas.height).data;
          lastCapturedFrame=currentFrame;
          const result=await worker.request('frame',{frame:{width:canvas.width,height:canvas.height,pixels:pixels.buffer,capturedAt:new Date().toISOString()}},[pixels.buffer]);
          if(!stopped && !document.hidden)onFrame(tracker.update(result.frame));
        }
      } catch {if(!stopped){onStatus({state:'unavailable',code:'MODEL_UNAVAILABLE'});stop();}return;}
      if(!stopped)timer=setTimeout(tick,Math.max(15,minInterval-(performance.now()-started)));
    };
    void tick();
  } catch {if(!stopped)onStatus({state:'unavailable',code:'MODEL_UNAVAILABLE'});stop();}
  return stop;
}

export async function analyzeFacePhoto(dataUrl:string, detector:'tiny'|'ssd'='ssd', options:{signal?:AbortSignal;capturedAt?:string}={}):Promise<TrackedLiveFrame> {
  const worker=new FaceWorker();
  const stop=()=>worker.stop();
  options.signal?.addEventListener('abort',stop,{once:true});
  try {
    if(options.signal?.aborted)throw Error('STOPPED');
    await worker.request('init',{options:{modelsPath:new URL('/models/face-api',location.origin).href,detector}});
    const image=new Image();image.src=dataUrl;await image.decode();
    const scale=Math.min(1,960/Math.max(image.naturalWidth,image.naturalHeight));
    const canvas=document.createElement('canvas');canvas.width=Math.round(image.naturalWidth*scale);canvas.height=Math.round(image.naturalHeight*scale);
    const context=canvas.getContext('2d');if(!context)throw Error('UNSUPPORTED');
    context.drawImage(image,0,0,canvas.width,canvas.height);const pixels=context.getImageData(0,0,canvas.width,canvas.height).data;
    if(options.signal?.aborted)throw Error('STOPPED');
    const result=await worker.request('frame',{frame:{width:canvas.width,height:canvas.height,pixels:pixels.buffer,capturedAt:options.capturedAt||new Date().toISOString()}},[pixels.buffer]);
    if(options.signal?.aborted)throw Error('STOPPED');
    return createLiveFaceTracker({stableFrames:1}).update(result.frame);
  } finally {options.signal?.removeEventListener('abort',stop);worker.stop();}
}
