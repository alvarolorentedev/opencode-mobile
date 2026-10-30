import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { getConnectCredentialError } from '@/lib/connect';
import { findMatchingProfile, getProfilePassword, type ConnectionProfile } from '@/lib/connection-profiles';
import {
  deleteManagedService,
  getServiceManagementVersion,
  listManagedServices,
  putManagedService,
  ServiceManagementError,
  type ManagedService,
  type OpencodeConnectionSettings,
  type ServiceInput,
  type ServiceManagementVersion,
} from '@/lib/opencode/client';
import type {
  ServiceManagementApi,
  ServiceManagementTarget,
  ServiceManagementUnavailableReason,
} from '@/providers/opencode-provider-types';
import { buildServiceMachines, chooseServiceTarget } from '@/providers/services-target';
import type { ConnectSetup } from '@/providers/use-connect-state';

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

function scopeOf(settings: OpencodeConnectionSettings) {
  return `${settings.serverUrl}\u0000${settings.username}`;
}

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
  scopeGenerationRef,
}: {
  settings: OpencodeConnectionSettings;
  connectSetup: ConnectSetup;
  scopeGenerationRef: { current: number };
}) {
  const profiles = connectSetup.profiles;
  const { connectProfile, retry: retryConnect, savedProfile } = connectSetup;
  const preferredProfileId = savedProfile?.connect ? savedProfile.id : undefined;
  const environmentUrl = settings.connect?.controlPlaneUrl ?? connectSetup.controlPlaneUrl;
  const [selectedProfileId, setSelectedProfileId] = useState<string>();
  const [profileAccess, setProfileAccess] = useState<{ profileId: string; password: string }>();
  const [list, setList] = useState<{ scope: string; services: ManagedService[]; version?: ServiceManagementVersion }>({ scope: '', services: [] });
  const [credentialFailureScope, setCredentialFailureScope] = useState<string>();
  const [loadFailureScope, setLoadFailureScope] = useState<string>();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const requested = useRef(false);
  const refreshedScope = useRef<string | undefined>(undefined);

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
      if (!cancelled) setProfileAccess({ profileId: profile.id, password });
    }, () => {
      // A failed SecureStore read degrades to an expired target.
      if (!cancelled) setProfileAccess({ profileId: profile.id, password: '' });
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

  const scopeKey = resolution.status === 'ready' ? scopeOf(resolution.settings) : undefined;
  // A rotated credential is a different fetch target even when the origin and
  // device id are unchanged, so recovery re-lists without an explicit tap.
  const targetIdentity = scopeKey && resolution.status === 'ready' ? `${scopeKey}\u0000${resolution.settings.password}` : undefined;

  // Derived values reset to empty the moment the target changes, before any
  // fetch runs, so a previous machine's services never leak into the new one.
  const services = useMemo(() => (scopeKey && list.scope === scopeKey ? list.services : []), [list, scopeKey]);
  const version = useMemo(() => (scopeKey && list.scope === scopeKey ? list.version : undefined), [list, scopeKey]);
  const credentialFailure = Boolean(scopeKey && credentialFailureScope === scopeKey);
  const loadFailed = Boolean(scopeKey && loadFailureScope === scopeKey);
  const available = resolution.status === 'ready' && !credentialFailure;
  const unavailableReason: ServiceManagementUnavailableReason | undefined = resolution.status === 'none'
    ? 'no-cloud-link-machine'
    : resolution.status === 'expired' || credentialFailure ? 'credentials-expired' : undefined;
  const target = resolution.status === 'ready' || resolution.status === 'expired' ? resolution.target : undefined;
  const machines = useMemo(() => buildServiceMachines(profiles, settings.connect?.machineId, environmentUrl), [environmentUrl, profiles, settings.connect?.machineId]);

  const refresh = useCallback(async () => {
    requested.current = true;
    if (resolution.status !== 'ready') return;
    const { settings: targetSettings } = resolution;
    const scope = scopeOf(targetSettings);
    const generation = scopeGenerationRef.current;
    setIsRefreshing(true);
    try {
      // A failed version probe must not hide a valid list: pre-version
      // connectors answer 404 (handled inside), transient failures keep the
      // last known revision.
      const [next, nextVersion] = await Promise.all([
        listManagedServices(targetSettings),
        getServiceManagementVersion(targetSettings).catch(() => undefined),
      ]);
      if (scopeGenerationRef.current === generation) {
        setList((current) => ({
          scope,
          services: next,
          version: nextVersion ?? (current.scope === scope ? current.version : undefined),
        }));
        setCredentialFailureScope((current) => (current === scope ? undefined : current));
        setLoadFailureScope((current) => (current === scope ? undefined : current));
      }
    } catch (error) {
      // A rejected list must not surface as an unhandled error. A credential
      // rejection becomes an explicit expired state; other failures keep the
      // empty list but expose a Retry action instead of stale entries.
      if (scopeGenerationRef.current === generation) {
        setList({ scope, services: [] });
        if (error instanceof ServiceManagementError && error.status === 401) {
          setCredentialFailureScope(scope);
          setLoadFailureScope((current) => (current === scope ? undefined : current));
        } else setLoadFailureScope(scope);
      }
    } finally {
      // A stale result was discarded; allow the surface to re-fetch once the
      // active scope settles instead of leaving a transient gap.
      if (scopeGenerationRef.current !== generation) refreshedScope.current = undefined;
      setIsRefreshing(false);
    }
  }, [resolution, scopeGenerationRef]);

  // Re-fetch when the resolved target changes after the surface asked for data
  // once. Keeps the section's open-time refresh working while the password
  // resolution finishes asynchronously, and after a credential rotation.
  useEffect(() => {
    if (!targetIdentity) {
      refreshedScope.current = undefined;
      return;
    }
    if (!requested.current || refreshedScope.current === targetIdentity) return;
    refreshedScope.current = targetIdentity;
    void refresh();
  }, [refresh, targetIdentity]);

  const save = useCallback(async (id: string, input: ServiceInput) => {
    if (resolution.status !== 'ready') throw new Error('Connect a Cloud Link machine before managing services.');
    const generation = scopeGenerationRef.current;
    setIsSaving(true);
    try {
      const saved = await putManagedService(resolution.settings, id, input);
      if (scopeGenerationRef.current === generation) await refresh();
      return saved;
    } finally {
      setIsSaving(false);
    }
  }, [refresh, resolution, scopeGenerationRef]);

  const remove = useCallback(async (id: string) => {
    if (resolution.status !== 'ready') throw new Error('Connect a Cloud Link machine before managing services.');
    const generation = scopeGenerationRef.current;
    setIsSaving(true);
    try {
      await deleteManagedService(resolution.settings, id);
      if (scopeGenerationRef.current === generation) await refresh();
    } finally {
      setIsSaving(false);
    }
  }, [refresh, resolution, scopeGenerationRef]);

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
