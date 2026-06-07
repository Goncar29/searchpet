import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

// Shared namespaces (common to web and mobile)
import sharedEs from '@shared/i18n/locales/es.json';
import sharedEn from '@shared/i18n/locales/en.json';
import sharedPt from '@shared/i18n/locales/pt.json';

// Web-only namespaces
import es from './locales/es.json';
import en from './locales/en.json';
import pt from './locales/pt.json';

const savedLang = localStorage.getItem('searchpet-lang');
const browserLang = navigator.language?.split('-')[0];
const detectedLang = savedLang || (browserLang === 'en' ? 'en' : browserLang === 'pt' ? 'pt' : 'es');

i18n
  .use(initReactI18next)
  .init({
    lng: detectedLang,
    fallbackLng: 'es',
    defaultNS: 'common',
    resources: {
      es: {
        // Shared namespaces
        common: sharedEs.common,
        auth: sharedEs.auth,
        pets: sharedEs.pets,
        chat: sharedEs.chat,
        messages: sharedEs.messages,
        badges: sharedEs.badges,
        errors: sharedEs.errors,
        // Web-only namespaces
        layout: es.layout,
        home: es.home,
        reports: es.reports,
        shelters: es.shelters,
        footer: es.footer,
        map: es.map,
        profile: es.profile,
        otp: es.otp,
      },
      en: {
        // Shared namespaces
        common: sharedEn.common,
        auth: sharedEn.auth,
        pets: sharedEn.pets,
        chat: sharedEn.chat,
        messages: sharedEn.messages,
        badges: sharedEn.badges,
        errors: sharedEn.errors,
        // Web-only namespaces
        layout: en.layout,
        home: en.home,
        reports: en.reports,
        shelters: en.shelters,
        footer: en.footer,
        map: en.map,
        profile: en.profile,
        otp: en.otp,
      },
      pt: {
        // Shared namespaces
        common: sharedPt.common,
        auth: sharedPt.auth,
        pets: sharedPt.pets,
        chat: sharedPt.chat,
        messages: sharedPt.messages,
        badges: sharedPt.badges,
        errors: sharedPt.errors,
        // Web-only namespaces
        layout: pt.layout,
        home: pt.home,
        reports: pt.reports,
        shelters: pt.shelters,
        footer: pt.footer,
        map: pt.map,
        profile: pt.profile,
        otp: pt.otp,
      },
    },
    interpolation: {
      escapeValue: false,
    },
  });

export default i18n;
