import AsyncStorage from '@react-native-async-storage/async-storage';

import { normalizeEmbedding } from '@/shared/platform/voice/local-wake-word/similarity';

export const LOCAL_SPEAKER_PROFILE_STORAGE_KEY = 'opencode.local-voice.speaker-profile.v1';

export async function loadLocalSpeakerProfile(): Promise<number[] | undefined> {
  try {
    const raw = await AsyncStorage.getItem(LOCAL_SPEAKER_PROFILE_STORAGE_KEY);
    if (!raw) {
      return undefined;
    }
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.some((value) => typeof value !== 'number' || !Number.isFinite(value))) {
      return undefined;
    }
    return parsed;
  } catch {
    return undefined;
  }
}

export async function saveLocalSpeakerProfile(embedding: number[]): Promise<void> {
  await AsyncStorage.setItem(LOCAL_SPEAKER_PROFILE_STORAGE_KEY, JSON.stringify(normalizeEmbedding(embedding)));
}

export async function clearLocalSpeakerProfile(): Promise<void> {
  await AsyncStorage.removeItem(LOCAL_SPEAKER_PROFILE_STORAGE_KEY);
}
