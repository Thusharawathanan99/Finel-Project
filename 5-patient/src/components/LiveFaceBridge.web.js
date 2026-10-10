import React, { forwardRef, useRef, useEffect, useImperativeHandle, useState } from 'react';
import { LIVE_FACE_HTML } from '../generated/liveFaceRuntime';
import { createLiveFaceBridgeController } from '../liveFaceBridgeClient';

const LiveFaceBridge = forwardRef(({ onReady, onError }, ref) => {
  const iframe = useRef(null);
  const callbacks = useRef({ onReady, onError }); callbacks.current = { onReady, onError };
  const controller = useRef(null);
  const [generation, setGeneration] = useState(0);
  const send = packet => {
    if (!iframe.current?.contentWindow) throw new Error('local_model');
    iframe.current.contentWindow.postMessage(packet, '*');
  };
  if (!controller.current) controller.current = createLiveFaceBridgeController({
    send, onRestart: token => { try { send({ type: 'dispose' }); } catch {} setGeneration(token); },
    onReady: backend => callbacks.current.onReady?.(backend),
    onError: error => callbacks.current.onError?.(error),
  });
  useImperativeHandle(ref, () => ({ analyze: (image, options) => controller.current.analyze(image, options),
    waitForIdle: () => controller.current.waitForIdle(), restart: () => controller.current.restart() }), []);
  useEffect(() => {
    const receive = event => { if (event.source === iframe.current?.contentWindow) controller.current.receive(typeof event.data === 'string' ? event.data : JSON.stringify(event.data)); };
    window.addEventListener('message', receive);
    controller.current.start();
    return () => {window.removeEventListener('message', receive);try { send({ type: 'dispose' }); } catch {} controller.current.dispose();};
  }, []);
  return React.createElement('iframe', { key: generation, ref: iframe, srcDoc: LIVE_FACE_HTML, title: 'Local face processing',
    sandbox: 'allow-scripts allow-same-origin', 'aria-hidden': true, tabIndex: -1,
    style: { position: 'absolute', width: 1, height: 1, opacity: 0.01, border: 0, pointerEvents: 'none' } });
});
export default LiveFaceBridge;
