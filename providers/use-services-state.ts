import { useCallback, useMemo, useState } from 'react';

import {
  deleteManagedService,
  getServiceManagementVersion,
  listManagedServices,
  putManagedService,
  type ManagedService,
  type OpencodeConnectionSettings,
  type ServiceInput,
  type ServiceManagementVersion,
} from '@/lib/opencode/client';
import type { ServiceManagementApi } from '@/providers/opencode-provider-types';

// Remote connector service management state. The list and the connector's
// management revision live here (not in the settings screen) so a
// connector-side edit never leaves stale UI across a reopen, and every mutation
// re-lists the connector's canonical values.
//
// State is keyed by connection scope: when the connection changes, the derived
// `services` value resets without an effect, and in-flight results from the old
// scope are dropped via `scopeGenerationRef`.
export function useServicesState({
  settings,
  scopeGenerationRef,
}: {
  settings: OpencodeConnectionSettings;
  scopeGenerationRef: { current: number };
}) {
  const scopeKey = `${settings.serverUrl}\u0000${settings.username}`;
  const [state, setState] = useState<{ scope: string; services: ManagedService[]; version?: ServiceManagementVersion }>({ scope: scopeKey, services: [] });
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Derived value resets to empty the moment the scope changes, before any
  // fetch runs, so a previous machine's services never leak into the new one.
  const services = useMemo(
    () => (state.scope === scopeKey ? state.services : []),
    [scopeKey, state],
  );
  const version = useMemo(
    () => (state.scope === scopeKey ? state.version : undefined),
    [scopeKey, state],
  );

  const refresh = useCallback(async () => {
    if (!settings.connect) {
      setState({ scope: scopeKey, services: [] });
      return;
    }
    const generation = scopeGenerationRef.current;
    setIsRefreshing(true);
    try {
      // A failed version probe must not hide a valid list: pre-version
      // connectors answer 404 (handled inside), transient failures keep the
      // last known revision.
      const [next, nextVersion] = await Promise.all([
        listManagedServices(settings),
        getServiceManagementVersion(settings).catch(() => undefined),
      ]);
      if (scopeGenerationRef.current === generation) {
        setState((current) => ({
          scope: scopeKey,
          services: next,
          version: nextVersion ?? (current.scope === scopeKey ? current.version : undefined),
        }));
      }
    } catch {
      // A rejected list (for example a connector that rejects the device
      // credentials) must not surface as an unhandled error from a background
      // refresh; keep the section usable and show no stale entries.
      if (scopeGenerationRef.current === generation) {
        setState((current) => ({ scope: scopeKey, services: [], version: current.scope === scopeKey ? current.version : undefined }));
      }
    } finally {
      setIsRefreshing(false);
    }
  }, [scopeGenerationRef, scopeKey, settings]);

  const save = useCallback(async (id: string, input: ServiceInput) => {
    const generation = scopeGenerationRef.current;
    setIsSaving(true);
    try {
      const saved = await putManagedService(settings, id, input);
      if (scopeGenerationRef.current === generation) await refresh();
      return saved;
    } finally {
      setIsSaving(false);
    }
  }, [refresh, scopeGenerationRef, settings]);

  const remove = useCallback(async (id: string) => {
    const generation = scopeGenerationRef.current;
    setIsSaving(true);
    try {
      await deleteManagedService(settings, id);
      if (scopeGenerationRef.current === generation) await refresh();
    } finally {
      setIsSaving(false);
    }
  }, [refresh, scopeGenerationRef, settings]);

  const servicesValue = useMemo<ServiceManagementApi>(() => ({
    services,
    version,
    available: Boolean(settings.connect),
    isRefreshing,
    isSaving,
    refresh,
    save,
    remove,
  }), [isRefreshing, isSaving, refresh, remove, save, services, settings.connect, version]);

  return { servicesValue };
}
