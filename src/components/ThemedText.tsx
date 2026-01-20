import React from 'react';
import { Text, TextProps, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme, FONT_SIZES, getFontFamily } from '../theme';

interface ThemedTextProps extends TextProps {
  variant?: 'display' | 'heading' | 'title' | 'body' | 'caption' | 'label';
  weight?: 'regular' | 'medium' | 'semibold' | 'bold';
  color?: 'primary' | 'secondary' | 'tertiary' | 'success' | 'error' | 'warning';
  align?: 'left' | 'center' | 'right';
}

export function ThemedText({
  variant = 'body',
  weight = 'regular',
  color,
  align,
  style,
  children,
  ...props
}: ThemedTextProps) {
  const { colors } = useTheme();
  const { i18n } = useTranslation();
  
  const isAmharic = i18n.language === 'am' || i18n.language === 'om';
  const fontFamily = getFontFamily(weight, isAmharic);

  const getTextColor = () => {
    if (color) {
      switch (color) {
        case 'primary': return colors.primary;
        case 'secondary': return colors.textSecondary;
        case 'tertiary': return colors.textTertiary;
        case 'success': return colors.success;
        case 'error': return colors.error;
        case 'warning': return colors.warning;
      }
    }
    return colors.text;
  };

  const getFontSize = () => {
    switch (variant) {
      case 'display': return FONT_SIZES.display;
      case 'heading': return FONT_SIZES.xxxl;
      case 'title': return FONT_SIZES.xl;
      case 'body': return FONT_SIZES.md;
      case 'caption': return FONT_SIZES.sm;
      case 'label': return FONT_SIZES.xs;
    }
  };

  return (
    <Text
      style={[
        {
          color: getTextColor(),
          fontSize: getFontSize(),
          fontFamily,
          textAlign: align,
        },
        style,
      ]}
      {...props}
    >
      {children}
    </Text>
  );
}

export default ThemedText;
