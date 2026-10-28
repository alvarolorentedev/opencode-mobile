import { loadSherpaRuntime } from '@/lib/voice/local-wake-word/sherpa';
import type { TtsService } from '@/lib/voice/local-wake-word/types';
import { getLocalTtsPack } from '@/lib/voice/tts/catalog';
import { getLocalTtsPackPaths } from '@/lib/voice/tts/models';
import { LocalTtsUnavailableError, type LocalTtsPackId } from '@/lib/voice/tts/types';

const IDLE_RELEASE_MS = 180000;

type LoadedTts = {
  packId: LocalTtsPackId;
  service: TtsService;
  sampleRate: number;
  numSpeakers: number;
};

let loaded: LoadedTts | undefined;
let initPromise: { packId: LocalTtsPackId; promise: Promise<LoadedTts> } | undefined;
let generationQueue = Promise.resolve();
let releaseTimer: ReturnType<typeof setTimeout> | undefined;

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
  const runtime = loadSherpaRuntime();
  if (!runtime?.TTS) {
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

  if (loaded?.packId === packId && loaded.service.isInitialized()) {
    return loaded;
  }

  if (loaded) {
    await loaded.service.release().catch(() => undefined);
    loaded = undefined;
  }

  const initialized = await runtime.TTS.initialize({
    modelDir: paths.modelDir,
    ttsModelType: pack.modelType,
    modelFile: paths.modelFile,
    tokensFile: paths.tokensFile,
    ...(paths.dataDir ? { dataDir: paths.dataDir } : {}),
    ...(paths.lexiconFile ? { lexiconFile: paths.lexiconFile } : {}),
    ...(paths.voicesFile ? { voicesFile: paths.voicesFile } : {}),
    ...(pack.modelType === 'kokoro' ? { lang: 'en' } : { lang: pack.languageCode }),
    maxNumSentences: 1,
    numThreads: 2,
    provider: 'cpu',
  });

  if (!initialized.success) {
    throw new LocalTtsUnavailableError('init-failed', initialized.error || 'Could not load the on-device voice.');
  }

  const next = {
    packId,
    service: runtime.TTS,
    sampleRate: initialized.sampleRate,
    numSpeakers: initialized.numSpeakers,
  };
  loaded = next;
  return next;
}

export async function ensureLocalTtsRuntime(packId: LocalTtsPackId) {
  clearReleaseTimer();
  if (loaded?.packId === packId && loaded.service.isInitialized()) {
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
    const result = await runtime.service.generateSpeech(text, {
      fileNamePrefix: `opencode-tts-${packId}`,
      playAudio: false,
      speakingRate: rate ?? 1,
      speakerId: clampedSpeaker,
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
  const service = loaded?.service;
  if (service) {
    await service.stopSpeech().catch(() => undefined);
  }
}

export async function releaseLocalTtsRuntime() {
  clearReleaseTimer();
  const current = loaded;
  loaded = undefined;
  initPromise = undefined;
  if (current) {
    await current.service.stopSpeech().catch(() => undefined);
    await current.service.release().catch(() => undefined);
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
