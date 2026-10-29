import { AppState } from 'react-native';
import { initLlama, type LlamaContext } from 'llama.rn';

import {
  AUTO_MODEL_CLASSIFIER_GRAMMAR,
  AUTO_MODEL_MAX_PROMPT_CHARS,
  AUTO_MODEL_OUTPUT_TOKENS,
  buildAutoModelClassifierInput,
  parseAutoModelTier,
  type AutoModelClassifierInput,
} from './classifier-prompt';
import { getLocalAutoModelPath } from './models';

const IDLE_RELEASE_MS = 5 * 60_000;
const LOAD_TIMEOUT_MS = 8_000;
const COMPLETION_TIMEOUT_MS = 2_500;

let context: LlamaContext | undefined;
let loadPromise: Promise<LlamaContext> | undefined;
let idleTimer: ReturnType<typeof setTimeout> | undefined;
let appStateSubscribed = false;
let runtimeGeneration = 0;

function clearIdleTimer() {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = undefined;
  }
}

function scheduleIdleRelease() {
  clearIdleTimer();
  idleTimer = setTimeout(() => {
    void releaseLocalAutoModelRuntime();
  }, IDLE_RELEASE_MS);
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | undefined> {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve(undefined);
      }
    }, timeoutMs);

    promise.then(
      (value) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(value);
        }
      },
      () => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(undefined);
        }
      },
    );
  });
}

function subscribeAppState() {
  if (appStateSubscribed) {
    return;
  }
  appStateSubscribed = true;
  AppState.addEventListener('change', (state) => {
    if (state !== 'active') {
      void releaseLocalAutoModelRuntime();
    }
  });
}

async function loadContext(): Promise<LlamaContext> {
  if (context) {
    return context;
  }
  if (loadPromise) {
    return loadPromise;
  }

  const modelPath = getLocalAutoModelPath();
  if (!modelPath) {
    throw new Error('The on-device classifier model is not installed.');
  }

  subscribeAppState();
  const generation = runtimeGeneration;
  loadPromise = initLlama({
    model: modelPath,
    n_ctx: 2_048,
    n_batch: 256,
    n_threads: 4,
    n_gpu_layers: 0,
    use_mlock: false,
  }).then((loaded) => {
    if (generation !== runtimeGeneration) {
      void loaded.release().catch(() => undefined);
      throw new Error('The on-device classifier was released while loading.');
    }
    context = loaded;
    return loaded;
  }).finally(() => {
    if (generation === runtimeGeneration) {
      loadPromise = undefined;
    }
  });

  return loadPromise;
}

export async function classifyPromptWithLocalModel(input: AutoModelClassifierInput): Promise<ReturnType<typeof parseAutoModelTier>> {
  if (!input.prompt.trim() || input.prompt.length > AUTO_MODEL_MAX_PROMPT_CHARS) {
    return undefined;
  }

  const loaded = await withTimeout(loadContext(), LOAD_TIMEOUT_MS);
  if (!loaded) {
    return undefined;
  }

  scheduleIdleRelease();
  const { system, user } = buildAutoModelClassifierInput(input);
  const completion = loaded.completion({
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    grammar: AUTO_MODEL_CLASSIFIER_GRAMMAR,
    n_predict: AUTO_MODEL_OUTPUT_TOKENS,
    temperature: 0,
    top_k: 1,
  });
  const result = await withTimeout(completion, COMPLETION_TIMEOUT_MS);
  if (!result) {
    void loaded.stopCompletion().catch(() => undefined);
    return undefined;
  }

  scheduleIdleRelease();
  return parseAutoModelTier(result.text);
}

export async function releaseLocalAutoModelRuntime(): Promise<void> {
  clearIdleTimer();
  runtimeGeneration += 1;
  const current = context;
  context = undefined;
  loadPromise = undefined;
  if (current) {
    await current.stopCompletion().catch(() => undefined);
    await current.release().catch(() => undefined);
  }
}

export function isLocalAutoModelRuntimeSupported() {
  return true;
}
