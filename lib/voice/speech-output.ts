import {
  activateVoiceDuckingAsync,
  deactivateVoiceDuckingAsync,
  initializeVoiceAudioAsync,
} from '@/lib/voice/audio-session';
import { prepareSpeechText } from '@/lib/voice/speech-text';
import type { SpeakTextOptions } from '@/lib/voice/speech-types';
import { LocalTtsUnavailableError } from '@/lib/voice/tts/types';
import {
  getSpeechVoiceOptions,
  speakSystemText,
  stopSystemSpeech,
} from '@/lib/voice/system-tts';

export type { SpeakTextOptions, SpeechFallbackReason, SpeechPlayback, SpeechVoiceOption } from '@/lib/voice/speech-types';
export { getSpeechVoiceOptions, initializeVoiceAudioAsync };

type ActiveRun = {
  id: number;
  controller: AbortController;
  cancel?: () => Promise<void>;
};

let runSequence = 0;
let activeRun: ActiveRun | undefined;

function stopCancel(cancel?: () => Promise<void>) {
  return cancel?.().catch(() => undefined);
}

/**
 * Speak one assistant reply. Both engines share this facade so manual play,
 * auto-play, conversation readback, and the voice check all have the same
 * completion, cancellation, and fallback behavior.
 */
export async function speakText({
  cues,
  language,
  onDone,
  onEngineFallback,
  onError,
  onStart,
  playback = { engine: 'system' },
  rate,
  text,
}: SpeakTextOptions): Promise<boolean> {
  const prepared = prepareSpeechText(text, {
    cues,
    language,
    maxChars: playback.engine === 'local' ? 220 : 450,
  });
  if (prepared.chunks.length === 0) {
    return false;
  }

  await initializeVoiceAudioAsync().catch(() => undefined);
  await stopSpeaking();
  await activateVoiceDuckingAsync().catch(() => undefined);

  const runId = ++runSequence;
  const controller = new AbortController();
  let settled = false;
  let started = false;

  const finish = (error?: Error) => {
    if (settled || runId !== runSequence) {
      return;
    }
    settled = true;
    if (activeRun?.id === runId) {
      activeRun = undefined;
    }
    void deactivateVoiceDuckingAsync().catch(() => undefined);
    if (error) {
      onError?.(error);
    } else {
      onDone?.();
    }
  };

  const handleStart = () => {
    if (settled || runId !== runSequence || started) {
      return;
    }
    started = true;
    onStart?.();
  };

  const run: ActiveRun = { id: runId, controller };
  activeRun = run;

  if (playback.engine === 'local') {
    try {
      const [{ speakLocalText }, { stopLocalTtsGeneration }] = await Promise.all([
        import('@/lib/voice/tts/engine'),
        import('@/lib/voice/tts/runtime'),
      ]);
      run.cancel = async () => {
        await stopLocalTtsGeneration();
      };

      const localStarted = await speakLocalText({
        chunks: prepared.chunks,
        language,
        onDone: () => finish(),
        onError: (error) => finish(error),
        onStart: handleStart,
        packId: playback.packId,
        rate,
        signal: controller.signal,
        speakerId: playback.speakerId,
      });

      if (runId !== runSequence || controller.signal.aborted) {
        return true;
      }
      return localStarted;
    } catch (error) {
      if (runId !== runSequence || controller.signal.aborted) {
        return true;
      }
      if (error instanceof LocalTtsUnavailableError) {
        try {
          onEngineFallback?.(error.reason);
        } catch {
          // Feedback must never prevent the system fallback.
        }
      } else {
        try {
          onEngineFallback?.('init-failed');
        } catch {
          // Feedback must never prevent the system fallback.
        }
      }
    }
  }

  try {
    const started = await speakSystemText({
      chunks: prepared.chunks,
      language,
      onDone: () => finish(),
      onError: (error) => finish(error),
      onStart: handleStart,
      rate,
      signal: controller.signal,
      voice: playback.engine === 'system' ? playback.voice : undefined,
    });
    if (controller.signal.aborted) {
      return true;
    }
    return started;
  } catch (error) {
    if (controller.signal.aborted) {
      return true;
    }
    finish(error instanceof Error ? error : new Error('Speech playback failed.'));
    return false;
  }
}

export async function stopSpeaking() {
  const run = activeRun;
  activeRun = undefined;
  runSequence += 1;
  run?.controller.abort();
  await stopCancel(run?.cancel);
  await stopSystemSpeech();
  await deactivateVoiceDuckingAsync().catch(() => undefined);
}
