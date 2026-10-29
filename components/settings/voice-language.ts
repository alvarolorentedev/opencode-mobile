import type { TFunction } from 'i18next';
import { SUPPORTED_LANGUAGES } from '@/lib/i18n/languages';

export function voiceLanguageOptions(t: TFunction, locale?: string) {
  const options = [{ value: '', label: t('settings:voice.setup.followSystem') }, ...SUPPORTED_LANGUAGES.map((language) => ({ value: language.code, label: language.nativeName }))];
  if (locale && !options.some((option) => option.value === locale)) options.push({ value: locale, label: locale });
  return options;
}
