import React, { forwardRef, useRef, useEffect, useImperativeHandle, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { WebView } from 'react-native-webview';
import { LIVE_FACE_HTML } from '../generated/liveFaceRuntime';
import { createLiveFaceBridgeController } from '../liveFaceBridgeClient';

const SOURCE = { html: LIVE_FACE_HTML };
const LiveFaceBridge = forwardRef(({ onReady, onError }, ref) => {
  const view = useRef(null);
  const callbacks = useRef({ onReady, onError }); callbacks.current = { onReady, onError };
  const controller = useRef(null);
  const [generation, setGeneration] = useState(0);
  const send = packet => {
    if (!view.current) throw new Error('local_model');
    view.current.injectJavaScript('window.CareConnectFace.receive(' + JSON.stringify(packet) + ');true;');
  };
  if (!controller.current) controller.current = createLiveFaceBridgeController({
    send,
    onRestart: token => { try { send({ type: 'dispose' }); } catch {} setGeneration(token); },
    onReady: backend => callbacks.current.onReady?.(backend), onError: error => callbacks.current.onError?.(error),
  });
  useImperativeHandle(ref, () => ({ analyze: (image, options) => controller.current.analyze(image, options),
    waitForIdle: () => controller.current.waitForIdle(), restart: () => controller.current.restart() }), []);
  useEffect(() => {
    controller.current.start();
    return () => { try { send({ type: 'dispose' }); } catch {} controller.current.dispose(); };
  }, []);
  return <View style={styles.host} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
    <WebView key={generation} ref={view} source={SOURCE} javaScriptEnabled originWhitelist={['*']} scrollEnabled={false}
      style={styles.webView} onMessage={event => controller.current.receive(event.nativeEvent.data, generation)}
      onShouldStartLoadWithRequest={request => request.url.startsWith('about:blank') || request.url.startsWith('data:text/html')}
      onError={() => controller.current.failSurface(generation)}
      onRenderProcessGone={() => controller.current.failSurface(generation)} />
  </View>;
});
const styles = StyleSheet.create({ host: { position: 'absolute', left: 0, top: 0, width: 1, height: 1, opacity: 0.01 }, webView: { width: 1, height: 1, backgroundColor: 'transparent' } });
export default LiveFaceBridge;
