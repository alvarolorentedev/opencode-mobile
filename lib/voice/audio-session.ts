import type { AudioMode } from 'expo-audio';

let audioModeInitialized = false;
let audioModulePromise: Promise<typeof import('expo-audio') | null> | null = null;
let duckingActive = false;

function getVoiceAudioMode(duckOthers: boolean): Partial<AudioMode> {
  return {
    allowsRecording: false,
    interruptionMode: duckOthers ? 'duckOthers' : 'mixWithOthers',
    playsInSilentMode: true,
    shouldPlayInBackground: true,
    shouldRouteThroughEarpiece: false,
  };
}

async function getAudioModuleAsync() {
  if (!audioModulePromise) {
    audioModulePromise = import('expo-audio')
      .then((module) => module)
      .catch(() => null);
  }

  return audioModulePromise;
}

export async function initializeVoiceAudioAsync() {
  if (audioModeInitialized) {
    return;
  }

  const audioModule = await getAudioModuleAsync();
  if (!audioModule) {
    return;
  }

  await audioModule.setAudioModeAsync(getVoiceAudioMode(false));
  audioModeInitialized = true;
}

export async function activateVoiceDuckingAsync() {
  const audioModule = await getAudioModuleAsync();
  if (!audioModule) {
    return;
  }

  await initializeVoiceAudioAsync();
  if (duckingActive) {
    return;
  }

  await audioModule.setAudioModeAsync(getVoiceAudioMode(true));
  duckingActive = true;
}

export async function deactivateVoiceDuckingAsync() {
  const audioModule = await getAudioModuleAsync();
  if (!audioModule) {
    return;
  }

  await initializeVoiceAudioAsync();
  if (!duckingActive) {
    return;
  }

  await audioModule.setAudioModeAsync(getVoiceAudioMode(false));
  duckingActive = false;
}
