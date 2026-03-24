import React, { useRef, useCallback } from 'react';
import { Animated, TouchableWithoutFeedback, StyleProp, ViewStyle } from 'react-native';
import * as Haptics from 'expo-haptics';

interface AnimatedPressableProps {
  children: React.ReactNode;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
  disabled?: boolean;
  hapticStyle?: 'light' | 'medium' | 'heavy' | 'success' | 'none';
  scaleDown?: number;
}

export default function AnimatedPressable({
  children,
  onPress,
  style,
  disabled = false,
  hapticStyle = 'light',
  scaleDown = 0.97,
}: AnimatedPressableProps) {
  const scale = useRef(new Animated.Value(1)).current;

  const handlePressIn = useCallback(() => {
    Animated.spring(scale, {
      toValue: scaleDown,
      useNativeDriver: true,
      speed: 50,
      bounciness: 0,
    }).start();
  }, [scale, scaleDown]);

  const handlePressOut = useCallback(() => {
    Animated.spring(scale, {
      toValue: 1,
      useNativeDriver: true,
      speed: 40,
      bounciness: 6,
    }).start();
  }, [scale]);

  const handlePress = useCallback(() => {
    if (disabled) return;
    try {
      if (hapticStyle === 'light') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      else if (hapticStyle === 'medium') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      else if (hapticStyle === 'heavy') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
      else if (hapticStyle === 'success') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
    }
    onPress();
  }, [disabled, hapticStyle, onPress]);

  return (
    <TouchableWithoutFeedback
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      onPress={handlePress}
      disabled={disabled}
    >
      <Animated.View style={[style, { transform: [{ scale }], opacity: disabled ? 0.6 : 1 }]}>
        {children}
      </Animated.View>
    </TouchableWithoutFeedback>
  );
}
