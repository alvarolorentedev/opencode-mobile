import type { QueryClient } from '@tanstack/react-query';

import type { ScopedOpencodeClient } from '@/shared/protocol/opencode/client';
import type { Session, SessionStatus } from '@/shared/protocol/opencode/types';
import type { QueryIdentity } from '@/shared/server-data/keys';

import { projectSessionsKey, sessionCatalogKey, type SessionCatalogData } from './queries';

type Update<T> = T | ((current: T) => T);

export const EMPTY_SESSIONS: Session[] = [];
export const EMPTY_STATUSES: Record<string, SessionStatus> = {};

export function sessionCatalogAccess(cache: QueryClient, identity: QueryIdentity, client: ScopedOpencodeClient) {
  const projectKey = projectSessionsKey(identity, client);
  const catalogKey = sessionCatalogKey(identity, client.__opencode.contract);
  return {
    projectKey,
    catalogKey,
    readSessions: () => cache.getQueryData<Session[]>(projectKey) ?? EMPTY_SESSIONS,
    setSessions(value: Update<Session[]>) {
      cache.setQueryData<Session[]>(projectKey, (current = EMPTY_SESSIONS) => typeof value === 'function' ? value(current) : value);
    },
    setSessionStatuses(value: Update<Record<string, SessionStatus>>) {
      cache.setQueryData<SessionCatalogData>(catalogKey, (current) => ({
        sessions: current?.sessions ?? EMPTY_SESSIONS,
        statuses: typeof value === 'function' ? value(current?.statuses ?? EMPTY_STATUSES) : value,
      }));
    },
  };
}
