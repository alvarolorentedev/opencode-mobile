// Pure language helpers. This module intentionally has no imports so it can be
// transpiled and exercised directly by tests/i18n.test.mjs.

export const DEFAULT_LANGUAGE = 'en';

export type SupportedLanguage = {
  code: string;
  nativeName: string;
};

// English is the source of truth and the base fallback. Every other entry needs
// a matching locales/<code>/ folder and a `supportedLocales` entry in
// app.config.ts.
export const SUPPORTED_LANGUAGES: SupportedLanguage[] = [
  { code: 'en', nativeName: 'English' },
  { code: 'ru', nativeName: 'Русский' },
  { code: 'es', nativeName: 'Español' },
  { code: 'hi', nativeName: 'हिन्दी' },
  { code: 'de', nativeName: 'Deutsch' },
  { code: 'fr', nativeName: 'Français' },
  { code: 'zh', nativeName: '中文' },
  { code: 'pt', nativeName: 'Português' },
  { code: 'ja', nativeName: '日本語' },
];

export const SUPPORTED_LANGUAGE_CODES = SUPPORTED_LANGUAGES.map((language) => language.code);

function findSupportedLanguage(value?: string) {
  if (!value) {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }

  return SUPPORTED_LANGUAGE_CODES.find((code) => code.toLowerCase() === normalized);
}

// A persisted preference wins when it is supported; otherwise fall back to the
// first supported device language tag (matching the full tag, then the base
// language), and finally to English.
export function resolveLanguage(preference: string | undefined, deviceLanguageTags: string[]): string {
  const preferred = findSupportedLanguage(preference);
  if (preferred) {
    return preferred;
  }

  for (const tag of deviceLanguageTags) {
    const normalized = (tag || '').trim().toLowerCase();
    if (!normalized) {
      continue;
    }

    const exact = findSupportedLanguage(normalized);
    if (exact) {
      return exact;
    }

    const base = normalized.split('-')[0];
    const baseMatch = findSupportedLanguage(base);
    if (baseMatch) {
      return baseMatch;
    }
  }

  return DEFAULT_LANGUAGE;
}
