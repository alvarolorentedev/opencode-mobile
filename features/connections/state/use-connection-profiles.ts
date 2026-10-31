import { deleteProfileHeaders, getProfileHeaders, saveProfileHeaders } from '@/shared/storage/connection-headers';
import type { ConnectionHeaders } from '@/shared/contracts/connection-headers';
import { createProfileId, deleteProfilePassword, getProfilePassword, loadConnectionProfiles, mutateConnectionProfiles, saveProfilePassword } from '@/shared/storage/connection-profiles';
import { findMatchingProfile, type ConnectionProfile } from '@/shared/contracts/connection-profiles';
import { getConnectionScope } from '@/shared/contracts/connection-scope';
import { probeConnection } from '@/shared/protocol/opencode/client/probe';
import { getServerHostname, normalizeServerUrl } from '@/shared/contracts/server-url';
import { resolveLocalPairing } from '@/shared/protocol/opencode/pairing';
import type { ConnectionContextValue } from '@/features/connections/model/types';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';

export type ConnectionProfileInput = Pick<ConnectionProfile, 'name' | 'serverUrl' | 'username'> & {
  password: string;
  headers: ConnectionHeaders;
};

export type ConnectionProfileSecrets = { password: string; headers: ConnectionHeaders };

export function useConnectionProfiles({ settings, switchConnection, updateSettings, profiles, setProfiles, clearCapabilitiesSnapshots, onSaved, onRemoved }: Pick<ConnectionContextValue, 'settings' | 'switchConnection' | 'updateSettings'> & { clearCapabilitiesSnapshots: (connectionScope: string) => Promise<void>; profiles: ConnectionProfile[]; setProfiles: import('react').Dispatch<import('react').SetStateAction<ConnectionProfile[]>>; onSaved?: (profile: ConnectionProfile, secrets: ConnectionProfileSecrets, previous?: ConnectionProfile) => void; onRemoved?: (profile: ConnectionProfile) => Promise<void> }) {
  const latest = useRef({ settings, switchConnection, updateSettings });
  useLayoutEffect(() => { latest.current = { settings, switchConnection, updateSettings }; });
  const mutations = useRef<Promise<unknown>>(Promise.resolve());
  const mutate = useCallback(<T,>(operation: () => Promise<T>) => {
    const result = mutations.current.then(operation);
    mutations.current = result.catch(() => undefined);
    return result;
  }, []);
  const refresh = useCallback(() => mutate(async () => {
    const stored = await loadConnectionProfiles(true);
    setProfiles(stored);
  }), [mutate, setProfiles]);
  useEffect(() => {
    void refresh().catch((reason) => console.warn('Could not refresh connection profiles.', reason));
  }, [refresh]);
  const connect = useCallback(async (profile: ConnectionProfile) => {
    const [password, headers] = await Promise.all([getProfilePassword(profile.id), getProfileHeaders(profile.id)]);
    return latest.current.switchConnection({ serverUrl: profile.serverUrl, username: profile.username, password, headers, connect: profile.connect }, profile.modelPreferences);
  }, []);
  const passwordForEditing = useCallback((id: string) => getProfilePassword(id), []);
  const headersForEditing = useCallback((id: string) => getProfileHeaders(id), []);
  const probe = useCallback((values: Pick<ConnectionProfileInput, 'serverUrl' | 'username' | 'password' | 'headers'>, signal?: AbortSignal) => probeConnection({ ...values, directory: '' }, signal), []);
  const pair = useCallback((code: string, signal?: AbortSignal) => resolveLocalPairing(code, signal), []);
  const save = useCallback((values: ConnectionProfileInput, id?: string) => mutate(() => mutateConnectionProfiles(async (stored, saveMetadata) => {
    const previous = id ? stored.find((profile) => profile.id === id) : undefined;
    if (id && !previous) throw new Error('This connection profile is no longer available.');
    if (previous?.connect) throw new Error('Manage this connection through Cloud Link.');
    const base = normalizeServerUrl(values.serverUrl);
    if (!values.serverUrl.trim() || !base.valid) throw new Error('Invalid server URL.');
    const name = values.name.trim() || getServerHostname(values.serverUrl);
    const profile: ConnectionProfile = { ...previous, id: id ?? createProfileId(), name, serverUrl: values.serverUrl.trim(), username: values.username.trim() };
    const oldPassword = previous ? await getProfilePassword(profile.id) : '';
    const oldHeaders = previous ? await getProfileHeaders(profile.id) : {};
    if (previous && (oldPassword !== values.password || JSON.stringify(oldHeaders) !== JSON.stringify(values.headers))) await clearCapabilitiesSnapshots(getConnectionScope(previous));
    await saveProfilePassword(profile.id, values.password);
    await saveProfileHeaders(profile.id, values.headers);
    const next = [...stored.filter((entry) => entry.id !== profile.id), profile];
    try {
      await saveMetadata(next);
    } catch (error) {
      await saveProfilePassword(profile.id, oldPassword).catch(() => undefined);
      await saveProfileHeaders(profile.id, oldHeaders).catch(() => undefined);
      throw error;
    }
    setProfiles(next);
    onSaved?.(profile, { password: values.password, headers: values.headers }, previous);
    if (previous && previous.id === findMatchingProfile(stored, latest.current.settings)?.id) {
      latest.current.updateSettings({ serverUrl: values.serverUrl, username: values.username, password: values.password, headers: values.headers });
    }
    return profile;
  })), [clearCapabilitiesSnapshots, mutate, onSaved, setProfiles]);
  const remove = useCallback((id: string) => mutate(() => mutateConnectionProfiles(async (stored, saveMetadata) => {
    if (findMatchingProfile(stored, latest.current.settings)?.id === id) throw new Error('The active connection cannot be deleted.');
    const next = stored.filter((profile) => profile.id !== id);
    const profile = stored.find((item) => item.id === id);
    if (profile) await onRemoved?.(profile);
    await saveMetadata(next);
    setProfiles(next);
    await deleteProfilePassword(id);
    await deleteProfileHeaders(id);
  })), [mutate, onRemoved, setProfiles]);
  return useMemo(() => ({ profiles, refresh, connect, passwordForEditing, headersForEditing, probe, pair, save, remove }), [profiles, refresh, connect, passwordForEditing, headersForEditing, probe, pair, save, remove]);
}

export type ConnectionProfilesState = ReturnType<typeof useConnectionProfiles>;
