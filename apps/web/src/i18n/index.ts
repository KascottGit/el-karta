import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import sv from './sv.json';

export const defaultNS = 'translation';
export const resources = { sv: { translation: sv } } as const;

void i18n.use(initReactI18next).init({
  resources,
  lng: 'sv',
  fallbackLng: 'sv',
  interpolation: { escapeValue: false },
});

export default i18n;
