import type { PropsWithChildren } from 'react';

import { OpencodeProviderTree } from '@/providers/opencode-provider-tree';
import { useOpencodeProviderComposition } from '@/providers/use-opencode-provider-composition';

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
  const { updates, values } = useOpencodeProviderComposition();
  return (
    <OpencodeProviderTree updates={updates} values={values}>
      {children}
    </OpencodeProviderTree>
  );
}
