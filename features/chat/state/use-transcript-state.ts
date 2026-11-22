import { useCallback, useEffect, useMemo, type Dispatch, type SetStateAction } from 'react';

import { useAppCore, useAppStore } from '@/runtime/core';
import type { SessionMessageRecord } from '@/shared/presentation/format';
import type { ScopedOpencodeClient } from '@/shared/protocol/opencode/client';
import { liveTranscriptPartition } from '@/features/chat/services/queries';
import { recordSessionUsageAndTodos } from '@/features/chat/model/session-ledger';
import { useLiveTranscript } from '@/features/chat/state/use-live-transcript';
import { useTranscriptMetadata } from '@/features/chat/state/use-transcript-metadata';
import { useTranscriptQueries } from '@/features/chat/state/use-transcript-queries';
import type { QueryIdentity } from '@/shared/server-data/keys';
import { createTranscriptLifecycle } from '@/features/chat/services/transcript-lifecycle';

const EMPTY_FLAGS: Record<string, boolean> = {};

// Coordinates transcript reads and keeps usage and plan ledgers across paging.
export function useTranscriptState({
  identity,
  scopeKey,
  client,
  isCurrentClient,
  currentSessionId,
  connectionScope,
  activeProjectPath,
  setIsRefreshingMessages,
}: {
  identity: QueryIdentity;
  scopeKey: string;
  client: ScopedOpencodeClient;
  isCurrentClient: (candidate: object) => boolean;
  currentSessionId?: string;
  connectionScope: string;
  activeProjectPath?: string;
  setIsRefreshingMessages: Dispatch<SetStateAction<boolean>>;
}) {
  const { store } = useAppCore();
  const loadingOlderBySession = useAppStore((state) => state.transcriptUi[scopeKey]?.loadingOlderBySession ?? EMPTY_FLAGS);
  const hydratingSessionIds = useAppStore((state) => state.transcriptUi[scopeKey]?.hydratingSessionIds ?? EMPTY_FLAGS);
  const conversationSessionId = useAppStore((state) => state.conversation[scopeKey]?.sessionId);
  const { access, messagesBySession, messageWindows } = useTranscriptQueries(identity, client, currentSessionId, conversationSessionId);
  const { read: readCanonicalSession } = access;
  const { usageStepsBySession, setUsageStepsBySession, todoRecordsBySession, setTodoRecordsBySession } = useTranscriptMetadata(identity, client);
  const recordUsageAndTodos = useCallback((sessionId: string, records: SessionMessageRecord[]) => {
    recordSessionUsageAndTodos(sessionId, records, setUsageStepsBySession, setTodoRecordsBySession);
  }, [setTodoRecordsBySession, setUsageStepsBySession]);

  const { actions: live, displayedMessages, readDisplayedSession } = useLiveTranscript({
    scopeKey,
    partition: liveTranscriptPartition(identity, client),
    client,
    isCurrentClient,
    messagesBySession,
    readCanonicalSession,
    recordUsageAndTodos,
  });
  const metadata = useMemo(() => ({ setUsageStepsBySession, setTodoRecordsBySession }), [setTodoRecordsBySession, setUsageStepsBySession]);
  const lifecycle = useMemo(() => createTranscriptLifecycle({
    store, access, live, metadata, scopeKey, client, connectionScope, activeProjectPath, isCurrentClient,
    setIsRefreshingMessages, recordUsageAndTodos, readDisplayedSession,
  }), [access, activeProjectPath, client, connectionScope, isCurrentClient, live, metadata, readDisplayedSession, recordUsageAndTodos,
    scopeKey, setIsRefreshingMessages, store]);
  useEffect(() => lifecycle.dispose, [lifecycle]);
  useEffect(() => {
    let left = false;
    lifecycle.hydrate(currentSessionId, () => !left);
    return () => { left = true; };
  }, [currentSessionId, lifecycle]);

  return {
    messagesBySession: displayedMessages,
    readDisplayedSession,
    messageWindows,
    loadingOlderBySession,
    hydratingSessionIds,
    beginHydration: lifecycle.beginHydration,
    usageStepsBySession,
    todoRecordsBySession,
    refreshMessages: lifecycle.refreshMessages,
    applyTranscriptEvent: live.applyEvent,
    liveTranscriptMessageId: live.activeMessageId,
    appendUserMessage: live.appendUserMessage,
    isLocalSendRecent: live.isLocalSendRecent,
    loadOlderMessages: lifecycle.loadOlderMessages,
    reset: lifecycle.reset,
    prune: lifecycle.prune,
  };
}
