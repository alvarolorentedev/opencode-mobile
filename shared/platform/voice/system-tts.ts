import * as Speech from 'expo-speech';

import { compareLabels } from '@/shared/utilities/compare-labels';
import type { SpeechVoiceOption } from '@/shared/platform/voice/speech-types';

type SpeechRecord = {
  finished: boolean;
  started: boolean;
  timer?: ReturnType<typeof setTimeout>;
};

const START_TIMEOUT_MS = 5000;
const MAX_DURATION_MS = 300000;
const CHUNK_GAP_MS = 140;

let voicesPromise: Promise<Speech.Voice[]> | undefined;

function getVoices() {
  if (!voicesPromise) {
    voicesPromise = Speech.getAvailableVoicesAsync().catch(() => {
      voicesPromise = undefined;
      return [];
    });
  }
  return voicesPromise;
}

function toQuality(value: unknown): 'default' | 'enhanced' {
  return String(value) === 'Enhanced' ? 'enhanced' : 'default';
}

function normalizedLanguage(value: string) {
  return value.toLowerCase().replace(/_/g, '-');
}

export async function getSpeechVoiceOptions(): Promise<SpeechVoiceOption[]> {
  const voices = await Speech.getAvailableVoicesAsync();
  voicesPromise = Promise.resolve(voices);

  return voices
    .map((voice) => ({
      id: voice.identifier,
      label: `${voice.name} (${voice.language})`,
      language: voice.language,
      quality: toQuality(voice.quality),
    }))
    .sort((left, right) => compareLabels(left.label, right.label));
}

/**
 * Pick a natural default for the requested language. An explicit voice wins
 * when it is still installed; otherwise prefer an enhanced voice in the same
 * locale before falling back to the OS default.
 */
export async function resolveSpeechVoice(voiceId?: string, language?: string) {
  const voices = await getVoices();
  const available = new Set(voices.map((voice) => voice.identifier));
  if (voiceId && available.has(voiceId)) {
    return voiceId;
  }
  if (!language) {
    return undefined;
  }

  const target = normalizedLanguage(language);
  const targetBase = target.split('-')[0];
  const matching = voices.filter((voice) => normalizedLanguage(voice.language).startsWith(targetBase));
  const exact = matching.filter((voice) => normalizedLanguage(voice.language) === target);
  const pool = exact.length ? exact : matching;
  pool.sort((left, right) => {
    const quality = Number(toQuality(right.quality) === 'enhanced') - Number(toQuality(left.quality) === 'enhanced');
    return quality || compareLabels(left.name, right.name);
  });

  return pool[0]?.identifier;
}

function estimateSpeechDurationMs(text: string, rate?: number) {
  const effectiveRate = Math.max(0.25, rate ?? 1);
  const base = text.length * 110 + 2500;
  return Math.min(MAX_DURATION_MS, Math.max(5000, Math.round(base / effectiveRate)));
}

function clearRecordTimer(record: SpeechRecord) {
  if (record.timer) {
    clearTimeout(record.timer);
    record.timer = undefined;
  }
}

function wait(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function speakChunk({
  language,
  onStart,
  rate,
  signal,
  text,
  voice,
}: {
  language?: string;
  onStart: () => void;
  rate?: number;
  signal: AbortSignal;
  text: string;
  voice?: string;
}) {
  return new Promise<{ ok: boolean; error?: Error }>((resolve) => {
    if (signal.aborted) {
      resolve({ ok: false });
      return;
    }

    const record: SpeechRecord = { finished: false, started: false };
    const finish = (error?: Error) => {
      if (record.finished) {
        return;
      }
      record.finished = true;
      clearRecordTimer(record);
      signal.removeEventListener('abort', handleAbort);
      if (error) {
        resolve({ ok: false, error });
      } else {
        resolve({ ok: true });
      }
    };
    const handleAbort = () => {
      void Speech.stop().catch(() => undefined);
      finish();
    };

    const armWatchdog = () => {
      clearRecordTimer(record);
      record.timer = setTimeout(() => {
        void Speech.stop().catch(() => undefined);
        finish(new Error('Speech playback timed out.'));
      }, record.started ? estimateSpeechDurationMs(text, rate) : START_TIMEOUT_MS);
    };

    signal.addEventListener('abort', handleAbort, { once: true });
    armWatchdog();

    try {
      Speech.speak(text, {
        language,
        onDone: () => finish(),
        onError: (error) => finish(error instanceof Error ? error : new Error('Speech playback failed.')),
        onStart: () => {
          if (record.started) {
            return;
          }
          record.started = true;
          armWatchdog();
          onStart();
        },
        onStopped: () => finish(),
        rate,
        voice,
      });
    } catch (error) {
      finish(error instanceof Error ? error : new Error('Speech playback failed.'));
    }
  });
}

export async function speakSystemText({
  chunks,
  language,
  onDone,
  onError,
  onStart,
  rate,
  signal,
  voice,
}: {
  chunks: string[];
  language?: string;
  onDone: () => void;
  onError: (error: Error) => void;
  onStart: () => void;
  rate?: number;
  signal: AbortSignal;
  voice?: string;
}) {
  if (signal.aborted || chunks.length === 0) {
    return false;
  }

  const resolvedVoice = await resolveSpeechVoice(voice, language);
  let started = false;

  for (let index = 0; index < chunks.length; index += 1) {
    if (signal.aborted) {
      return false;
    }

    const result = await speakChunk({
      language,
      onStart: () => {
        if (started) {
          return;
        }
        started = true;
        onStart();
      },
      rate,
      signal,
      text: chunks[index],
      voice: resolvedVoice,
    });

    if (signal.aborted) {
      return false;
    }
    if (!result.ok) {
      if (result.error) {
        onError(result.error);
      }
      return false;
    }

    if (index < chunks.length - 1) {
      await wait(CHUNK_GAP_MS, signal);
    }
  }

  if (signal.aborted) {
    return false;
  }

  if (!started) {
    onStart();
  }
  onDone();
  return true;
}

export async function stopSystemSpeech() {
  await Speech.stop().catch(() => undefined);
}
