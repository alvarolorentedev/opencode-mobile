import type { Dispatch, SetStateAction } from 'react';

import type { SessionMessageRecord } from '@/shared/presentation/format';
import type { FileDiff, SessionStatus, Todo } from '@/shared/protocol/opencode/types';
import { pruneByKeepIds } from '@/shared/utilities/prune';

export type PruneProviderTranscriptsInput = {
  isBootstrappingChat: boolean;
  pendingDeepLinkTargetRef: { current?: { sessionId: string } };
  currentSessionId?: string;
  conversationSessionId?: string;
  recentSessionIds: string[];
  sessionStatuses: Record<string, SessionStatus>;
  setMessagesBySession: Dispatch<SetStateAction<Record<string, SessionMessageRecord[]>>>;
  setDiffsBySession: Dispatch<SetStateAction<Record<string, FileDiff[]>>>;
  setTodosBySession: Dispatch<SetStateAction<Record<string, Todo[]>>>;
  pruneTranscript: (keepIds: Set<string>, limit: number) => void;
};

// Pure enough to test without extracting source text: the effect only decides
// when to call this, while the keep-set and pruning rules stay here.
export function pruneProviderTranscripts({
  isBootstrappingChat,
  pendingDeepLinkTargetRef,
  currentSessionId,
  conversationSessionId,
  recentSessionIds,
  sessionStatuses,
  setMessagesBySession,
  setDiffsBySession,
  setTodosBySession,
  pruneTranscript,
}: PruneProviderTranscriptsInput) {
  if (isBootstrappingChat) return;
  const keepIds = new Set<string>();
  const openingSessionId = pendingDeepLinkTargetRef.current?.sessionId;
  if (openingSessionId) keepIds.add(openingSessionId);
  if (currentSessionId) keepIds.add(currentSessionId);
  if (conversationSessionId) keepIds.add(conversationSessionId);
  for (const id of recentSessionIds) keepIds.add(id);
  for (const [id, status] of Object.entries(sessionStatuses)) {
    if (status.type !== 'idle') keepIds.add(id);
  }

  setMessagesBySession((current) => pruneByKeepIds(current, keepIds, keepIds.size + 1));
  setDiffsBySession((current) => pruneByKeepIds(current, keepIds, keepIds.size + 1));
  setTodosBySession((current) => pruneByKeepIds(current, keepIds, keepIds.size + 1));
  pruneTranscript(keepIds, keepIds.size + 1);
}
