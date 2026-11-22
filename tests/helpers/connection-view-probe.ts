import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { onTestFinished } from 'vitest';
import { createElement, type PropsWithChildren } from 'react';

import { CURRENT_ONBOARDING_VERSION } from '@/features/onboarding/model/onboarding-state';
import { UpdatesContext } from '@/features/updates/context';
import type { UpdatesContextValue } from '@/features/updates/model/types';
import { idleConnection } from '@/runtime/connections/idle-connection';
import { AppCoreProvider } from '@/runtime/core/context';
import type { AppCore } from '@/runtime/core/create-app-core';
import { createAppStore, type AppStore } from '@/runtime/core/store';
import { WorkspaceContext, type WorkspaceRegistry } from '@/runtime/workspace/workspace-context';
import { defaultChatPreferences } from '@/shared/preferences/opencode-preferences';

export function connectionViewProbe(controls: WorkspaceRegistry['connectionControls'], bootCompleted = false,
  options: { initialize?: (store: AppStore) => void; sharedInput?: WorkspaceRegistry['sharedInput'] } = {}) {
  const store = createAppStore({
    settings: { serverUrl: '', username: '', password: '', directory: '' },
    chatPreferences: defaultChatPreferences, controlPlaneUrl: '',
  });
  if (bootCompleted) {
    store.getState().setRegistry({ ready: true });
    store.getState().setShellValue('onboardingVersion', CURRENT_ONBOARDING_VERSION);
  }
  options.initialize?.(store);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  onTestFinished(() => queryClient.clear());
  const core = {
    store, queryClient,
    connections: { subscribeState: () => () => {}, getLifecycle: () => idleConnection,
      subscribe: () => () => {}, get: () => undefined },
    commands: { connection: {}, workspace: {} },
  } as unknown as AppCore;
  const registry = { connectionControls: controls, sharedInput: options.sharedInput } as WorkspaceRegistry;
  const updates = { block: () => () => {} } as UpdatesContextValue;
  return function Wrapper({ children }: PropsWithChildren) {
    return createElement(AppCoreProvider, { core },
      createElement(WorkspaceContext.Provider, { value: registry },
        createElement(UpdatesContext.Provider, { value: updates },
          createElement(QueryClientProvider, { client: queryClient }, children))));
  };
}
