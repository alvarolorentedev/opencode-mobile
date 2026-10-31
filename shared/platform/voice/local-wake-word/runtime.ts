import { getLocalCommandModelPaths, getLocalVoiceBasePaths, validateLocalVoiceKeywords, writeLocalVoiceKeywords, type LocalVoiceBasePaths } from '@/shared/platform/voice/local-wake-word/models';
import { getLocalCommandModel } from '@/shared/platform/voice/local-wake-word/model-constants';
import { loadSherpaRuntime } from '@/shared/platform/voice/local-wake-word/sherpa';
import { LOCAL_WAKE_PHRASES, type LocalCommandModelId, type LocalWakePhraseId, type SherpaRuntime } from '@/shared/platform/voice/local-wake-word/types';

const SAMPLE_RATE = 16000;

type LoadedRuntime = {
  sherpa: SherpaRuntime;
  basePaths: LocalVoiceBasePaths;
};

let runtimePromise: Promise<LoadedRuntime | undefined> | undefined;
let kwsPhrase: LocalWakePhraseId | undefined;
let asrModel: LocalCommandModelId | undefined;
let speakerReady = false;
let vadReady = false;
let asrReady = false;
let speakerInitPromise: Promise<void> | undefined;
let kwsInitPromise: { phrase: LocalWakePhraseId; promise: Promise<void> } | undefined;
let commandInitPromise: Promise<void> | undefined;
let kwsQueue = Promise.resolve();
let speakerQueue = Promise.resolve();
let vadQueue = Promise.resolve();
let asrQueue = Promise.resolve();

async function loadRuntime(): Promise<LoadedRuntime | undefined> {
  const sherpa = loadSherpaRuntime();
  if (!sherpa) {
    return undefined;
  }
  const basePaths = getLocalVoiceBasePaths();
  if (!basePaths) {
    return undefined;
  }
  return { sherpa, basePaths };
}

async function getRuntime(): Promise<LoadedRuntime> {
  if (!runtimePromise) {
    runtimePromise = loadRuntime();
  }
  const runtime = await runtimePromise;
  if (!runtime) {
    // A previous attempt may have run before models were installed. Do not cache
    // the unavailable result forever.
    runtimePromise = undefined;
    throw new Error('On-device voice models are not installed.');
  }
  return runtime;
}

async function ensureSpeaker(runtime: LoadedRuntime) {
  if (speakerReady) {
    return;
  }
  if (!speakerInitPromise) {
    speakerInitPromise = (async () => {
      const initialized = await runtime.sherpa.SpeakerId.init({
        modelDir: runtime.basePaths.speakerModelDir,
        modelFile: runtime.basePaths.speakerModelFile,
        sampleRate: SAMPLE_RATE,
        numThreads: 1,
        provider: 'cpu',
      });
      if (!initialized.success) {
        throw new Error(initialized.error || 'Could not load the speaker model.');
      }
      speakerReady = true;
    })().catch((error) => {
      speakerInitPromise = undefined;
      throw error;
    });
  }
  await speakerInitPromise;
}

async function ensureKws(runtime: LoadedRuntime, phrase: LocalWakePhraseId) {
  const missing = await validateLocalVoiceKeywords(phrase);
  if (missing.length > 0) {
    throw new Error(`The wake phrase tokens are not in the installed model: ${missing.join(', ')}.`);
  }
  writeLocalVoiceKeywords(phrase);
  if (kwsPhrase === phrase) {
    return;
  }
  if (kwsInitPromise?.phrase === phrase) {
    await kwsInitPromise.promise;
    return;
  }
  const keyword = LOCAL_WAKE_PHRASES[phrase];
  const promise = (async () => {
    if (kwsPhrase) {
      await runtime.sherpa.KWS.release().catch(() => undefined);
    }
    const initialized = await runtime.sherpa.KWS.init({
      modelDir: runtime.basePaths.kwsModelDir,
      modelType: 'zipformer2',
      modelFiles: {
        encoder: runtime.basePaths.kwsEncoder,
        decoder: runtime.basePaths.kwsDecoder,
        joiner: runtime.basePaths.kwsJoiner,
        tokens: runtime.basePaths.kwsTokens,
      },
      keywordsFile: runtime.basePaths.kwsKeywords,
      maxActivePaths: 4,
      // Upstream defaults. The per-keyword file also carries these values so a
      // future phrase-specific sweep can tune each phrase independently.
      keywordsScore: keyword.score,
      keywordsThreshold: keyword.threshold,
      numTrailingBlanks: 1,
      numThreads: 2,
    });
    if (!initialized.success) {
      throw new Error(initialized.error || 'Could not load the wake-word model.');
    }
    kwsPhrase = phrase;
  })();
  kwsInitPromise = { phrase, promise };
  try {
    await promise;
  } finally {
    if (kwsInitPromise?.promise === promise) {
      kwsInitPromise = undefined;
    }
  }
}

