import React from 'react';
import { View, ViewProps, StyleSheet, TouchableOpacity } from 'react-native';
import { useTheme, SPACING, BORDER_RADIUS, SHADOWS } from '../theme';

interface ThemedCardProps extends ViewProps {
  variant?: 'default' | 'elevated' | 'outlined';
  padding?: 'none' | 'sm' | 'md' | 'lg';
  onPress?: () => void;
}

export function ThemedCard({
  variant = 'default',
  padding = 'md',
  onPress,
  style,
  children,
  ...props
}: ThemedCardProps) {
  const { colors, isDark } = useTheme();

  const getPadding = () => {
    if (padding === 'none') return 0;
    return SPACING[padding];
  };

  const getCardStyle = () => {
    const baseStyle = {
      backgroundColor: colors.surface,
      borderRadius: BORDER_RADIUS.xl,
      padding: getPadding(),
    };

    switch (variant) {
      case 'elevated':
        return {
          ...baseStyle,
          ...SHADOWS.md,
        };
      case 'outlined':
        return {
          ...baseStyle,
          borderWidth: 1,
          borderColor: colors.border,
        };
      default:
        return {
          ...baseStyle,
          ...SHADOWS.sm,
        };
    }
  };

  const cardContent = (
    <View style={[getCardStyle(), style]} {...props}>
      {children}
    </View>
  );

  if (onPress) {
    return (
      <TouchableOpacity activeOpacity={0.7} onPress={onPress}>
        {cardContent}
      </TouchableOpacity>
    );
  }

  return cardContent;
}

export default ThemedCard;
