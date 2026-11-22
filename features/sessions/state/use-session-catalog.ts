import type { QueryIdentity } from '@/shared/server-data/keys';
import { useMemo, useSyncExternalStore } from 'react';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';

import type { ScopedOpencodeClient } from '@/shared/protocol/opencode/client';

import { projectSessionsOptions, type SessionCatalogData } from '../services/queries';
import { EMPTY_SESSIONS, EMPTY_STATUSES, sessionCatalogAccess } from '../services/session-catalog-access';

function observeStatuses(cache: QueryClient, key: readonly unknown[]) {
  return {
    read: () => cache.getQueryData<SessionCatalogData>(key)?.statuses ?? EMPTY_STATUSES,
    subscribe(listener: () => void) {
      return cache.getQueryCache().subscribe(({ query: { queryKey }, type }) => {
        if ((type === 'updated' || type === 'removed') && queryKey.length === key.length
          && key.every((part, index) => part === queryKey[index])) listener();
      });
    },
  };
}

export function useSessionCatalog(identity: QueryIdentity, client: ScopedOpencodeClient) {
  const cache = useQueryClient();
  const writer = useMemo(() => sessionCatalogAccess(cache, identity, client), [cache, client, identity]);
  const sessionsQuery = useQuery(projectSessionsOptions(identity, client));
  // A project observes the shared catalog without replacing the connection's
  // fetch options. Connection demand can refetch that catalog at any time.
  const statuses = useMemo(() => observeStatuses(cache, writer.catalogKey), [cache, writer.catalogKey]);
  const sessionStatuses = useSyncExternalStore(statuses.subscribe, statuses.read, statuses.read);
  const sessionsRef = useMemo(() => ({ get current() { return writer.readSessions(); } }), [writer]);

  return {
    sessions: sessionsQuery.data ?? EMPTY_SESSIONS,
    sessionsRef,
    sessionStatuses,
    setSessions: writer.setSessions,
    setSessionStatuses: writer.setSessionStatuses,
  };
}

export type SessionCatalog = ReturnType<typeof useSessionCatalog>;
