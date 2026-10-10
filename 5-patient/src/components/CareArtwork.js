import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated } from 'react-native';

// Decorative motion follows the device's reduced-motion preference.
const CareArtwork = ({ style }) => {
  const float = useRef(new Animated.Value(0)).current;
  const [reduceMotion, setReduceMotion] = useState(true);

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled().then(value => {
      if (mounted) setReduceMotion(value);
    }).catch(() => {});
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => { mounted = false; subscription.remove(); };
  }, []);

  useEffect(() => {
    if (reduceMotion) { float.stopAnimation(); float.setValue(0); return; }
    const motion = Animated.loop(Animated.sequence([
      Animated.timing(float, { toValue: 1, duration: 2400, useNativeDriver: true }),
      Animated.timing(float, { toValue: 0, duration: 2400, useNativeDriver: true }),
    ]));
    motion.start();
    return () => motion.stop();
  }, [reduceMotion, float]);

  return (
    <Animated.Image
      source={require('../../assets/careconnect-characters.png')}
      style={[style, { transform: [
        { perspective: 800 },
        { translateY: float.interpolate({ inputRange: [0, 1], outputRange: [0, -7] }) },
        { rotate: float.interpolate({ inputRange: [0, 1], outputRange: ['-2deg', '2deg'] }) },
      ] }]}
      resizeMode="contain"
      accessible={false}
      accessibilityIgnoresInvertColors
    />
  );
};

export default CareArtwork;
