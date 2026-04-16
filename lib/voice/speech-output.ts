import * as Speech from 'expo-speech';

export type SpeechVoiceOption = {
  id: string;
  label: string;
  language: string;
};

let audioModeInitialized = false;
let audioModulePromise: Promise<typeof import('expo-av') | null> | null = null;
let duckingActive = false;

function getVoiceAudioMode(audioModule: typeof import('expo-av'), duckOthers: boolean) {
  return {
    allowsRecordingIOS: false,
    interruptionModeAndroid: audioModule.InterruptionModeAndroid.DuckOthers,
    interruptionModeIOS: duckOthers
      ? audioModule.InterruptionModeIOS.DuckOthers
      : audioModule.InterruptionModeIOS.MixWithOthers,
    playThroughEarpieceAndroid: false,
    playsInSilentModeIOS: true,
    shouldDuckAndroid: duckOthers,
    staysActiveInBackground: true,
  };
}

async function getAudioModuleAsync() {
  if (!audioModulePromise) {
    audioModulePromise = import('expo-av')
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

  await audioModule.Audio.setAudioModeAsync(getVoiceAudioMode(audioModule, false));

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

  await audioModule.Audio.setAudioModeAsync(getVoiceAudioMode(audioModule, true));
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

  await audioModule.Audio.setAudioModeAsync(getVoiceAudioMode(audioModule, false));
  duckingActive = false;
}

function compactWhitespace(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

export function getSpeakableText(text: string) {
  return compactWhitespace(
    text
      .replace(/```[\s\S]*?```/g, ' code block omitted ')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
      .replace(/^#{1,6}\s+/gm, '')
      .replace(/^[-*+]\s+/gm, '')
      .replace(/^\d+\.\s+/gm, ''),
  );
}

export async function getSpeechVoiceOptions() {
  const voices = await Speech.getAvailableVoicesAsync();

  return voices
    .map((voice) => ({
      id: voice.identifier,
      label: `${voice.name} (${voice.language})`,
      language: voice.language,
    }))
    .sort((left, right) => left.label.localeCompare(right.label));
}

export async function speakText({
  language,
  onDone,
  onError,
  onStart,
  rate,
  text,
  voice,
}: {
  text: string;
  language?: string;
  rate?: number;
  voice?: string;
  onStart?: () => void;
  onDone?: () => void;
  onError?: (error: Error) => void;
}) {
  const speakableText = getSpeakableText(text);
  if (!speakableText) {
    return false;
  }

  await activateVoiceDuckingAsync().catch(() => undefined);
  await Speech.stop().catch(() => undefined);
  Speech.speak(speakableText, {
    language,
    onDone: () => {
      void deactivateVoiceDuckingAsync().catch(() => undefined);
      onDone?.();
    },
    onError: (error) => {
      void deactivateVoiceDuckingAsync().catch(() => undefined);
      onError?.(error instanceof Error ? error : new Error('Speech playback failed.'));
    },
    onStart,
    rate,
    voice,
  });
  return true;
}

export async function stopSpeaking() {
  await Speech.stop();
  await deactivateVoiceDuckingAsync().catch(() => undefined);
}
