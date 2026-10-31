import { useCallback, useEffect, useMemo, useState } from 'react';

import { getConnectCredentialError } from '@/shared/contracts/cloud-link';
import { findMatchingProfile, type ConnectionProfile } from '@/shared/contracts/connection-profiles';
import { getProfilePassword } from '@/shared/storage/connection-profiles';
import { getConnectionScope, getConnectionUiScope } from '@/shared/contracts/connection-scope';
import { deleteManagedService, getServiceManagementVersion, listManagedServices, putManagedService, ServiceManagementError, type OpencodeConnectionSettings } from '@/shared/protocol/opencode/client';
import { type ServiceInput } from '@/shared/contracts/service-management';
import type { ServiceManagementApi, ServiceManagementTarget, ServiceManagementUnavailableReason } from '@/shared/contracts/domain';
import { useQueryForeground } from '@/shared/server-data/client';
import { buildServiceMachines, chooseServiceTarget } from '@/features/cloud-link/model/services-target';
import type { ConnectSetup } from '@/shared/contracts/cloud-link-setup';
import type { ConnectionRecord } from '@/shared/contracts/workspace';
import { useQueries, useQueryClient } from '@tanstack/react-query';

// Remote connector service management state. Services belong to one Cloud Link
// machine: the target can differ from the active connection, because the
// connector's management API authenticates the device on the machine's own
// origin. The resolved target and its device credential both live here (not in
// the settings screen), and every mutation re-lists the connector's canonical
// values, so a connector-side edit never leaves stale UI across a reopen.
//
// The stored list is keyed by target scope: when the target machine changes the
// derived `services` value resets without an effect, and in-flight results from
// the old scope are dropped by the scope key or `scopeGenerationRef`.
type ServicesResolution =
  | { status: 'resolving' }
  | { status: 'none' }
  | { status: 'expired'; target: ServiceManagementTarget }
  | { status: 'ready'; target: ServiceManagementTarget; settings: OpencodeConnectionSettings };

function targetForProfile(profile: ConnectionProfile): ServiceManagementTarget {
  return {
    serverUrl: profile.serverUrl,
    profileId: profile.id,
    machineId: profile.connect?.machineId,
    machineName: profile.connect?.machineName,
    isActiveConnection: false,
  };
}

