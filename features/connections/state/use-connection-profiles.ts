import { deleteProfileHeaders, getProfileHeaders, saveProfileHeaders } from '@/shared/storage/connection-headers';
import { deleteProfileCertificate, getProfileCertificate, saveProfileCertificate } from '@/shared/storage/connection-certificates';
import { connectionOrigin, releaseHostTrust } from '@/shared/platform/tls-trust';
import type { ConnectionCertificate } from '@/shared/contracts/connection-certificate';
import type { ConnectionHeaders } from '@/shared/contracts/connection-headers';
import { createProfileId, deleteProfilePassword, getProfilePassword, loadConnectionProfiles, mutateConnectionProfiles, readProfileConnection, saveProfilePassword } from '@/shared/storage/connection-profiles';
import { findMatchingProfile, type ConnectionProfile } from '@/shared/contracts/connection-profiles';
import { getConnectionScope } from '@/shared/contracts/connection-scope';
import { probeConnection } from '@/shared/protocol/opencode/client/probe';
import { getServerHostname, normalizeServerUrl } from '@/shared/contracts/server-url';
import { resolveLocalPairing } from '@/shared/protocol/opencode/pairing';
import type { ConnectionContextValue } from '@/features/connections/model/types';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';

export type ConnectionProfileInput = Pick<ConnectionProfile, 'name' | 'serverUrl' | 'username' | 'oidc'> & {
  password: string;
  headers: ConnectionHeaders;
  certificate?: ConnectionCertificate;
};

export type ConnectionProfileIdentity = Pick<ConnectionProfile, 'serverUrl' | 'username' | 'oidc'>;

