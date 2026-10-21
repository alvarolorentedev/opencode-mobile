import type { PropsWithChildren } from 'react';

import { WorkspaceProvider } from '@/providers/workspace-provider';

export type {
  AgentOption,
  ChatPreferences,
  ConnectionState,
  ConversationPhase,
  ConversationState,
  DiffScope,
  DiffTurn,
  FavoriteSession,
  ModelOption,
  OpencodeContextValue,
  OpencodeProject,
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
