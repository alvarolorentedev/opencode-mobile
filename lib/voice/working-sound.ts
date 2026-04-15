import * as FileSystem from 'expo-file-system/legacy';
import { encode as encodeBase64 } from 'base-64';

import { initializeVoiceAudioAsync } from '@/lib/voice/speech-output';

export type WorkingSoundVariant = 'soft' | 'glass';

type ExpoAudioModule = typeof import('expo-av');
type AudioSound = import('expo-av').Audio.Sound;

const SAMPLE_RATE = 22050;
const DURATION_SECONDS = 1.8;
const PEAK_VOLUME = 0.12;

let audioModulePromise: Promise<ExpoAudioModule | null> | null = null;
let loadedVariant: WorkingSoundVariant | undefined;
let sound: AudioSound | undefined;

async function getAudioModuleAsync() {
  if (!audioModulePromise) {
    audioModulePromise = import('expo-av')
      .then((module) => module)
      .catch(() => null);
  }

  return audioModulePromise;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function writeAscii(view: DataView, offset: number, value: string) {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}

function createEnvelope(progress: number) {
  if (progress < 0.18) {
    return progress / 0.18;
  }

  if (progress > 0.88) {
    return Math.max(0, (1 - progress) / 0.12);
  }

  return 1;
}

function createSample(time: number, variant: WorkingSoundVariant) {
  const progress = time / DURATION_SECONDS;
  const envelope = createEnvelope(progress);
  const sweep = Math.sin(progress * Math.PI);

  if (variant === 'glass') {
    const a = Math.sin(2 * Math.PI * 392 * time);
    const b = Math.sin(2 * Math.PI * 587.33 * time) * 0.55;
    return (a + b) * 0.5 * envelope * (0.55 + sweep * 0.45);
  }

  const a = Math.sin(2 * Math.PI * 261.63 * time);
  const b = Math.sin(2 * Math.PI * 329.63 * time) * 0.6;
  const c = Math.sin(2 * Math.PI * 392 * time) * 0.25;
  return (a + b + c) * 0.45 * envelope * (0.5 + sweep * 0.5);
}

function createWorkingSoundBase64(variant: WorkingSoundVariant) {
  const sampleCount = Math.floor(SAMPLE_RATE * DURATION_SECONDS);
  const dataSize = sampleCount * 2;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  for (let index = 0; index < sampleCount; index += 1) {
    const time = index / SAMPLE_RATE;
    const sample = clamp(createSample(time, variant) * PEAK_VOLUME, -1, 1);
    view.setInt16(44 + index * 2, Math.round(sample * 32767), true);
  }

  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return encodeBase64(binary);
}

async function ensureWorkingSoundFileAsync(variant: WorkingSoundVariant) {
  const cacheDirectory = FileSystem.cacheDirectory;
  if (!cacheDirectory) {
    throw new Error('Audio cache is unavailable.');
  }

  const uri = `${cacheDirectory}working-sound-${variant}.wav`;
  const existing = await FileSystem.getInfoAsync(uri);
  if (!existing.exists) {
    const base64 = createWorkingSoundBase64(variant);
    await FileSystem.writeAsStringAsync(uri, base64, {
      encoding: FileSystem.EncodingType.Base64,
    });
  }

  return uri;
}

export async function startWorkingSoundAsync(variant: WorkingSoundVariant, volume: number) {
  const audioModule = await getAudioModuleAsync();
  if (!audioModule) {
    return false;
  }

  await initializeVoiceAudioAsync();

  if (sound && loadedVariant !== variant) {
    await sound.unloadAsync().catch(() => undefined);
    sound = undefined;
    loadedVariant = undefined;
  }

  if (!sound) {
    const uri = await ensureWorkingSoundFileAsync(variant);
    const created = await audioModule.Audio.Sound.createAsync(
      { uri },
      {
        isLooping: true,
        progressUpdateIntervalMillis: 1000,
        shouldPlay: false,
        volume: clamp(volume, 0, 1),
      },
    );

    sound = created.sound;
    loadedVariant = variant;
  }

  await sound.setIsLoopingAsync(true);
  await sound.setVolumeAsync(clamp(volume, 0, 1));
  await sound.playAsync();
  return true;
}

export async function stopWorkingSoundAsync() {
  if (!sound) {
    return;
  }

  await sound.pauseAsync().catch(() => undefined);
  await sound.setPositionAsync(0).catch(() => undefined);
}

export async function unloadWorkingSoundAsync() {
  if (!sound) {
    return;
  }

  await sound.unloadAsync().catch(() => undefined);
  sound = undefined;
  loadedVariant = undefined;
}
