import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import { CONNECTION_PROFILES_STORAGE_KEY } from '@/lib/storage-keys';
import type { ChatPreferences } from '@/providers/opencode-provider-utils';

export type ProfileModelPreferences = Pick<
  ChatPreferences,
  'providerId' | 'modelId' | 'enabledModelIds' | 'providerModelSelections' | 'recentModelIds'
>;

export type ConnectionProfile = {
  id: string;
  name: string;
  serverUrl: string;
  username: string;
  modelPreferences?: ProfileModelPreferences;
};

// SecureStore keys may only contain alphanumerics, ".", "-" and "_".
function passwordKey(profileId: string) {
  return `opencode-mobile.connection-profile-password.${profileId}`;
}

export function createProfileId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function pickModelPreferences(preferences: ChatPreferences): ProfileModelPreferences {
  return {
    providerId: preferences.providerId,
    modelId: preferences.modelId,
    enabledModelIds: [...preferences.enabledModelIds],
    providerModelSelections: { ...preferences.providerModelSelections },
    recentModelIds: [...preferences.recentModelIds],
  };
}

export function normalizeServerUrlForMatch(serverUrl: string) {
  return serverUrl.trim().replace(/\/+$/, '').toLowerCase();
}

export function findMatchingProfile(profiles: ConnectionProfile[], serverUrl: string, username: string) {
  const url = normalizeServerUrlForMatch(serverUrl);
  const user = username.trim();
  return profiles.find((profile) => normalizeServerUrlForMatch(profile.serverUrl) === url && profile.username.trim() === user);
}

function isProfile(value: unknown): value is ConnectionProfile {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.id === 'string'
    && typeof candidate.name === 'string'
    && typeof candidate.serverUrl === 'string'
    && typeof candidate.username === 'string';
}

export async function loadConnectionProfiles(): Promise<ConnectionProfile[]> {
  try {
    const raw = await AsyncStorage.getItem(CONNECTION_PROFILES_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isProfile) : [];
  } catch {
    return [];
  }
}

export async function saveConnectionProfiles(profiles: ConnectionProfile[]) {
  await AsyncStorage.setItem(CONNECTION_PROFILES_STORAGE_KEY, JSON.stringify(profiles));
}

export async function getProfilePassword(profileId: string) {
  if (Platform.OS === 'web') return '';
  return (await SecureStore.getItemAsync(passwordKey(profileId))) ?? '';
}

export async function saveProfilePassword(profileId: string, password: string) {
  if (Platform.OS === 'web') return;
  if (password) {
    await SecureStore.setItemAsync(passwordKey(profileId), password);
    return;
  }
  await SecureStore.deleteItemAsync(passwordKey(profileId));
}

export async function deleteProfilePassword(profileId: string) {
  if (Platform.OS === 'web') return;
  await SecureStore.deleteItemAsync(passwordKey(profileId));
}
