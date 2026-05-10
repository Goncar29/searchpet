import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import es from './locales/es.json';
import en from './locales/en.json';

const savedLang = localStorage.getItem('searchpet-lang');
const browserLang = navigator.language?.split('-')[0];
const detectedLang = savedLang || (browserLang === 'en' ? 'en' : 'es');

i18n
  .use(initReactI18next)
  .init({
    lng: detectedLang,
    fallbackLng: 'es',
    defaultNS: 'common',
    resources: {
      es: {
        common: es.common,
        layout: es.layout,
        home: es.home,
        auth: es.auth,
        pets: es.pets,
        reports: es.reports,
        shelters: es.shelters,
        footer: es.footer,
        map: es.map,
        profile: es.profile,
      },
      en: {
        common: en.common,
        layout: en.layout,
        home: en.home,
        auth: en.auth,
        pets: en.pets,
        reports: en.reports,
        shelters: en.shelters,
        footer: en.footer,
        map: en.map,
        profile: en.profile,
      },
    },
    interpolation: {
      escapeValue: false,
    },
  });

export default i18n;
