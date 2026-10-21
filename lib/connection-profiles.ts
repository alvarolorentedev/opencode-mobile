import AsyncStorage from '@react-native-async-storage/async-storage';
import { randomUUID } from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import { parseWorkspaces, WORKSPACES_STORAGE_KEY } from '@/providers/workspace-storage';
import { getConnectionPassword } from '@/lib/connection-password';
import { getConnectCredentialError, getConnectTestSecret, parseConnectMetadata, setConnectTestSecret, type ConnectMetadata } from '@/lib/connect';
import { getConnectionScope, type ConnectionIdentity } from '@/lib/connection-scope';
import { CONNECTION_PROFILES_STORAGE_KEY, SETTINGS_STORAGE_KEY } from '@/lib/storage-keys';
import type { ChatPreferences } from '@/providers/opencode-preferences';
import { isValidServerUrl, stripServerUrlCredentials } from '@/lib/opencode/client/url';

// Saved connection metadata is non-secret and lives in AsyncStorage. Passwords
// are stored per profile in SecureStore and are never part of this model.
type ProfileModelPreferences = Pick<
  ChatPreferences,
  'providerId' | 'modelId' | 'enabledModelIds' | 'providerModelSelections' | 'recentModelIds'
>;

export type ConnectionProfile = {
  id: string;
  name: string;
  serverUrl: string;
  username: string;
  connect?: ConnectMetadata;
  // Partial because older writes may not carry every field; unknown fields are
  // ignored and each present field is validated before it is applied.
  modelPreferences?: Partial<ProfileModelPreferences>;
};

// SecureStore keys may only contain alphanumerics, ".", "-" and "_".
function passwordKey(profileId: string) {
  return `opencode-mobile.connection-profile-password.${profileId}`;
}

export function createProfileId() {
  return randomUUID();
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

  const { id, name, serverUrl, username, modelPreferences, connect } = value;
  if (typeof id !== 'string' || !id.trim()) return undefined;
  if (typeof name !== 'string' || !name.trim()) return undefined;
  if (typeof serverUrl !== 'string' || !serverUrl.trim()) return undefined;
  if (typeof username !== 'string') return undefined;
  const parsedConnect = connect === undefined ? undefined : parseConnectMetadata(connect);
  if (connect !== undefined && (!parsedConnect || parsedConnect.deviceId !== username.trim())) return undefined;

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
    serverUrl: stripServerUrlCredentials(serverUrl),
    username: username.trim(),
    ...(parsedConnect ? { connect: parsedConnect } : {}),
    ...(parsedPreferences ? { modelPreferences: parsedPreferences } : {}),
  };
}

export function findProfileByConnectionScope(profiles: ConnectionProfile[], connectionScope: string) {
  return profiles.find((profile) => getConnectionScope(profile) === connectionScope);
}

export function findMatchingProfile(profiles: ConnectionProfile[], identity: ConnectionIdentity & { connect?: ConnectMetadata }) {
  if (identity.connect) {
    return profiles.find((profile) => profile.connect?.controlPlaneUrl === identity.connect!.controlPlaneUrl
      && profile.connect.machineId === identity.connect!.machineId);
  }
  return findProfileByConnectionScope(profiles, getConnectionScope(identity));
}

async function writeConnectionProfiles(profiles: ConnectionProfile[]) {
  await AsyncStorage.setItem(CONNECTION_PROFILES_STORAGE_KEY, JSON.stringify(profiles));
}

let profileMutations: Promise<unknown> = Promise.resolve();
function serializeProfiles<T>(operation: () => Promise<T>) {
  const result = profileMutations.then(operation);
  profileMutations = result.catch(() => undefined);
  return result;
}

export function loadConnectionProfiles(strict = false) {
  return serializeProfiles(() => readConnectionProfiles(strict));
}

// Credential changes and metadata rollback must finish before another writer reads.
export function mutateConnectionProfiles<T>(operation: (profiles: ConnectionProfile[], save: typeof writeConnectionProfiles) => Promise<T>) {
  return serializeProfiles(async () => operation(await readConnectionProfiles(true), writeSanitizedProfiles));
}

