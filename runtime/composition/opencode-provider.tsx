import { useState, type PropsWithChildren } from 'react';

import { getConnectControlPlanes } from '@/shared/contracts/cloud-link';
import { defaultConnectionSettings } from '@/shared/protocol/opencode/client';
import { defaultChatPreferences } from '@/shared/preferences/opencode-preferences';
import { ServerDataProvider } from '@/shared/server-data/client';
import { AppCoreProvider } from '@/runtime/core/context';
import { createAppCore } from '@/runtime/core/create-app-core';
import { WorkspaceProvider } from '@/runtime/workspace/workspace-provider';

export function OpencodeProvider({ children }: PropsWithChildren) {
  const [core] = useState(() => createAppCore({
    settings: defaultConnectionSettings,
    chatPreferences: defaultChatPreferences,
    controlPlaneUrl: getConnectControlPlanes()[0] ?? '',
  }));
  return (
    <AppCoreProvider core={core}>
      <ServerDataProvider client={core.queryClient}>
        <WorkspaceProvider>{children}</WorkspaceProvider>
      </ServerDataProvider>
    </AppCoreProvider>
  );
}
