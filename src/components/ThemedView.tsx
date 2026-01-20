import React from 'react';
import { View, ViewProps, StyleSheet } from 'react-native';
import { useTheme, SPACING, BORDER_RADIUS, SHADOWS } from '../theme';

interface ThemedViewProps extends ViewProps {
  variant?: 'background' | 'surface' | 'surfaceSecondary';
  padding?: 'none' | 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  margin?: 'none' | 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  rounded?: 'none' | 'sm' | 'md' | 'lg' | 'xl' | 'full';
  shadow?: 'none' | 'sm' | 'md' | 'lg';
  border?: boolean;
}

export function ThemedView({
  variant = 'background',
  padding = 'none',
  margin = 'none',
  rounded = 'none',
  shadow = 'none',
  border = false,
  style,
  children,
  ...props
}: ThemedViewProps) {
  const { colors } = useTheme();

  const getBackgroundColor = () => {
    switch (variant) {
      case 'background': return colors.background;
      case 'surface': return colors.surface;
      case 'surfaceSecondary': return colors.surfaceSecondary;
    }
  };

  const getPadding = () => {
    if (padding === 'none') return 0;
    return SPACING[padding];
  };

  const getMargin = () => {
    if (margin === 'none') return 0;
    return SPACING[margin];
  };

  const getBorderRadius = () => {
    if (rounded === 'none') return 0;
    return BORDER_RADIUS[rounded];
  };

  const getShadow = () => {
    if (shadow === 'none') return {};
    return SHADOWS[shadow];
  };

  return (
    <View
      style={[
        {
          backgroundColor: getBackgroundColor(),
          padding: getPadding(),
          margin: getMargin(),
          borderRadius: getBorderRadius(),
          ...(border && { borderWidth: 1, borderColor: colors.border }),
        },
        getShadow(),
        style,
      ]}
      {...props}
    >
      {children}
    </View>
  );
}

export default ThemedView;
