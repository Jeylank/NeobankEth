module.exports = {
  content: [
    "./App.{js,jsx,ts,tsx}",
    "./src/**/*.{js,jsx,ts,tsx}"
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: '#006633',
          light: '#008844',
          dark: '#004422',
        },
        gold: {
          DEFAULT: '#FFD700',
          light: '#FFE44D',
        },
        ethiopian: {
          green: '#006633',
          yellow: '#FFD700',
          red: '#DC2626',
        },
      },
      fontFamily: {
        ethiopic: ['NotoSansEthiopic_400Regular'],
        'ethiopic-medium': ['NotoSansEthiopic_500Medium'],
        'ethiopic-semibold': ['NotoSansEthiopic_600SemiBold'],
        'ethiopic-bold': ['NotoSansEthiopic_700Bold'],
      },
    },
  },
  plugins: [],
};
