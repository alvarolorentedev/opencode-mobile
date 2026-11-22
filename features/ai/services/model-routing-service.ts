import type { ScopedOpencodeClient } from '@/shared/protocol/opencode/client';
import { buildAutoModelClassifierPrompt, isAutoModelPromptWithinLimit, parseAutoModelTier } from '@/features/ai/model/auto-model/classifier-prompt';
import { type ModelComplexity } from '@/shared/preferences/auto-model';

export type ServerClassifierStatus = 'unknown' | 'checking' | 'available' | 'unsupported' | 'unavailable' | 'auth';

type ClassifierProbeResult = {
  status: Exclude<ServerClassifierStatus, 'unknown' | 'checking'>;
  cacheable: boolean;
};

export const CLASSIFIER_PROBE_STALE_MS = 5 * 60_000;
const PROBE_TIMEOUT_MS = 5_000;
const CLASSIFY_TIMEOUT_MS = 6_000;

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

function errorStatus(error: unknown) {
  if (!error || typeof error !== 'object') {
    return undefined;
  }
  const direct = (error as { status?: unknown }).status;
  if (typeof direct === 'number') {
    return direct;
  }
  const cause = (error as { cause?: unknown }).cause;
  if (cause && typeof cause === 'object' && typeof (cause as { status?: unknown }).status === 'number') {
    return (cause as { status: number }).status;
  }
  return undefined;
}

function probeStatusForError(error: unknown): Exclude<ServerClassifierStatus, 'unknown' | 'checking'> {
  const status = errorStatus(error);
  if (status === 404 || status === 405) {
    return 'unsupported';
  }
  if (status === 401 || status === 403) {
    return 'auth';
  }
  return 'unavailable';
}

export async function probeServerClassifier(input: {
  client: ScopedOpencodeClient;
  modelID: string;
  providerID: string;
}): Promise<ClassifierProbeResult> {
  const generate = input.client.api?.generate;
  if (!generate) return { status: 'unsupported', cacheable: true };

  const prompt = buildAutoModelClassifierPrompt({ prompt: 'What is 2 + 2?' });
  try {
    const result = await withTimeout(
      generate.text({
        prompt,
        model: { id: input.modelID, providerID: input.providerID },
      }),
      PROBE_TIMEOUT_MS,
    );
    const status = result && parseAutoModelTier(result.text) ? 'available' : 'unavailable';
    return { status, cacheable: true };
  } catch (error) {
    const status = probeStatusForError(error);
    // Only permanent/endpoint-level results are cached. Transient transport
    // failures should be retryable without waiting for a TTL.
    return { status, cacheable: status === 'unsupported' || status === 'auth' };
  }
}

export async function classifyPromptWithServer(input: {
  client: ScopedOpencodeClient;
  modelID: string;
  providerID: string;
  prompt: string;
  sessionTitle?: string;
  contextTokens?: number;
  attachments?: { mime?: string; filename?: string }[];
}): Promise<ModelComplexity | undefined> {
  if (!isAutoModelPromptWithinLimit(input.prompt)) {
    return undefined;
  }
  const generate = input.client.api?.generate;
  if (!generate) {
    return undefined;
  }

  const prompt = buildAutoModelClassifierPrompt(input);
  try {
    const result = await withTimeout(
      generate.text({
        prompt,
        model: { id: input.modelID, providerID: input.providerID },
      }),
      CLASSIFY_TIMEOUT_MS,
    );
    return parseAutoModelTier(result?.text);
  } catch {
    return undefined;
  }
}
