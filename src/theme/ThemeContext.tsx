import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { useColorScheme, Appearance } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { COLORS, ColorScheme, ThemeColors } from './colors';

interface ThemeContextType {
  isDark: boolean;
  colors: ThemeColors;
  colorScheme: ColorScheme;
  toggleTheme: () => void;
  setColorScheme: (scheme: ColorScheme | 'system') => void;
  userPreference: ColorScheme | 'system';
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

const THEME_STORAGE_KEY = '@neobanker_theme';

interface ThemeProviderProps {
  children: ReactNode;
}

export function ThemeProvider({ children }: ThemeProviderProps) {
  const systemColorScheme = useColorScheme();
  const [userPreference, setUserPreference] = useState<ColorScheme | 'system'>('system');
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    loadThemePreference();
  }, []);

  useEffect(() => {
    const subscription = Appearance.addChangeListener(({ colorScheme }) => {
      if (userPreference === 'system') {
      }
    });

    return () => subscription.remove();
  }, [userPreference]);

  const loadThemePreference = async () => {
    try {
      const savedTheme = await AsyncStorage.getItem(THEME_STORAGE_KEY);
      if (savedTheme) {
        setUserPreference(savedTheme as ColorScheme | 'system');
      }
    } catch (error) {
      console.error('Error loading theme preference:', error);
    } finally {
      setIsLoaded(true);
    }
  };

  const saveThemePreference = async (preference: ColorScheme | 'system') => {
    try {
      await AsyncStorage.setItem(THEME_STORAGE_KEY, preference);
    } catch (error) {
      console.error('Error saving theme preference:', error);
    }
  };

  const colorScheme: ColorScheme = 
    userPreference === 'system' 
      ? (systemColorScheme || 'light')
      : userPreference;

  const isDark = colorScheme === 'dark';
  const colors = COLORS[colorScheme];

  const toggleTheme = () => {
    const newScheme = isDark ? 'light' : 'dark';
    setUserPreference(newScheme);
    saveThemePreference(newScheme);
  };

  const setColorScheme = (scheme: ColorScheme | 'system') => {
    setUserPreference(scheme);
    saveThemePreference(scheme);
  };

  if (!isLoaded) {
    return null;
  }

  return (
    <ThemeContext.Provider
      value={{
        isDark,
        colors,
        colorScheme,
        toggleTheme,
        setColorScheme,
        userPreference,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}
