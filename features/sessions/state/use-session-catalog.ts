import { useCallback, useMemo, type Dispatch, type SetStateAction } from 'react';
import { skipToken, useQuery, useQueryClient } from '@tanstack/react-query';

import { useQueryIdentity } from '@/shared/server-data/client';
import type { ScopedOpencodeClient } from '@/shared/protocol/opencode/client';
import type { Session, SessionStatus } from '@/shared/protocol/opencode/types';

import { projectSessionsKey, projectSessionsOptions, sessionCatalogKey, type SessionCatalogData } from '../services/queries';

const EMPTY_SESSIONS: Session[] = [];
const EMPTY_STATUSES: Record<string, SessionStatus> = {};

// Query-backed view of one project's session list plus the connection-wide
// status map. The setters keep the action layer's existing contract while the
// cache becomes the only copy.
export function useSessionCatalog(client: ScopedOpencodeClient) {
  const { connectionId, connectionScope, authRevision } = useQueryIdentity();
  const identity = useMemo(() => ({ connectionId, connectionScope, authRevision }), [authRevision, connectionId, connectionScope]);
  const queryClient = useQueryClient();
  const sessionsKey = useMemo(() => projectSessionsKey(identity, client), [client, identity]);
  const contract = client.__opencode.contract;
  const catalogKey = useMemo(() => sessionCatalogKey(identity, contract), [contract, identity]);
  const sessionsQuery = useQuery(projectSessionsOptions(identity, client));
  // The connection owner fetches the catalog; this observer only reads it and
  // re-renders when events or the owner publish a new snapshot.
  const catalogQuery = useQuery<SessionCatalogData>({ queryKey: catalogKey, queryFn: skipToken });
  const sessions = sessionsQuery.data ?? EMPTY_SESSIONS;
  const sessionStatuses = catalogQuery.data?.statuses ?? EMPTY_STATUSES;

  const sessionsRef = useMemo(() => ({ get current() { return queryClient.getQueryData<Session[]>(sessionsKey) ?? EMPTY_SESSIONS; } }), [queryClient, sessionsKey]);

  const setSessions = useCallback<Dispatch<SetStateAction<Session[]>>>((value) => {
    queryClient.setQueryData<Session[]>(sessionsKey, (current) => {
      const previous = current ?? EMPTY_SESSIONS;
      return typeof value === 'function' ? value(previous) : value;
    });
  }, [queryClient, sessionsKey]);

  const setSessionStatuses = useCallback<Dispatch<SetStateAction<Record<string, SessionStatus>>>>((value) => {
    queryClient.setQueryData<SessionCatalogData>(catalogKey, (current) => {
      const previous = current?.statuses ?? EMPTY_STATUSES;
      return {
        sessions: current?.sessions ?? EMPTY_SESSIONS,
        statuses: typeof value === 'function' ? value(previous) : value,
      };
    });
  }, [queryClient, catalogKey]);

  return { sessions, sessionsRef, sessionStatuses, setSessions, setSessionStatuses };
}

export type SessionCatalog = ReturnType<typeof useSessionCatalog>;
