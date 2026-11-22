import { useMemo } from 'react';
import { skipToken, useQuery, useQueryClient } from '@tanstack/react-query';

import { useQueryIdentity } from '@/shared/server-data/client';
import type { ScopedOpencodeClient } from '@/shared/protocol/opencode/client';

import { projectSessionsOptions, type SessionCatalogData } from '../services/queries';
import { EMPTY_SESSIONS, EMPTY_STATUSES, sessionCatalogAccess } from '../services/session-catalog-access';

export function useSessionCatalog(client: ScopedOpencodeClient) {
  const identity = useQueryIdentity();
  const cache = useQueryClient();
  const writer = useMemo(() => sessionCatalogAccess(cache, identity, client), [cache, client, identity]);
  const sessionsQuery = useQuery(projectSessionsOptions(identity, client));
  const catalogQuery = useQuery<SessionCatalogData>({ queryKey: writer.catalogKey, queryFn: skipToken });
  const sessionsRef = useMemo(() => ({ get current() { return writer.readSessions(); } }), [writer]);

  return {
    sessions: sessionsQuery.data ?? EMPTY_SESSIONS,
    sessionsRef,
    sessionStatuses: catalogQuery.data?.statuses ?? EMPTY_STATUSES,
    setSessions: writer.setSessions,
    setSessionStatuses: writer.setSessionStatuses,
  };
}

export type SessionCatalog = ReturnType<typeof useSessionCatalog>;
