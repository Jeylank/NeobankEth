export const FONTS = {
  ethiopic: {
    regular: 'NotoSansEthiopic_400Regular',
    medium: 'NotoSansEthiopic_500Medium',
    semibold: 'NotoSansEthiopic_600SemiBold',
    bold: 'NotoSansEthiopic_700Bold',
  },
  system: {
    regular: undefined,
    medium: undefined,
    semibold: undefined,
    bold: undefined,
  },
};

export const getFontFamily = (
  weight: 'regular' | 'medium' | 'semibold' | 'bold' = 'regular',
  useEthiopicFont: boolean = false
): string | undefined => {
  if (useEthiopicFont) {
    return FONTS.ethiopic[weight] || FONTS.ethiopic.regular;
  }
  return FONTS.system[weight];
};

export const ETHIOPIC_FONT_NAMES = {
  NotoSansEthiopic_400Regular: 'NotoSansEthiopic_400Regular',
  NotoSansEthiopic_500Medium: 'NotoSansEthiopic_500Medium',
  NotoSansEthiopic_600SemiBold: 'NotoSansEthiopic_600SemiBold',
  NotoSansEthiopic_700Bold: 'NotoSansEthiopic_700Bold',
};
