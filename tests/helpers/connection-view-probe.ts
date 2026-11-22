import { createElement, type PropsWithChildren } from 'react';

import { CURRENT_ONBOARDING_VERSION } from '@/features/onboarding/model/onboarding-state';
import { UpdatesContext } from '@/features/updates/context';
import type { UpdatesContextValue } from '@/features/updates/model/types';
import { idleConnection } from '@/runtime/connections/idle-connection';
import { AppCoreProvider } from '@/runtime/core/context';
import type { AppCore } from '@/runtime/core/create-app-core';
import { createAppStore } from '@/runtime/core/store';
import { WorkspaceContext, type WorkspaceRegistry } from '@/runtime/workspace/workspace-context';
import { defaultChatPreferences } from '@/shared/preferences/opencode-preferences';

export function connectionViewProbe(controls: WorkspaceRegistry['connectionControls'], bootCompleted = false) {
  const store = createAppStore({
    settings: { serverUrl: '', username: '', password: '', directory: '' },
    chatPreferences: defaultChatPreferences, controlPlaneUrl: '',
  });
  if (bootCompleted) {
    store.getState().setRegistry({ ready: true });
    store.getState().setShellValue('onboardingVersion', CURRENT_ONBOARDING_VERSION);
  }
  const core = {
    store,
    connections: { subscribeState: () => () => {}, getLifecycle: () => idleConnection },
    commands: { connection: {} },
  } as unknown as AppCore;
  const registry = { connectionControls: controls } as WorkspaceRegistry;
  const updates = { block: () => () => {} } as UpdatesContextValue;
  return function Wrapper({ children }: PropsWithChildren) {
    return createElement(AppCoreProvider, { core },
      createElement(WorkspaceContext.Provider, { value: registry },
        createElement(UpdatesContext.Provider, { value: updates }, children)));
  };
}
