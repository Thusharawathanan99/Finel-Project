import React from 'react';
import { AccessibilityInfo, Animated, Easing } from 'react-native';

// Decorative motion is independent of all care data, alerts and actions.
const CareArtwork = ({ source = require('../../assets/careconnect-characters.png'), style }) => {
  const float = React.useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    let mounted = true;
    let animation;
    const setMotion = (reduceMotion) => {
      if (!mounted) return;
      if (animation) animation.stop();
      float.setValue(0);
      if (reduceMotion) return;
      animation = Animated.loop(Animated.sequence([
        Animated.timing(float, { toValue: 1, duration: 3400, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(float, { toValue: 0, duration: 3400, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]));
      animation.start();
    };
    AccessibilityInfo.isReduceMotionEnabled().then(setMotion);
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setMotion);
    return () => {
      mounted = false;
      if (animation) animation.stop();
      subscription.remove();
    };
  }, [float]);

  return (
    <Animated.Image
      source={source}
      resizeMode="contain"
      accessible={false}
      pointerEvents="none"
      style={[style, { transform: [
        { perspective: 800 },
        { translateY: float.interpolate({ inputRange: [0, 1], outputRange: [0, -7] }) },
        { rotateY: float.interpolate({ inputRange: [0, 1], outputRange: ['-3deg', '3deg'] }) },
        { rotateZ: float.interpolate({ inputRange: [0, 1], outputRange: ['-2deg', '2deg'] }) },
      ] }]}
    />
  );
};

export default CareArtwork;
