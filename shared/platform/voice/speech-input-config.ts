import type { ExpoSpeechRecognitionResult } from 'expo-speech-recognition';
import { getLocales } from 'expo-localization';

/**
 * Resolve the recognizer locale. The empty preference means "follow the
 * system", matching the settings copy and the system-playback behavior.
 */
export function resolveSpeechInputLocale(locale?: string) {
  if (locale) {
    return locale;
  }
  try {
    return getLocales()[0]?.languageTag || 'en-US';
  } catch {
    return 'en-US';
  }
}

/** Non-empty transcripts in recognizer order; the first is the top hypothesis. */
export function resultTranscripts(results: readonly ExpoSpeechRecognitionResult[]) {
  return results.map((result) => result.transcript?.trim() ?? '').filter(Boolean);
}
