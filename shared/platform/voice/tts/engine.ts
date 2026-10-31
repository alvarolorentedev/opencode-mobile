import { Platform } from 'react-native';

import { deleteLocalTtsFile, playLocalTtsFile } from '@/shared/platform/voice/tts/player';
import { getLocalTtsPack, isPackLanguageCompatible } from '@/shared/platform/voice/tts/catalog';
import { getLocalTtsPackStatus } from '@/shared/platform/voice/tts/models';
import { ensureLocalTtsRuntime, generateLocalTtsChunk, scheduleLocalTtsRelease } from '@/shared/platform/voice/tts/runtime';
import { LocalTtsUnavailableError } from '@/shared/platform/voice/tts/types';
type Generated = { filePath?: string; error?: Error };
const LOCAL_CHUNK_GAP_MS = 90;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function waitForGap(signal: AbortSignal) {
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
    }, LOCAL_CHUNK_GAP_MS);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Synthesize one chunk at a time and play the WAV through expo-audio. The first
 * chunk starts playback as soon as it is ready; the next chunk is generated
 * while the current one plays.
 */
export function speakLocalText({
  chunks,
  language,
  onDone,
  onError,
  onStart,
  packId,
  rate,
  signal,
  speakerId,
}: {
  chunks: string[];
  language?: string;
  onDone: () => void;
  onError: (error: Error) => void;
  onStart: () => void;
  packId: string;
  rate?: number;
  signal: AbortSignal;
  speakerId: number;
}): Promise<boolean> {
  if (Platform.OS === 'web') {
    throw new LocalTtsUnavailableError('unsupported');
  }

  const pack = getLocalTtsPack(packId);
  if (!pack) {
    throw new LocalTtsUnavailableError('missing');
  }
  if (!isPackLanguageCompatible(pack, language)) {
    throw new LocalTtsUnavailableError('language-mismatch');
  }
  if (getLocalTtsPackStatus(pack.id) !== 'ready') {
    throw new LocalTtsUnavailableError('missing');
  }

  const started = deferred<boolean>();
  let didStart = false;
  let currentFile: string | undefined;
  let nextGeneration: Promise<Generated> | undefined;
  const prefetchedFiles = new Set<string>();

  const start = () => {
    if (didStart) {
      return;
    }
    didStart = true;
    onStart();
    started.resolve(true);
  };

  const generate = async (index: number): Promise<Generated> => {
    try {
      const filePath = await generateLocalTtsChunk(pack.id, chunks[index], speakerId, rate);
      prefetchedFiles.add(filePath);
      return { filePath };
    } catch (error) {
      return { error: error instanceof Error ? error : new Error('The on-device voice failed.') };
    }
  };

  void (async () => {
    try {
      await ensureLocalTtsRuntime(pack.id);
      if (signal.aborted) {
        started.resolve(false);
        return;
      }

      const first = await generate(0);
      if (signal.aborted) {
        if (first.filePath) {
          deleteLocalTtsFile(first.filePath);
        }
        started.resolve(false);
        return;
      }
      if (!first.filePath) {
        throw new LocalTtsUnavailableError('init-failed', first.error?.message);
      }

      currentFile = first.filePath;
      if (chunks.length > 1) {
        nextGeneration = generate(1);
      }

      for (let index = 0; index < chunks.length; index += 1) {
        if (signal.aborted) {
          return;
        }
        const file = currentFile;
        if (!file) {
          throw new Error('The on-device voice produced no audio.');
        }

        await playLocalTtsFile(file, signal, index === 0 ? start : undefined);
        prefetchedFiles.delete(file);
        deleteLocalTtsFile(file);
        currentFile = undefined;

        if (signal.aborted) {
          return;
        }
        if (index + 1 >= chunks.length) {
          break;
        }

        await waitForGap(signal);
        if (signal.aborted) {
          return;
        }

        const next = await nextGeneration;
        nextGeneration = undefined;
        if (!next?.filePath) {
          throw next?.error ?? new Error('The on-device voice failed.');
        }
        currentFile = next.filePath;
        if (index + 2 < chunks.length) {
          nextGeneration = generate(index + 2);
        }
      }

      if (!didStart) {
        start();
      }
      onDone();
    } catch (error) {
      const failure = error instanceof Error ? error : new Error('The on-device voice failed.');
      if (!didStart) {
        started.reject(failure instanceof LocalTtsUnavailableError
          ? failure
          : new LocalTtsUnavailableError('init-failed', failure.message));
      } else if (!signal.aborted) {
        onError(failure);
      }
    } finally {
      if (!didStart) {
        started.resolve(false);
      }
      if (currentFile) {
        prefetchedFiles.delete(currentFile);
        deleteLocalTtsFile(currentFile);
      }
      // A prefetched chunk may finish after an abort; remove it when it lands.
      void nextGeneration?.then((result) => {
        if (result.filePath) {
          prefetchedFiles.delete(result.filePath);
          deleteLocalTtsFile(result.filePath);
        }
      });
      for (const file of prefetchedFiles) {
        deleteLocalTtsFile(file);
      }
      prefetchedFiles.clear();
      scheduleLocalTtsRelease();
    }
  })();

  return started.promise;
}
