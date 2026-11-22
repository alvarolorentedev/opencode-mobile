import { useInfiniteQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useMemo, useSyncExternalStore } from 'react';

import type { SessionMessageRecord } from '@/shared/presentation/format';
import type { ScopedOpencodeClient } from '@/shared/protocol/opencode/client';
import type { QueryIdentity } from '@/shared/server-data/keys';

import { transcriptPrefix } from '../services/queries';
import { transcriptAccess, transcriptRecords, transcriptWindow, type TranscriptData } from '../services/transcript-queries';

const EMPTY: Record<string, SessionMessageRecord[]> = {};
const RECENT_SESSION_LIMIT = 3;

function observeRecentTranscripts(cache: QueryClient, identity: QueryIdentity, client: ScopedOpencodeClient, currentSessionId?: string, conversationSessionId?: string) {
  const prefix = transcriptPrefix(identity, client);
  const queryCache = cache.getQueryCache();
  let snapshot = EMPTY;
  let dirty = true;
  return {
    getSnapshot() {
      if (!dirty) return snapshot;
      dirty = false;
      const scoped = queryCache.findAll({ queryKey: prefix }).filter(({ state, queryKey }) =>
        state.data && queryKey[prefix.length] !== currentSessionId);
      const records: typeof EMPTY = {};
      const conversation = scoped.find(({ queryKey }) => queryKey[prefix.length] === conversationSessionId);
      const queries = scoped.filter((query) => query !== conversation)
        .sort((a, b) => b.state.dataUpdatedAt - a.state.dataUpdatedAt).slice(0, RECENT_SESSION_LIMIT);
      if (conversation) queries.push(conversation);
      for (const query of queries) records[String(query.queryKey[prefix.length])] = transcriptRecords(query.state.data as TranscriptData);
      const ids = Object.keys(records);
      if (ids.length !== Object.keys(snapshot).length || ids.some((id) => records[id] !== snapshot[id])) snapshot = records;
      return snapshot;
    },
    subscribe(listener: () => void) {
      dirty = true;
      return queryCache.subscribe(({ type, query }) => {
        if ((type === 'updated' || type === 'removed') && query.queryKey.length === prefix.length + 1
          && prefix.every((part, index) => query.queryKey[index] === part)) {
          dirty = true;
          listener();
        }
      });
    },
  };
}

export function useTranscriptQueries(identity: QueryIdentity, client: ScopedOpencodeClient, currentSessionId?: string, conversationSessionId?: string) {
  const cache = useQueryClient();
  const access = useMemo(() => transcriptAccess(cache, identity, client), [cache, client, identity]);

  // The lifecycle reads the initial page or bounded tail explicitly. Enabling
  // automatic refetch here would reload every retained page on foreground.
  const { data } = useInfiniteQuery({
    ...access.options(currentSessionId ?? ''), enabled: false, notifyOnChangeProps: ['data'],
  });
  const recent = useMemo(() => observeRecentTranscripts(cache, identity, client, currentSessionId, conversationSessionId),
    [cache, client, conversationSessionId, currentSessionId, identity]);
  const recentMessages = useSyncExternalStore(recent.subscribe, recent.getSnapshot, recent.getSnapshot);
  const messagesBySession = useMemo(() =>
    currentSessionId && data ? { ...recentMessages, [currentSessionId]: transcriptRecords(data) } : recentMessages,
  [currentSessionId, data, recentMessages]);
  const messageWindows = useMemo(() => {
    const window = transcriptWindow(data);
    return currentSessionId && window ? { [currentSessionId]: window } : {};
  }, [currentSessionId, data]);

  return { access, messagesBySession, messageWindows };
}
