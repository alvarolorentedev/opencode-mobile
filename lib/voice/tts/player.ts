import { Directory, File, Paths } from 'expo-file-system';

let audioModulePromise: Promise<typeof import('expo-audio') | null> | null = null;

async function getAudioModuleAsync() {
  if (!audioModulePromise) {
    audioModulePromise = import('expo-audio')
      .then((module) => module)
      .catch(() => null);
  }
  return audioModulePromise;
}

function toFileUri(filePath: string) {
  return filePath.startsWith('file://') ? filePath : `file://${filePath}`;
}

export async function playLocalTtsFile(
  filePath: string,
  signal: AbortSignal,
  onStarted?: () => void,
) {
  if (signal.aborted) {
    return;
  }
  const audioModule = await getAudioModuleAsync();
  if (!audioModule) {
    throw new Error('Audio playback is unavailable.');
  }
  if (signal.aborted) {
    return;
  }

  const player = audioModule.createAudioPlayer({ uri: toFileUri(filePath) }, { updateInterval: 100 });
  let settled = false;
  let started = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let subscription: { remove: () => void } | undefined;

  const cleanup = () => {
    if (timer) {
      clearTimeout(timer);
      timer = undefined;
    }
    subscription?.remove();
    subscription = undefined;
    try {
      player.remove();
    } catch {
      // The native player may already be gone after an interruption.
    }
  };

  const armWatchdog = (durationSeconds?: number) => {
    if (timer) {
      clearTimeout(timer);
    }
    const durationMs = durationSeconds && Number.isFinite(durationSeconds) && durationSeconds > 0
      ? durationSeconds * 1000 + 3000
      : 12000;
    timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        cleanup();
        rejectPlayback(new Error('Speech playback timed out.'));
      }
    }, Math.min(300000, Math.max(3000, durationMs)));
  };

  let resolvePlayback!: () => void;
  let rejectPlayback!: (error: Error) => void;
  const promise = new Promise<void>((resolve, reject) => {
    resolvePlayback = resolve;
    rejectPlayback = reject;
  });

  const finish = () => {
    if (settled) {
      return;
    }
    settled = true;
    cleanup();
    resolvePlayback();
  };

  const abort = () => {
    if (settled) {
      return;
    }
    settled = true;
    try {
      player.pause();
    } catch {
      // best effort
    }
    cleanup();
    resolvePlayback();
  };

  signal.addEventListener('abort', abort, { once: true });
  armWatchdog();

  try {
    subscription = (player as unknown as {
      addListener: (event: string, listener: (status: {
        didJustFinish: boolean;
        duration: number;
        playing: boolean;
      }) => void) => { remove: () => void };
    }).addListener('playbackStatusUpdate', (status) => {
      if (settled) {
        return;
      }
      if (status.duration > 0) {
        armWatchdog(status.duration);
      }
      if (status.playing && !started) {
        started = true;
        onStarted?.();
      }
      if (status.didJustFinish) {
        finish();
      }
    });
    player.play();
    if (!started) {
      started = true;
      onStarted?.();
    }
  } catch (error) {
    settled = true;
    cleanup();
    signal.removeEventListener('abort', abort);
    rejectPlayback(error instanceof Error ? error : new Error('Could not play the on-device voice.'));
    return promise;
  }

  try {
    await promise;
  } finally {
    signal.removeEventListener('abort', abort);
  }
}

export function deleteLocalTtsFile(filePath: string) {
  try {
    const file = new File(toFileUri(filePath));
    if (file.exists) {
      file.delete();
    }
  } catch {
    // Cache cleanup is best effort.
  }
}

export async function cleanupLocalTtsAudioCache() {
  try {
    const cache = new Directory(Paths.cache);
    if (!cache.exists) {
      return;
    }
    for (const entry of cache.list()) {
      if (entry instanceof File && entry.name.startsWith('opencode-tts-')) {
        entry.delete();
      }
    }
  } catch {
    // Cache cleanup is best effort.
  }
}