export function useServicesState({
  settings,
  connectSetup,
  connections,
  visible,
}: {
  settings: OpencodeConnectionSettings;
  connectSetup: ConnectSetup;
  connections: ConnectionRecord[];
  visible: boolean;
}) {
  const profiles = connectSetup.profiles;
  const { connectProfile, retry: retryConnect, savedProfile } = connectSetup;
  const preferredProfileId = savedProfile?.connect ? savedProfile.id : undefined;
  const environmentUrl = settings.connect?.controlPlaneUrl ?? connectSetup.controlPlaneUrl;
  const [selectedProfileId, setSelectedProfileId] = useState<string>();
  const [profileAccess, setProfileAccess] = useState<{ profileId: string; password: string; revision: number }>();
  const cache = useQueryClient();
  const foreground = useQueryForeground() && visible;
  const [requested, setRequested] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const choice = useMemo(() => chooseServiceTarget({
    profiles,
    controlPlaneUrl: environmentUrl,
    active: Boolean(settings.connect),
    activeMachineId: settings.connect?.machineId,
    selectedProfileId,
    preferredProfileId,
  }), [environmentUrl, preferredProfileId, profiles, selectedProfileId, settings]);

  // A saved machine's password lives in SecureStore, so only the password read
  // is async: the active connection resolves synchronously from its settings.
  useEffect(() => {
    if (!connectSetup.enabled || choice.kind !== 'profile') return;
    const profile = choice.profile;
    let cancelled = false;
    void getProfilePassword(profile.id).then((password) => {
      if (!cancelled) setProfileAccess((current) => ({ profileId: profile.id, password, revision: (current?.revision ?? 0) + (current?.password === password ? 0 : 1) }));
    }, () => {
      // A failed SecureStore read degrades to an expired target.
      if (!cancelled) setProfileAccess((current) => ({ profileId: profile.id, password: '', revision: (current?.revision ?? 0) + 1 }));
    });
    return () => { cancelled = true; };
  }, [choice, connectSetup.enabled]);

  const resolution = useMemo<ServicesResolution>(() => {
    if (!connectSetup.enabled) return { status: 'none' };
    if (choice.kind === 'none') {
      // Profiles hydrate with the connect machine; stay silent until it resolves
      // so a store/initialization failure never claims no machine is saved.
      return connectSetup.initialization === 'ready' ? { status: 'none' } : { status: 'resolving' };
    }
    if (choice.kind === 'active') {
      const target: ServiceManagementTarget = {
        serverUrl: settings.serverUrl,
        profileId: findMatchingProfile(profiles, settings)?.id,
        machineId: settings.connect?.machineId,
        machineName: settings.connect?.machineName,
        isActiveConnection: true,
      };
      return getConnectCredentialError(settings.connect, settings.password)
        ? { status: 'expired', target }
        : { status: 'ready', target, settings };
    }
    const profile = choice.profile;
    const target = targetForProfile(profile);
    if (profileAccess?.profileId !== profile.id) return { status: 'resolving' };
    const credentialError = getConnectCredentialError(profile.connect, profileAccess.password);
    return credentialError || !profileAccess.password
      ? { status: 'expired', target }
      : {
        status: 'ready',
        target,
        settings: { ...settings, serverUrl: profile.serverUrl, username: profile.username, password: profileAccess.password, connect: profile.connect },
      };
  }, [choice, connectSetup.enabled, connectSetup.initialization, profileAccess, profiles, settings]);

  const targetSettings = resolution.status === 'ready' ? resolution.settings : undefined;
  const owner = targetSettings ? connections.find((entry) => entry.id === getConnectionUiScope(targetSettings)) : undefined;
  const scope = targetSettings ? getConnectionScope(targetSettings) : undefined;
  const machineKey = targetSettings?.connect?.machineId ?? choice.kind;
  const authRevision = owner?.authRevision ?? profileAccess?.revision ?? 0;
  const key = useMemo(() => ['cloudlink-services', machineKey, scope, authRevision], [machineKey, scope, authRevision]);
  useEffect(() => () => {
    void cache.cancelQueries({ queryKey: key });
    cache.removeQueries({ queryKey: key });
  }, [cache, key]);
  const listOptions = useMemo(() => ({ queryKey: [...key, 'list'], staleTime: 0,
    queryFn: ({ signal }: { signal: AbortSignal }) => listManagedServices(targetSettings!, signal) }), [key, targetSettings]);
  const versionOptions = useMemo(() => ({ queryKey: [...key, 'version'], staleTime: 0,
    queryFn: ({ signal }: { signal: AbortSignal }) => getServiceManagementVersion(targetSettings!, signal) }), [key, targetSettings]);
  const [list] = useQueries({ queries: [listOptions].filter(() => requested && foreground && Boolean(targetSettings)) });
  const [versionQuery] = useQueries({ queries: [versionOptions].filter(() => requested && foreground && Boolean(targetSettings)) });
  const services = useMemo(() => list?.error ? [] : list?.data ?? [], [list?.error, list?.data]);
  const version = versionQuery?.data;
  const credentialFailure = list?.error instanceof ServiceManagementError && list?.error.status === 401;
  const loadFailed = Boolean(list?.error) && !credentialFailure;
  const available = resolution.status === 'ready' && !credentialFailure;
  const unavailableReason: ServiceManagementUnavailableReason | undefined = resolution.status === 'none'
    ? 'no-cloud-link-machine' : resolution.status === 'expired' || credentialFailure ? 'credentials-expired' : undefined;
  const target = resolution.status === 'ready' || resolution.status === 'expired' ? resolution.target : undefined;
  const machines = useMemo(() => buildServiceMachines(profiles, settings.connect?.machineId, environmentUrl), [environmentUrl, profiles, settings.connect?.machineId]);
  const refresh = useCallback(async () => {
    setRequested(true);
    if (!targetSettings || !foreground) return;
    await Promise.allSettled([cache.fetchQuery(listOptions), cache.fetchQuery(versionOptions)]);
  }, [cache, foreground, listOptions, targetSettings, versionOptions]);
  const save = useCallback(async (id: string, input: ServiceInput) => {
    if (!targetSettings) throw new Error('Connect a Cloud Link machine before managing services.');
    setIsSaving(true);
    try {
      await cache.cancelQueries({ queryKey: key });
      const saved = await putManagedService(targetSettings, id, input);
      await cache.invalidateQueries({ queryKey: key });
      return saved;
    } finally { setIsSaving(false); }
  }, [cache, key, targetSettings]);
  const remove = useCallback(async (id: string) => {
    if (!targetSettings) throw new Error('Connect a Cloud Link machine before managing services.');
    setIsSaving(true);
    try { await cache.cancelQueries({ queryKey: key }); await deleteManagedService(targetSettings, id); await cache.invalidateQueries({ queryKey: key }); }
    finally { setIsSaving(false); }
  }, [cache, key, targetSettings]);
  const isRefreshing = Boolean(list?.isFetching || versionQuery?.isFetching);
  const selectMachine = useCallback((id: string) => {
    setSelectedProfileId((current) => (current === id ? current : id));
  }, []);

  const targetProfileId = target?.profileId;
  const activateTarget = useCallback(async () => {
    const profile = targetProfileId
      ? profiles.find((entry) => entry.id === targetProfileId)
      : savedProfile;
    if (profile) return connectProfile(profile);
    return retryConnect();
  }, [connectProfile, profiles, retryConnect, savedProfile, targetProfileId]);

  const servicesValue = useMemo<ServiceManagementApi>(() => ({
    services,
    version,
    available,
    target,
    machines,
    unavailableReason,
    loadFailed,
    isRefreshing,
    isSaving,
    refresh,
    save,
    remove,
    selectMachine,
    activateTarget,
  }), [activateTarget, available, isRefreshing, isSaving, loadFailed, machines, refresh, remove, save, selectMachine, services, target, unavailableReason, version]);

  return { servicesValue };
}
