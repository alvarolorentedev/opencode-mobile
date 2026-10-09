import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createProfileId, deleteProfilePassword, findMatchingProfile, getProfilePassword,
  loadConnectionProfiles, saveConnectionProfiles, saveProfilePassword, type ConnectionProfile } from '@/lib/connection-profiles';
import type { ConnectionContextValue } from '@/providers/opencode-provider-types';
import { probeConnection } from '@/lib/opencode/client/probe';
import { getServerHostname, normalizeServerUrl } from '@/lib/opencode/client/url';
import { resolveLocalPairing } from '@/lib/opencode/pairing';

export type ConnectionProfileInput = Pick<ConnectionProfile, 'name' | 'serverUrl' | 'username'> & { password: string };

export function useConnectionProfiles({ settings, switchConnection, updateSettings }: Pick<ConnectionContextValue, 'settings' | 'switchConnection' | 'updateSettings'>) {
  const [profiles, setProfiles] = useState<ConnectionProfile[]>([]);
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
  }), [mutate]);
  const connect = useCallback(async (profile: ConnectionProfile) => {
    const password = await getProfilePassword(profile.id);
    return latest.current.switchConnection({ serverUrl: profile.serverUrl, username: profile.username, password, connect: profile.connect }, profile.modelPreferences);
  }, []);
  const passwordForEditing = useCallback((id: string) => getProfilePassword(id), []);
  const probe = useCallback((values: Pick<ConnectionProfileInput, 'serverUrl' | 'username' | 'password'>, signal?: AbortSignal) => probeConnection({ ...values, directory: '' }, signal), []);
  const pair = useCallback((code: string, signal?: AbortSignal) => resolveLocalPairing(code, signal), []);
  const save = useCallback((values: ConnectionProfileInput, id?: string) => mutate(async () => {
    const stored = await loadConnectionProfiles(true);
    const previous = id ? stored.find((profile) => profile.id === id) : undefined;
    if (id && !previous) throw new Error('This connection profile is no longer available.');
    if (previous?.connect) throw new Error('Manage this connection through Cloud Link.');
    const base = normalizeServerUrl(values.serverUrl);
    if (!values.serverUrl.trim() || !base.valid) throw new Error('Invalid server URL.');
    const name = values.name.trim() || getServerHostname(values.serverUrl);
    const profile: ConnectionProfile = { ...previous, id: id ?? createProfileId(), name, serverUrl: values.serverUrl.trim(), username: values.username.trim() };
    const oldPassword = previous ? await getProfilePassword(profile.id) : '';
    await saveProfilePassword(profile.id, values.password);
    const next = [...stored.filter((entry) => entry.id !== profile.id), profile];
    try {
      await saveConnectionProfiles(next);
    } catch (error) {
      await saveProfilePassword(profile.id, oldPassword).catch(() => undefined);
      throw error;
    }
    setProfiles(next);
    if (previous && previous.id === findMatchingProfile(stored, latest.current.settings)?.id) {
      latest.current.updateSettings({ serverUrl: values.serverUrl, username: values.username, password: values.password });
    }
    return profile;
  }), [mutate]);
  const remove = useCallback((id: string) => mutate(async () => {
    const stored = await loadConnectionProfiles(true);
    if (findMatchingProfile(stored, latest.current.settings)?.id === id) throw new Error('The active connection cannot be deleted.');
    const next = stored.filter((profile) => profile.id !== id);
    await saveConnectionProfiles(next);
    setProfiles(next);
    await deleteProfilePassword(id);
  }), [mutate]);
  return useMemo(() => ({ profiles, refresh, connect, passwordForEditing, probe, pair, save, remove }), [profiles, refresh, connect, passwordForEditing, probe, pair, save, remove]);
}

export type ConnectionProfilesState = ReturnType<typeof useConnectionProfiles>;