// Wake-path models only. The much larger command ASR is loaded separately so
// the microphone can start listening before the command model is resident.
export async function ensureLocalVoiceRuntime(
  phrase: LocalWakePhraseId,
  options: { verifySpeaker?: boolean } = {},
): Promise<LoadedRuntime> {
  const runtime = await getRuntime();
  // Speaker verification is optional. A missing/corrupt speaker model must not
  // prevent the wake detector from running when the user turned it off.
  if (options.verifySpeaker !== false) {
    await ensureSpeaker(runtime);
  }
  await ensureKws(runtime, phrase);
  return runtime;
}

export async function ensureLocalSpeakerRuntime(): Promise<LoadedRuntime> {
  const runtime = await getRuntime();
  await ensureSpeaker(runtime);
  return runtime;
}

export async function ensureLocalCommandRuntime(
  phrase: LocalWakePhraseId,
  modelId: LocalCommandModelId,
  language?: string,
  options: { verifySpeaker?: boolean } = {},
): Promise<LoadedRuntime> {
  const runtime = await ensureLocalVoiceRuntime(phrase, options);
  const commandPaths = getLocalCommandModelPaths(modelId);
  if (!commandPaths) {
    throw new Error('The selected command-recognition model is not installed.');
  }
  const model = getLocalCommandModel(modelId);

  if (asrModel && asrModel !== modelId) {
    await runtime.sherpa.ASR.release().catch(() => undefined);
    asrReady = false;
    asrModel = undefined;
    commandInitPromise = undefined;
  }

  if (vadReady && asrReady && asrModel === modelId) {
    return runtime;
  }
  if (!commandInitPromise) {
    commandInitPromise = (async () => {
      if (!vadReady) {
        const initialized = await runtime.sherpa.VAD.init({
          modelDir: runtime.basePaths.vadModelDir,
          modelFile: runtime.basePaths.vadModelFile,
          threshold: 0.5,
          minSilenceDuration: 0.4,
          minSpeechDuration: 0.25,
          maxSpeechDuration: 12,
          bufferSizeInSeconds: 30,
          numThreads: 1,
          provider: 'cpu',
        });
        if (!initialized.success) {
          throw new Error(initialized.error || 'Could not load the voice-activity model.');
        }
        vadReady = true;
      }

      if (!asrReady || asrModel !== modelId) {
        if (asrReady) {
          await runtime.sherpa.ASR.release().catch(() => undefined);
          asrReady = false;
          asrModel = undefined;
        }
        const initialized = await runtime.sherpa.ASR.initialize({
          modelDir: commandPaths.asrModelDir,
          modelType: model.modelType,
          streaming: false,
          numThreads: 2,
          decodingMethod: 'greedy_search',
          ...(model.modelType === 'whisper'
            ? { language: language || undefined, task: 'transcribe' as const }
            : {}),
          modelFiles: {
            preprocessor: commandPaths.asrPreprocess,
            encoder: commandPaths.asrEncoder || undefined,
            decoder: commandPaths.asrDecoder,
            uncachedDecoder: commandPaths.asrUncachedDecoder,
            cachedDecoder: commandPaths.asrCachedDecoder,
            tokens: commandPaths.asrTokens,
          },
        });
        if (!initialized.success) {
          throw new Error(initialized.error || 'Could not load the command-recognition model.');
        }
        asrReady = true;
        asrModel = modelId;
      }
    })().catch((error) => {
      commandInitPromise = undefined;
      throw error;
    });
  }
  await commandInitPromise;
  return runtime;
}