async function readConnectionProfiles(strict = false): Promise<ConnectionProfile[]> {
  let raw: string | null;
  try {
    raw = await AsyncStorage.getItem(CONNECTION_PROFILES_STORAGE_KEY);
  } catch (error) {
    if (strict) throw error;
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

export function saveConnectionProfiles(profiles: ConnectionProfile[]) {
  return serializeProfiles(() => writeSanitizedProfiles(profiles));
}

async function writeSanitizedProfiles(profiles: ConnectionProfile[]) {
  const sanitized = profiles
    .map(toConnectionProfile)
    .filter((profile): profile is ConnectionProfile => profile !== undefined);
  await writeConnectionProfiles(sanitized);
}

/**
 * Resolves credentials for a connection that may no longer be the active one.
 * Connect metadata travels with the password so background clients also guard
 * expiry on every fetch and reject credential-bearing redirects.
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
export async function resolveConnectionCredentials(identity: ConnectionIdentity): Promise<{ password: string; connect?: ConnectMetadata } | undefined> {
  if (!identity.serverUrl.trim() || !isValidServerUrl(identity.serverUrl)) return undefined;
  const connectionScope = getConnectionScope(identity);
  // Background notifications and widget actions honor explicit disconnects too.
  try {
    const raw = await AsyncStorage.getItem(WORKSPACES_STORAGE_KEY);
    if (raw && !parseWorkspaces(raw).connections.some((entry) => entry.enabled && getConnectionScope(entry.settings) === connectionScope)) return undefined;
  } catch { return undefined; }

  try {
    const profiles = await loadConnectionProfiles();
    const profile = findProfileByConnectionScope(profiles, connectionScope);
    if (profile) {
      if (getConnectCredentialError(profile.connect, 'present')) return undefined;
      const password = await getProfilePassword(profile.id);
      return getConnectCredentialError(profile.connect, password) ? undefined : { password, ...(profile.connect ? { connect: profile.connect } : {}) };
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
    const password = (await getConnectionPassword()) || '';
    const connect = parseConnectMetadata(settings.connect);
    if (settings.connect !== undefined && (!connect || getConnectCredentialError(connect, password))) return undefined;
    return { password, ...(connect ? { connect } : {}) };
  } catch {
    return undefined;
  }
}

export async function resolveConnectionPassword(identity: ConnectionIdentity): Promise<string | undefined> {
  return (await resolveConnectionCredentials(identity))?.password;
}

export async function getProfilePassword(profileId: string) {
  if (Platform.OS === 'web') return getConnectTestSecret(passwordKey(profileId));
  return (await SecureStore.getItemAsync(passwordKey(profileId))) ?? '';
}

export async function saveProfilePassword(profileId: string, password: string, background = false) {
  if (Platform.OS === 'web') { setConnectTestSecret(passwordKey(profileId), password); return; }
  if (password) {
    await SecureStore.setItemAsync(passwordKey(profileId), password, background ? { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY } : undefined);
    return;
  }
  await SecureStore.deleteItemAsync(passwordKey(profileId));
}

export async function deleteProfilePassword(profileId: string) {
  if (Platform.OS === 'web') { setConnectTestSecret(passwordKey(profileId), ''); return; }
  await SecureStore.deleteItemAsync(passwordKey(profileId));
}

export async function saveConnectProfile(controlPlaneUrl: string, claim: import('@/lib/connect').ConnectClaim) {
  return mutateConnectionProfiles(async (profiles, save) => {
    const previous = profiles.filter((profile) => profile.connect?.controlPlaneUrl === controlPlaneUrl && profile.connect.machineId === claim.machine_id);
    if (previous[0] && new URL(previous[0].serverUrl).hostname !== new URL(claim.server_url).hostname) throw new Error('machine_hostname_mismatch: Access returned a different hostname.');
    const profile: ConnectionProfile = {
      id: previous[0]?.id ?? createProfileId(), name: previous[0]?.name ?? claim.machine_name, serverUrl: claim.server_url, username: claim.device_id,
      ...(previous[0]?.modelPreferences ? { modelPreferences: previous[0].modelPreferences } : {}),
      connect: { controlPlaneUrl, machineId: claim.machine_id, machineName: claim.machine_name, deviceId: claim.device_id, expiresAt: claim.expires_at },
    };
    const oldPassword = previous[0] ? await getProfilePassword(profile.id) : '';
    await saveProfilePassword(profile.id, claim.device_secret, true);
    try {
      await save([...profiles.filter((item) => !previous.includes(item)), profile]);
    } catch (error) {
      await saveProfilePassword(profile.id, oldPassword, true).catch(() => undefined);
      throw error;
    }
    await Promise.all(previous.filter((item) => item.id !== profile.id).map((item) => deleteProfilePassword(item.id)));
    return profile;
  });
}
