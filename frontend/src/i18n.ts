import i18n from 'i18next';
import HttpBackend from 'i18next-http-backend';
import LanguageDetector from 'i18next-browser-languagedetector';
import { initReactI18next } from 'react-i18next';
import { APP_VERSION } from './version';

i18n
  .use(HttpBackend)
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    fallbackLng: 'en',
    supportedLngs: ['en', 'ro'],
    defaultNS: 'translation',
    ns: ['translation'],
    debug: false,
    interpolation: {
      escapeValue: false,
    },
    backend: {
      // Version query busts the browser/service-worker cache so new or changed
      // strings load after an app update instead of serving a stale translation file.
      loadPath: `/locales/{{lng}}/translation.json?v=${APP_VERSION}`,
    },
    detection: {
      order: ['localStorage', 'navigator', 'htmlTag'],
      caches: ['localStorage'],
      lookupLocalStorage: 'soundwave_language',
    },
    react: {
      useSuspense: false,
    },
  });

export default i18n;
