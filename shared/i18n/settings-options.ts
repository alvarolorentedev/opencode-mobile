import { SUPPORTED_LANGUAGES } from '@/shared/i18n/languages';

export const LANGUAGE_OPTIONS: { value: string; label: string }[] = SUPPORTED_LANGUAGES.map((language) => ({ value: language.code, label: language.nativeName }));