export type ConnectionProfileSecrets = { password: string; headers: ConnectionHeaders; certificate?: ConnectionCertificate };

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
    const connection = await readProfileConnection(profile);
    return latest.current.switchConnection(connection, profile.modelPreferences);
  }, []);
  const passwordForEditing = useCallback((id: string) => getProfilePassword(id), []);
  const headersForEditing = useCallback((id: string) => getProfileHeaders(id), []);
  const certificateForEditing = useCallback((id: string) => getProfileCertificate(id), []);
  const probe = useCallback((values: Pick<ConnectionProfileInput, 'serverUrl' | 'username' | 'password' | 'headers' | 'certificate' | 'oidc'>, signal?: AbortSignal) => probeConnection({ ...values, directory: '' }, signal), []);
  const signIn = useCallback(async (identity: ConnectionProfileIdentity, signal?: AbortSignal) => {
    if (!identity.oidc) throw new Error('OpenID Connect is not configured for this connection.');
    // Loaded on demand so a basic-auth connection never initialises the OIDC
    // stack (browser session plus encrypted token store).
    const { signInWithOidc } = await import('@/shared/auth/oidc/session');
    return signInWithOidc(identity, identity.oidc, { signal });
  }, []);
  const oidcStatus = useCallback(async (identity: ConnectionProfileIdentity) => {
    if (!identity.oidc) return 'signed-out' as const;
    const { getOidcSessionStatus } = await import('@/shared/auth/oidc/session');
    return getOidcSessionStatus(identity, identity.oidc);
  }, []);
  const signOut = useCallback(async (identity: ConnectionProfileIdentity) => {
    if (!identity.oidc) return;
    const { signOutOidc } = await import('@/shared/auth/oidc/session');
    await signOutOidc(identity, identity.oidc);
  }, []);
  const pair = useCallback((code: string, signal?: AbortSignal) => resolveLocalPairing(code, signal), []);
  const save = useCallback((values: ConnectionProfileInput, id?: string) => mutate(() => mutateConnectionProfiles(async (stored, saveMetadata) => {
    const previous = id ? stored.find((profile) => profile.id === id) : undefined;
    if (id && !previous) throw new Error('This connection profile is no longer available.');
    if (previous?.connect) throw new Error('Manage this connection through Cloud Link.');
    const base = normalizeServerUrl(values.serverUrl);
    if (!values.serverUrl.trim() || !base.valid) throw new Error('Invalid server URL.');
    const name = values.name.trim() || getServerHostname(values.serverUrl);
    const profile: ConnectionProfile = { ...previous, id: id ?? createProfileId(), name, serverUrl: values.serverUrl.trim(), username: values.username.trim() };
    // Stage a new secret slot when the owner changes so a failed write cannot
    // attach the new credentials to the old server.
    const scopeChanged = previous && getConnectionScope(previous) !== getConnectionScope(profile);
    if (scopeChanged) profile.id = createProfileId();
    if (values.oidc) profile.oidc = values.oidc;
    else delete profile.oidc;
    const oldPassword = previous ? await getProfilePassword(previous.id) : '';
    const oldHeaders = previous ? await getProfileHeaders(previous.id) : {};
    const oldCertificate = previous ? await getProfileCertificate(previous.id) : undefined;
    if (previous && (oldPassword !== values.password || JSON.stringify(oldHeaders) !== JSON.stringify(values.headers) || JSON.stringify(oldCertificate) !== JSON.stringify(values.certificate) || JSON.stringify(previous.oidc) !== JSON.stringify(values.oidc))) await clearCapabilitiesSnapshots(getConnectionScope(previous));
    const next = [...stored.filter((entry) => entry.id !== id), profile];
    try {
      await saveProfilePassword(profile.id, values.password);
      await saveProfileHeaders(profile.id, values.headers);
      await saveProfileCertificate(profile.id, values.certificate);
      await saveMetadata(next);
    } catch (error) {
      await saveProfilePassword(profile.id, scopeChanged ? '' : oldPassword).catch(() => undefined);
      await saveProfileHeaders(profile.id, scopeChanged ? {} : oldHeaders).catch(() => undefined);
      await saveProfileCertificate(profile.id, scopeChanged ? undefined : oldCertificate).catch(() => undefined);
      throw error;
    }
    if (previous?.oidc && (!values.oidc || previous.oidc.issuer !== values.oidc.issuer || previous.oidc.clientId !== values.oidc.clientId || scopeChanged)) {
      const { signOutOidc } = await import('@/shared/auth/oidc/session');
      await signOutOidc({ serverUrl: previous.serverUrl, username: previous.username }, previous.oidc).catch((error) => console.warn('Could not clear the previous sign-in.', error));
    }
    if (scopeChanged) {
      await Promise.allSettled([deleteProfilePassword(previous.id), deleteProfileHeaders(previous.id), deleteProfileCertificate(previous.id)]);
    }
    setProfiles(next);
    onSaved?.(profile, { password: values.password, headers: values.headers, certificate: values.certificate }, previous);
    if (previous && previous.id === findMatchingProfile(stored, latest.current.settings)?.id) {
      latest.current.updateSettings({ serverUrl: values.serverUrl, username: values.username, password: values.password, headers: values.headers, certificate: values.certificate, oidc: values.oidc });
    }
    return profile;
  })), [clearCapabilitiesSnapshots, mutate, onSaved, setProfiles]);
  const remove = useCallback((id: string) => mutate(() => mutateConnectionProfiles(async (stored, saveMetadata) => {
    if (findMatchingProfile(stored, latest.current.settings)?.id === id) throw new Error('The active connection cannot be deleted.');
    const next = stored.filter((profile) => profile.id !== id);
    const profile = stored.find((item) => item.id === id);
    if (profile?.oidc) {
      const { signOutOidc } = await import('@/shared/auth/oidc/session');
      await signOutOidc(profile, profile.oidc);
    }
    if (profile) await onRemoved?.(profile);
    await saveMetadata(next);
    setProfiles(next);
    await deleteProfilePassword(id);
    await deleteProfileHeaders(id);
    await deleteProfileCertificate(id);
    if (profile?.serverUrl) {
      const origin = connectionOrigin(profile.serverUrl);
      const stillUsed = origin && next.some((entry) => connectionOrigin(entry.serverUrl) === origin);
      if (origin && !stillUsed) void releaseHostTrust(profile.serverUrl);
    }
  })), [mutate, onRemoved, setProfiles]);
  return useMemo(() => ({ profiles, refresh, connect, passwordForEditing, headersForEditing, certificateForEditing, probe, pair, save, remove, signIn, oidcStatus, signOut }), [profiles, refresh, connect, passwordForEditing, headersForEditing, certificateForEditing, probe, pair, save, remove, signIn, oidcStatus, signOut]);
}

export type ConnectionProfilesState = ReturnType<typeof useConnectionProfiles>;
