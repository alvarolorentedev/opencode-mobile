import { getLocales } from 'expo-localization';
import { createInstance } from 'i18next';
import { initReactI18next } from 'react-i18next';

import { resolveLanguage, SUPPORTED_LANGUAGE_CODES } from '@/lib/i18n/languages';
import { resources, TRANSLATION_NAMESPACES } from '@/lib/i18n/resources';


function getDeviceLanguageTags(): string[] {
  try {
    return getLocales()
      .map((locale) => locale.languageTag)
      .filter((tag): tag is string => Boolean(tag));
  } catch {
    return [];
  }
}

export const i18n = createInstance();

if (!i18n.isInitialized) {
  void i18n.use(initReactI18next).init({
    resources,
    lng: resolveLanguage(undefined, getDeviceLanguageTags()),
    fallbackLng: 'en',
    supportedLngs: SUPPORTED_LANGUAGE_CODES,
    nonExplicitSupportedLngs: true,
    load: 'languageOnly',
    ns: TRANSLATION_NAMESPACES,
    defaultNS: 'common',
    interpolation: { escapeValue: false },
    returnNull: false,
    // Resources are bundled, so initialize synchronously and never render keys
    // before the first translation is available.
    initAsync: false,
  });
}

// Locale-aware formatting helpers read the active language here, so a manual
// language switch is reflected without threading the locale through call sites.
export function getFormatLocale(): string {
  return i18n.resolvedLanguage || i18n.language || 'en';
}

// Applies the persisted preference (or the OS locale when unset). Called after
// persistence hydration and whenever the preference changes.
export function changeAppLanguage(preference?: string) {
  const next = resolveLanguage(preference, getDeviceLanguageTags());
  if ((i18n.resolvedLanguage || i18n.language) === next) {
    return;
  }
  void i18n.changeLanguage(next);
}
