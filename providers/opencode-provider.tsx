import type { PropsWithChildren } from 'react';

import { WorkspaceProvider } from '@/providers/workspace-provider';

export type {
  AgentOption,
  ChatPreferences,
  ConversationPhase,
  ModelOption,
  ProviderAuthMethod,
  ProviderAuthPrompt,
  ProviderAuthValues,
  ProviderOption,
  ReasoningLevel,
  ResponseScope,
} from '@/providers/opencode-provider-types';

export function OpencodeProvider({ children }: PropsWithChildren) {
  return <WorkspaceProvider>{children}</WorkspaceProvider>;
}
