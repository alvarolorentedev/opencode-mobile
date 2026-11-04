import { ExpoSpeechRecognitionModule } from 'expo-speech-recognition';

const DRAIN_TIMEOUT_MS = 3000;
const STATE_TIMEOUT_MS = 1000;

async function withTimeout<T>(pending: Promise<T>, ms: number): Promise<T | undefined> {
  let resolveTimeout!: (value: undefined) => void;
  const timeout = new Promise<undefined>((resolve) => { resolveTimeout = resolve; });
  const timer = setTimeout(() => resolveTimeout(undefined), ms);
  try {
    return await Promise.race([pending, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export async function drainRecognition(session: { ended: Promise<true>; finish: () => void }, waitForEnd: boolean) {
  if (waitForEnd && await withTimeout(session.ended, DRAIN_TIMEOUT_MS)) return true;
  try {
    const state = await withTimeout(Promise.race([session.ended, ExpoSpeechRecognitionModule.getStateAsync()]), STATE_TIMEOUT_MS);
    if (state === true) return true;
    if (state === 'inactive') {
      session.finish();
      return true;
    }
  } catch {
    // Retain ownership when native state cannot be confirmed.
  }
  return false;
}
