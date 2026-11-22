import type { AppCore } from '@/runtime/core';
import type { ScopedOpencodeClient } from '@/shared/protocol/opencode/client';
import type { QueryIdentity } from '@/shared/server-data/keys';

import { recordSessionUsageAndTodos } from '../model/session-ledger';
import { createLiveTranscript } from './live-transcript-controller';
import { liveTranscriptPartition } from './queries';
import { createTranscriptLifecycle } from './transcript-lifecycle';
import { createTranscriptMetadata } from './transcript-metadata';
import { transcriptAccess } from './transcript-queries';
import { createTranscriptReader } from './transcript-reader';

export function createProjectTranscript({ store, queryClient, clock }: Pick<AppCore, 'store' | 'queryClient' | 'clock'>, {
  identity, scopeKey, client, isCurrentClient, activeProjectPath,
}: {
  identity: QueryIdentity;
  scopeKey: string;
  client: ScopedOpencodeClient;
  isCurrentClient: (candidate: object) => boolean;
  activeProjectPath?: string;
}) {
  const access = transcriptAccess(queryClient, identity, client);
  const metadata = createTranscriptMetadata(queryClient, identity, client);
  const { setUsageStepsBySession, setTodoRecordsBySession } = metadata;
  const recordUsage: Parameters<typeof createLiveTranscript>[0]['recordUsageAndTodos'] = (id, records) =>
    recordSessionUsageAndTodos(id, records, setUsageStepsBySession, setTodoRecordsBySession);
  const live = createLiveTranscript({
    store, clock, scopeKey, partition: liveTranscriptPartition(identity, client), client,
    isCurrentClient, readCanonicalSession: access.read, recordUsageAndTodos: recordUsage,
  });
  const readDisplayedSession = (sessionId: string) => live.overlay(sessionId, access.read(sessionId));
  const lifecycle = createTranscriptLifecycle({
    store, access, live, metadata, scopeKey, client, connectionScope: identity.connectionScope, activeProjectPath,
    isCurrentClient, setIsRefreshingMessages: (isRefreshingMessages) => {
      if (isCurrentClient(client)) store.getState().setChat(scopeKey, { isRefreshingMessages });
    },
    recordUsageAndTodos: recordUsage, readDisplayedSession,
  });

  const reader = createTranscriptReader(store, { scopeKey, client, isCurrentClient, refreshMessages: lifecycle.refreshMessages });

  return {
    ...lifecycle,
    readMessages: reader.readMessages, readDisplayedSession,
    applyEvent: live.applyEvent,
    activeMessageId: live.activeMessageId,
    appendUserMessage: live.appendUserMessage,
    isLocalSendRecent: live.isLocalSendRecent,
    dispose() {
      lifecycle.dispose();
      live.dispose();
      reader.reset();
    },
  };
}
