import { useLayoutEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { AppState } from 'react-native';

import type { OpencodeConnectionSettings } from '@/shared/protocol/opencode/client';
import { createConnection } from '@/runtime/connections/create-connection';
import { useAppCore } from '@/runtime/core';
import type { ConnectSetup } from '@/shared/contracts/cloud-link-setup';
import { useQueryForeground } from '@/shared/server-data/client';

// i18next's TFunction no longer accepts a plain options record, and the protocol
// layer must not type itself against i18next generics, so adapt at this boundary.
function connectionTranslator(t: TFunction) {
  return (key: string, options?: Record<string, unknown>): string =>
    (options ? t(key, options as never) : t(key)) as string;
}

export function useConnectionRegistryBinding(setup: ConnectSetup, updateSettings: (id: string, settings: OpencodeConnectionSettings) => void, hydrated: boolean) {
  const { connections } = useAppCore();
  const { t } = useTranslation();
  const { phase, prepareSettings } = setup;
  useLayoutEffect(() => {
    connections.setForeground(AppState.currentState === 'active');
    const subscription = AppState.addEventListener('change', (state) => connections.setForeground(state === 'active'));
    return () => { subscription.remove(); connections.dispose(); };
  }, [connections]);
  useLayoutEffect(() => {
    connections.configure({ setup: { phase, prepareSettings }, translate: connectionTranslator(t), hydrated, updateSettings, createManager: createConnection });
  }, [connections, hydrated, phase, prepareSettings, t, updateSettings]);
}

export function useConnectionDemand(activeId: string | undefined) {
  const { connections } = useAppCore();
  const foreground = useQueryForeground();
  useLayoutEffect(() => { connections.setDemand(activeId, foreground); }, [activeId, connections, foreground]);
}
