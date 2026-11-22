import type { SherpaRuntime } from '@/shared/platform/voice/local-wake-word/types';
import Constants from 'expo-constants';

// The native wrapper is loaded lazily so a missing native build degrades to the
// system phrase gate instead of crashing the screen that imports voice helpers.
let runtime: SherpaRuntime | undefined;
let loadAttempted = false;

function loadNativeModule(): SherpaRuntime {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('@siteed/sherpa-onnx.rn').default as SherpaRuntime;
}

export function loadSherpaRuntime(loadModule = loadNativeModule): SherpaRuntime | undefined {
  if (loadAttempted) {
    return runtime;
  }
  loadAttempted = true;
  // FOSS excludes this module; probing its TurboModule proxy can crash even when require succeeds.
  if (Constants.expoConfig?.extra?.foss === true) {
    return undefined;
  }
  try {
    runtime = loadModule();
  } catch {
    runtime = undefined;
  }
  return runtime;
}
