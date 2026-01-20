import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import * as Localization from 'expo-localization';
import AsyncStorage from '@react-native-async-storage/async-storage';

import en from './locales/en.json';
import am from './locales/am.json';
import om from './locales/om.json';

const LANGUAGE_KEY = 'app_language';

export const languages = [
  { code: 'en', name: 'English', nativeName: 'English' },
  { code: 'am', name: 'Amharic', nativeName: 'አማርኛ' },
  { code: 'om', name: 'Oromifa', nativeName: 'Afaan Oromoo' },
];

const resources = {
  en: { translation: en },
  am: { translation: am },
  om: { translation: om },
};

const initI18n = async () => {
  let savedLanguage = await AsyncStorage.getItem(LANGUAGE_KEY);
  
  if (!savedLanguage) {
    const deviceLanguage = Localization.locale.split('-')[0];
    savedLanguage = ['en', 'am', 'om'].includes(deviceLanguage) ? deviceLanguage : 'en';
  }

  await i18n.use(initReactI18next).init({
    resources,
    lng: savedLanguage,
    fallbackLng: 'en',
    interpolation: {
      escapeValue: false,
    },
    compatibilityJSON: 'v3',
  });
};

export const changeLanguage = async (languageCode: string) => {
  await AsyncStorage.setItem(LANGUAGE_KEY, languageCode);
  await i18n.changeLanguage(languageCode);
};

export const getCurrentLanguage = () => i18n.language;

initI18n();

export default i18n;
