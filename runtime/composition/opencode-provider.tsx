import type { PropsWithChildren } from 'react';

import { ServerDataProvider } from '@/shared/server-data/client';
import { WorkspaceProvider } from '@/runtime/workspace/workspace-provider';

export function OpencodeProvider({ children }: PropsWithChildren) {
  return <ServerDataProvider><WorkspaceProvider>{children}</WorkspaceProvider></ServerDataProvider>;
}
