import { useState, type PropsWithChildren } from 'react';

import { ServerDataProvider } from '@/shared/server-data/client';
import { AppCoreProvider } from '@/runtime/core/context';
import { createAppCore } from '@/runtime/core/create-app-core';
import { WorkspaceProvider } from '@/runtime/workspace/workspace-provider';

export function OpencodeProvider({ children }: PropsWithChildren) {
  const [core] = useState(createAppCore);
  return (
    <AppCoreProvider core={core}>
      <ServerDataProvider client={core.queryClient}>
        <WorkspaceProvider>{children}</WorkspaceProvider>
      </ServerDataProvider>
    </AppCoreProvider>
  );
}
