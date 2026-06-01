import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import { getLocales } from 'expo-localization';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Shared namespaces (common to web and mobile)
import sharedEs from '../../shared/i18n/locales/es.json';
import sharedEn from '../../shared/i18n/locales/en.json';
import sharedPt from '../../shared/i18n/locales/pt.json';

// Mobile-only namespaces
import mobileEs from './locales/es.json';
import mobileEn from './locales/en.json';
import mobilePt from './locales/pt.json';

export const LANG_KEY = 'searchpet-lang';

const supportedLangs = ['es', 'en', 'pt'];

// Detect language synchronously from device locale
const deviceLang = getLocales()[0]?.languageCode ?? 'es';
const initialLang = supportedLangs.includes(deviceLang) ? deviceLang : 'es';

i18next
  .use(initReactI18next)
  .init({
    lng: initialLang,
    fallbackLng: 'es',
    resources: {
      es: { ...sharedEs, ...mobileEs },
      en: { ...sharedEn, ...mobileEn },
      pt: { ...sharedPt, ...mobilePt },
    },
    interpolation: { escapeValue: false },
  });

// Async hydration from AsyncStorage — overrides device detection if user made a choice
AsyncStorage.getItem(LANG_KEY).then((saved) => {
  if (saved && supportedLangs.includes(saved)) {
    i18next.changeLanguage(saved);
  }
});

export default i18next;
