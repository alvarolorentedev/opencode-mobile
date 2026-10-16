import { useCallback, useMemo, useState } from 'react';

import {
  deleteManagedService,
  listManagedServices,
  putManagedService,
  type ManagedService,
  type OpencodeConnectionSettings,
  type ServiceInput,
} from '@/lib/opencode/client';
import type { ServiceManagementApi } from '@/providers/opencode-provider-types';

// Remote connector service management state. The list lives here (not in the
// settings screen) so a connector-side edit never leaves stale UI across a
// reopen, and every mutation re-lists the connector's canonical values.
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
  const [state, setState] = useState<{ scope: string; services: ManagedService[] }>({ scope: scopeKey, services: [] });
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Derived value resets to empty the moment the scope changes, before any
  // fetch runs, so a previous machine's services never leak into the new one.
  const services = useMemo(
    () => (state.scope === scopeKey ? state.services : []),
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
      const next = await listManagedServices(settings);
      if (scopeGenerationRef.current === generation) setState({ scope: scopeKey, services: next });
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
    available: Boolean(settings.connect),
    isRefreshing,
    isSaving,
    refresh,
    save,
    remove,
  }), [isRefreshing, isSaving, refresh, remove, save, services, settings.connect]);

  return { servicesValue };
}