function enqueue(queue: Promise<unknown>, task: () => Promise<void>): Promise<void> {
  const next = queue.then(task, task);
  return next.then(() => undefined, () => undefined);
}

export function resetWakeWordStream(): Promise<void> {
  // Reset is deliberately best-effort so a failed reset cannot strand a turn.
  return enqueue(kwsQueue, async () => {
    const loaded = await runtimePromise;
    await loaded?.sherpa.KWS.resetStream().catch(() => undefined);
  });
}

export async function acceptWakeWordSamples(samples: Float32Array): Promise<{
  success: boolean;
  detected: boolean;
  keyword: string;
  error?: string;
}> {
  const task = kwsQueue.then(async () => {
    const loaded = await runtimePromise;
    if (!loaded) {
      return { success: false, detected: false, keyword: '', error: 'Wake-word runtime is not loaded.' };
    }
    return loaded.sherpa.KWS.acceptWaveform(SAMPLE_RATE, Array.from(samples));
  });
  kwsQueue = task.then(() => undefined, () => undefined);
  return task;
}

export async function computeLocalSpeakerEmbedding(samples: Float32Array): Promise<number[] | undefined> {
  const task = speakerQueue.then(async () => {
    const loaded = await runtimePromise;
    if (!loaded) {
      return undefined;
    }
    const { SpeakerId } = loaded.sherpa;
    await SpeakerId.resetStream().catch(() => undefined);
    const processed = await SpeakerId.processSamples(SAMPLE_RATE, Array.from(samples));
    if (!processed.success) {
      return undefined;
    }
    const embedding = await SpeakerId.computeEmbedding();
    return embedding.success && embedding.embedding.length > 0 ? embedding.embedding : undefined;
  });
  speakerQueue = task.then(() => undefined, () => undefined);
  return task;
}

export async function acceptVadSamples(samples: Float32Array): Promise<{
  success: boolean;
  isSpeechDetected: boolean;
  segments: { start: number; duration: number; startTime: number; endTime: number }[];
  error?: string;
}> {
  const task = vadQueue.then(async () => {
    const loaded = await runtimePromise;
    if (!loaded) {
      return { success: false, isSpeechDetected: false, segments: [], error: 'VAD runtime is not loaded.' };
    }
    return loaded.sherpa.VAD.acceptWaveform(SAMPLE_RATE, Array.from(samples));
  });
  vadQueue = task.then(() => undefined, () => undefined);
  return task;
}

export async function resetVad(): Promise<void> {
  await enqueue(vadQueue, async () => {
    const loaded = await runtimePromise;
    await loaded?.sherpa.VAD.reset().catch(() => undefined);
  });
}

export async function recognizeLocalCommand(samples: Float32Array): Promise<string | undefined> {
  const task = asrQueue.then(async () => {
    const loaded = await runtimePromise;
    if (!loaded) {
      return undefined;
    }
    const result = await loaded.sherpa.ASR.recognizeFromSamples(SAMPLE_RATE, Array.from(samples));
    const text = result.success ? result.text?.trim() : '';
    return text || undefined;
  });
  asrQueue = task.then(() => undefined, () => undefined);
  return task;
}

export async function releaseLocalVoiceRuntime(): Promise<void> {
  // Drain queued native calls before releasing the models. Releasing while a
  // KWS/VAD/ASR call is in flight can surface as a native use-after-free.
  await Promise.all([kwsQueue, speakerQueue, vadQueue, asrQueue].map((queue) => queue.catch(() => undefined)));
  const loaded = await runtimePromise?.catch(() => undefined);
  kwsPhrase = undefined;
  asrModel = undefined;
  speakerReady = false;
  vadReady = false;
  asrReady = false;
  speakerInitPromise = undefined;
  kwsInitPromise = undefined;
  commandInitPromise = undefined;
  if (loaded) {
    await loaded.sherpa.KWS.release().catch(() => undefined);
    await loaded.sherpa.SpeakerId.release().catch(() => undefined);
    await loaded.sherpa.VAD.release().catch(() => undefined);
    await loaded.sherpa.ASR.release().catch(() => undefined);
  }
  runtimePromise = undefined;
}
