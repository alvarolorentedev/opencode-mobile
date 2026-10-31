import { TurboModuleRegistry } from 'react-native';

import { getLocalTtsPack } from '@/shared/platform/voice/tts/catalog';
import { getLocalTtsPackPaths } from '@/shared/platform/voice/tts/models';
import { LocalTtsUnavailableError, type LocalTtsPackId } from '@/shared/platform/voice/tts/types';

const IDLE_RELEASE_MS = 180000;

// The vendored JS service and the native bridges disagree on config keys:
// Android reads `ttsModelType`/`voicesFile`/`lexiconFile`, while the iOS bridge
// exposes `modelType`/`voices`/`lexicon`. Calling the native module directly
// with both aliases keeps Piper and Kokoro working on either platform.
type NativeTtsModule = {
  initTts(config: {
    modelDir: string;
    modelType: string;
    ttsModelType: string;
    modelFile: string;
    tokensFile: string;
    voices?: string;
    voicesFile?: string;
    lexicon?: string;
    lexiconFile?: string;
    dataDir?: string;
    lang?: string;
    maxNumSentences?: number;
    numThreads?: number;
    provider?: 'cpu' | 'gpu';
  }): Promise<{ success: boolean; sampleRate: number; numSpeakers: number; error?: string }>;
  generateTts(config: {
    text: string;
    speakerId: number;
    speakingRate: number;
    playAudio: boolean;
    fileNamePrefix?: string;
  }): Promise<{ success: boolean; filePath?: string }>;
  stopTts(): Promise<{ stopped: boolean; message?: string }>;
  releaseTts(): Promise<{ released: boolean }>;
};

type LoadedTts = {
  packId: LocalTtsPackId;
  native: NativeTtsModule;
  sampleRate: number;
  numSpeakers: number;
};

let loaded: LoadedTts | undefined;
let initPromise: { packId: LocalTtsPackId; promise: Promise<LoadedTts> } | undefined;
let generationQueue = Promise.resolve();
let releaseTimer: ReturnType<typeof setTimeout> | undefined;

function getNativeTtsModule(): NativeTtsModule | undefined {
  try {
    return (TurboModuleRegistry.get('SherpaOnnx') as unknown as NativeTtsModule | null) ?? undefined;
  } catch {
    return undefined;
  }
}

// The native config expects plain filesystem paths. Expo's Directory/File URIs
// carry a file:// prefix that the Android handler strips but the iOS bridge
// does not.
function nativePath(path: string) {
  if (path.startsWith('file://')) {
    return path.slice(7);
  }
  if (path.startsWith('file:/')) {
    return path.slice(6);
  }
  return path;
}

function clearReleaseTimer() {
  if (releaseTimer) {
    clearTimeout(releaseTimer);
    releaseTimer = undefined;
  }
}

function scheduleRelease() {
  clearReleaseTimer();
  releaseTimer = setTimeout(() => {
    releaseTimer = undefined;
    void releaseLocalTtsRuntime().catch(() => undefined);
  }, IDLE_RELEASE_MS);
}

async function initialize(packId: LocalTtsPackId): Promise<LoadedTts> {
  const native = getNativeTtsModule();
  if (!native) {
    throw new LocalTtsUnavailableError('unsupported');
  }
  const pack = getLocalTtsPack(packId);
  if (!pack) {
    throw new LocalTtsUnavailableError('missing');
  }
  const paths = getLocalTtsPackPaths(packId);
  if (!paths) {
    throw new LocalTtsUnavailableError('missing');
  }

  if (loaded?.packId === packId) {
    return loaded;
  }

  if (loaded) {
    await loaded.native.releaseTts().catch(() => undefined);
    loaded = undefined;
  }

  const initialized = await native.initTts({
    modelDir: nativePath(paths.modelDir),
    modelType: pack.modelType,
    ttsModelType: pack.modelType,
    modelFile: paths.modelFile,
    tokensFile: paths.tokensFile,
    ...(paths.dataDir ? { dataDir: nativePath(paths.dataDir) } : {}),
    ...(paths.lexiconFile ? { lexicon: paths.lexiconFile, lexiconFile: paths.lexiconFile } : {}),
    ...(paths.voicesFile ? { voices: paths.voicesFile, voicesFile: paths.voicesFile } : {}),
    lang: pack.modelType === 'kokoro' ? 'en' : pack.languageCode,
    maxNumSentences: 1,
    numThreads: 2,
    provider: 'cpu',
  });

  if (!initialized.success) {
    throw new LocalTtsUnavailableError('init-failed', initialized.error || 'Could not load the on-device voice.');
  }

  const next = {
    packId,
    native,
    sampleRate: initialized.sampleRate,
    numSpeakers: initialized.numSpeakers,
  };
  loaded = next;
  return next;
}

export async function ensureLocalTtsRuntime(packId: LocalTtsPackId) {
  clearReleaseTimer();
  if (loaded?.packId === packId) {
    return loaded;
  }
  if (initPromise?.packId === packId) {
    return initPromise.promise;
  }
  if (initPromise) {
    await initPromise.promise.catch(() => undefined);
  }

  const promise = initialize(packId).catch((error) => {
    initPromise = undefined;
    throw error;
  });
  initPromise = { packId, promise };
  try {
    return await promise;
  } finally {
    if (initPromise?.promise === promise) {
      initPromise = undefined;
    }
  }
}

export async function generateLocalTtsChunk(
  packId: LocalTtsPackId,
  text: string,
  speakerId: number,
  rate?: number,
): Promise<string> {
  const task = generationQueue.then(async () => {
    const runtime = await ensureLocalTtsRuntime(packId);
    const clampedSpeaker = Math.max(0, Math.min(runtime.numSpeakers - 1, Math.trunc(speakerId)));
    const result = await runtime.native.generateTts({
      fileNamePrefix: `opencode-tts-${packId}`,
      playAudio: false,
      speakingRate: rate ?? 1,
      speakerId: clampedSpeaker,
      text,
    });
    if (!result.success || !result.filePath) {
      throw new Error('The on-device voice could not synthesize this reply.');
    }
    clearReleaseTimer();
    return result.filePath;
  });

  generationQueue = task.then(() => undefined, () => undefined);
  return task;
}

export async function stopLocalTtsGeneration() {
  const runtime = loaded?.native;
  if (runtime) {
    await runtime.stopTts().catch(() => undefined);
  }
}

export async function releaseLocalTtsRuntime() {
  clearReleaseTimer();
  const current = loaded;
  loaded = undefined;
  initPromise = undefined;
  if (current) {
    await current.native.stopTts().catch(() => undefined);
    await current.native.releaseTts().catch(() => undefined);
  }
}

export function prewarmLocalTts(packId: string) {
  const pack = getLocalTtsPack(packId);
  if (pack) {
    void ensureLocalTtsRuntime(pack.id)
      .then(() => scheduleRelease())
      .catch(() => undefined);
  }
}

export function scheduleLocalTtsRelease() {
  scheduleRelease();
}
