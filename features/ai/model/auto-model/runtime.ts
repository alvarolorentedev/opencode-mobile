// Web fallback for the on-device classifier. llama.rn is a native module, so
// web builds expose no local classifier and the router must use OpenCode mode or
// leave routing disabled.
import type { AutoModelClassifierInput } from '@/features/ai/model/auto-model/classifier-prompt';
import type { ModelComplexity } from '@/shared/preferences/auto-model';

export async function classifyPromptWithLocalModel(_input: AutoModelClassifierInput): Promise<ModelComplexity | undefined> {
  return undefined;
}

export async function releaseLocalAutoModelRuntime(): Promise<void> {
  // Nothing to release on web.
}

export function isLocalAutoModelRuntimeSupported() {
  return false;
}
