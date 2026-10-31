import type { SherpaRuntime } from '@/shared/platform/voice/local-wake-word/types';

// Web and unit-test fallback. Metro resolves sherpa.native.ts on iOS/Android.
export function loadSherpaRuntime(): SherpaRuntime | undefined {
  return undefined;
}
