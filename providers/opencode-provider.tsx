import type { PropsWithChildren } from 'react';

import { ServerDataProvider } from '@/providers/queries/client';
import { WorkspaceProvider } from '@/providers/workspace-provider';

export type {
AgentOption,
ChatPreferences,
ConversationConfirmationState,
ConversationInputPhase,
ConversationPhase,
ConversationReadbackEntry,
ConversationReadbackPhase,
ModelOption,
ProviderAuthMethod,
ProviderAuthPrompt,
ProviderAuthValues,
ProviderOption,
ResponseScope
} from '@/providers/opencode-provider-types';

export function OpencodeProvider({ children }: PropsWithChildren) {
  return <ServerDataProvider><WorkspaceProvider>{children}</WorkspaceProvider></ServerDataProvider>;
}
