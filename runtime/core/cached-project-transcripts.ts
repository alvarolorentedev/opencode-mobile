import { useMemo, useSyncExternalStore } from 'react';
import { useShallow } from 'zustand/react/shallow';

import type { SessionMessageRecord } from '@/shared/presentation/format';
import type { ScopedOpencodeClient } from '@/shared/protocol/opencode/client';
import type { QueryIdentity } from '@/shared/server-data/keys';

import { useAppCore, useAppStore } from './context';
import type { AppCore } from './create-app-core';

type Source = { scopeKey: string; identity: QueryIdentity; client: ScopedOpencodeClient };
type SessionRecords = Record<string, SessionMessageRecord[]>;

function observeCachedTranscripts(
  queryCache: ReturnType<AppCore['queryClient']['getQueryCache']>,
  readers: ReturnType<AppCore['transcripts']>[],
  sessionIds: (string | undefined)[],
) {
  const prefixes = readers.map(({ prefix }) => prefix);
  let snapshot: SessionRecords[] = [];
  let dirty = true;
  return {
    read() {
      if (!dirty) return snapshot;
      dirty = false;
      snapshot = readers.map(({ read }, index) => read(sessionIds[index * 2], sessionIds[index * 2 + 1]));
      return snapshot;
    },
    subscribe(listener: () => void) {
      if (!prefixes.length) return () => {};
      dirty = true;
      return queryCache.subscribe(({ type, query: { queryKey } }) => {
        if ((type === 'updated' || type === 'removed') && prefixes.some((prefix) => queryKey.length === prefix.length + 1
          && prefix.every((part, index) => part === queryKey[index]))) {
          dirty = true;
          listener();
        }
      });
    },
  };
}

export function useCachedProjectTranscripts(sources: readonly Source[]) {
  const { queryClient, store, transcripts } = useAppCore();
  const queryCache = queryClient.getQueryCache();
  const sessionIds = useAppStore(useShallow((state) => sources.flatMap(({ scopeKey }) => [
    state.selection[scopeKey]?.currentSessionId, state.conversation[scopeKey]?.sessionId,
  ])));
  const paints = useAppStore(useShallow((state) => sources.map(({ scopeKey }) => state.transcriptUi[scopeKey]?.paintRevision)));
  const readers = useMemo(() => sources.map(({ identity, client }) => transcripts(identity, client)), [sources, transcripts]);
  const records = useMemo(() => observeCachedTranscripts(queryCache, readers, sessionIds), [queryCache, readers, sessionIds]);
  const canonical = useSyncExternalStore(records.subscribe, records.read, records.read);
  return useMemo(() => sources.map(({ scopeKey }, index) => readers[index].display(
    paints[index] ? store.getState().transcriptLive.get(scopeKey) : undefined, canonical[index],
  )), [canonical, paints, readers, sources, store]);
}
