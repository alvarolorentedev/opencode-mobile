import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import { getConnectionPassword } from '@/lib/connection-password';
import { getConnectionScope, type ConnectionIdentity } from '@/lib/connection-scope';
import { CONNECTION_PROFILES_STORAGE_KEY, SETTINGS_STORAGE_KEY } from '@/lib/storage-keys';
import type { ChatPreferences } from '@/providers/opencode-provider-utils';

// Saved connection metadata is non-secret and lives in AsyncStorage. Passwords
// are stored per profile in SecureStore and are never part of this model.
export type ProfileModelPreferences = Pick<
  ChatPreferences,
  'providerId' | 'modelId' | 'enabledModelIds' | 'providerModelSelections' | 'recentModelIds'
>;

export type ConnectionProfile = {
  id: string;
  name: string;
  serverUrl: string;
  username: string;
  // Partial because older writes may not carry every field; unknown fields are
  // ignored and each present field is validated before it is applied.
  modelPreferences?: Partial<ProfileModelPreferences>;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// `undefined` means "field absent", and `undefined` plus a `malformed` marker is
// not expressible, so malformed values are reported as `null`.
function toStringArrayOrNull(value: unknown): string[] | undefined | null {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === 'string')) return null;
  return [...value];
}

function toStringRecordOrNull(value: unknown): Record<string, string> | undefined | null {
  if (value === undefined || value === null) return undefined;
  if (!isRecord(value)) return null;
  const entries = Object.entries(value);
  if (!entries.every(([, entry]) => typeof entry === 'string')) return null;
  return Object.fromEntries(entries) as Record<string, string>;
}

// Validates the whole persisted DTO, including model preferences. Unknown
// fields are ignored; an entry with any malformed known field is dropped so a
// corrupt value can never hydrate a partial profile.
export function toConnectionProfile(value: unknown): ConnectionProfile | undefined {
  if (!isRecord(value)) return undefined;

  const { id, name, serverUrl, username, modelPreferences } = value;
  if (typeof id !== 'string' || !id.trim()) return undefined;
  if (typeof name !== 'string' || !name.trim()) return undefined;
  if (typeof serverUrl !== 'string' || !serverUrl.trim()) return undefined;
  if (typeof username !== 'string') return undefined;

  let parsedPreferences: Partial<ProfileModelPreferences> | undefined;
  if (modelPreferences !== undefined && modelPreferences !== null) {
    if (!isRecord(modelPreferences)) return undefined;
    const { providerId, modelId, enabledModelIds, providerModelSelections, recentModelIds } = modelPreferences;
    if (providerId !== undefined && typeof providerId !== 'string') return undefined;
    if (modelId !== undefined && typeof modelId !== 'string') return undefined;
    const enabled = toStringArrayOrNull(enabledModelIds);
    const recent = toStringArrayOrNull(recentModelIds);
    const selections = toStringRecordOrNull(providerModelSelections);
    if (enabled === null || recent === null || selections === null) return undefined;
    const partial: Partial<ProfileModelPreferences> = {};
    if (providerId !== undefined) partial.providerId = providerId;
    if (modelId !== undefined) partial.modelId = modelId;
    if (enabled !== undefined) partial.enabledModelIds = enabled;
    if (selections !== undefined) partial.providerModelSelections = selections;
    if (recent !== undefined) partial.recentModelIds = recent;
    parsedPreferences = Object.keys(partial).length > 0 ? partial : undefined;
  }

  return {
    id: id.trim(),
    name: name.trim(),
    serverUrl: serverUrl.trim(),
    username: username.trim(),
    ...(parsedPreferences ? { modelPreferences: parsedPreferences } : {}),
  };
}

export function findProfileByConnectionScope(profiles: ConnectionProfile[], connectionScope: string) {
  return profiles.find((profile) => getConnectionScope(profile) === connectionScope);
}

export function findMatchingProfile(profiles: ConnectionProfile[], identity: ConnectionIdentity) {
  return findProfileByConnectionScope(profiles, getConnectionScope(identity));
}

async function writeConnectionProfiles(profiles: ConnectionProfile[]) {
  await AsyncStorage.setItem(CONNECTION_PROFILES_STORAGE_KEY, JSON.stringify(profiles));
}

export async function loadConnectionProfiles(): Promise<ConnectionProfile[]> {
  let raw: string | null;
  try {
    raw = await AsyncStorage.getItem(CONNECTION_PROFILES_STORAGE_KEY);
  } catch {
    // A transient read failure leaves the stored value untouched.
    return [];
  }
  if (!raw) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    await AsyncStorage.removeItem(CONNECTION_PROFILES_STORAGE_KEY).catch(() => undefined);
    return [];
  }
  if (!Array.isArray(parsed)) {
    await AsyncStorage.removeItem(CONNECTION_PROFILES_STORAGE_KEY).catch(() => undefined);
    return [];
  }

  const profiles = parsed.map(toConnectionProfile).filter((profile): profile is ConnectionProfile => profile !== undefined);
  // Rewrite when the stored value carried unexpected fields or dropped
  // entries, so plain AsyncStorage never keeps anything the model excludes.
  if (JSON.stringify(profiles) !== raw) {
    await writeConnectionProfiles(profiles).catch(() => undefined);
  }
  return profiles;
}

export async function saveConnectionProfiles(profiles: ConnectionProfile[]) {
  const sanitized = profiles
    .map(toConnectionProfile)
    .filter((profile): profile is ConnectionProfile => profile !== undefined);
  await writeConnectionProfiles(sanitized);
}

/**
 * Resolves the password for a connection that may no longer be the active one.
 *
 * Resolution order:
 * 1. the saved profile whose scope matches (password in SecureStore),
 * 2. the active connection when the record belongs to it, which also covers a
 *    connection that has not been saved as a profile yet.
 *
 * Returns `undefined` when no credential is available. Callers must keep the
 * pending record instead of dropping it or borrowing another connection's
 * password.
 */
export async function resolveConnectionPassword(identity: ConnectionIdentity): Promise<string | undefined> {
  const connectionScope = getConnectionScope(identity);

  try {
    const profiles = await loadConnectionProfiles();
    const profile = findProfileByConnectionScope(profiles, connectionScope);
    if (profile) {
      return await getProfilePassword(profile.id);
    }
  } catch {
    // Fall through to the active connection.
  }

  try {
    const raw = await AsyncStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return undefined;
    const settings = JSON.parse(raw) as Record<string, unknown>;
    if (typeof settings.serverUrl !== 'string') return undefined;
    const activeScope = getConnectionScope({
      serverUrl: settings.serverUrl,
      username: typeof settings.username === 'string' ? settings.username : '',
    });
    if (activeScope !== connectionScope) return undefined;
    return (await getConnectionPassword()) || '';
  } catch {
    return undefined;
  }
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
