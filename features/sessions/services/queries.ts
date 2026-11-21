import { queryOptions } from '@tanstack/react-query';

import { withReadSignal, type ScopedOpencodeClient } from '@/shared/protocol/opencode/client';
import { listSessions } from '@/shared/protocol/services/session-service';
import { connectionQueryKey, projectQueryKey, type QueryIdentity } from '@/shared/server-data/keys';

export type SessionCatalogData = {
  sessions: import('@/shared/protocol/opencode/types').Session[];
  statuses: Record<string, import('@/shared/protocol/opencode/types').SessionStatus>;
};

// The display list for one project. It is refreshed by the existing project
// activation path, so the query only carries data while that path writes it.
export function projectSessionsKey(identity: QueryIdentity, client: ScopedOpencodeClient) {
  return [...connectionQueryKey(identity, client.__opencode.contract), 'sessions', 'project', client.__opencode.directory ?? ''] as const;
}

export function projectSessionsOptions(identity: QueryIdentity, client: ScopedOpencodeClient) {
  return queryOptions({
    queryKey: projectSessionsKey(identity, client),
    queryFn: ({ signal }) => listSessions(withReadSignal(client, signal)).then((result) => result.sessions),
    enabled: false,
  });
}

// One connection-wide snapshot: every session plus its status. The status map
// is the single authority for session status; project lists never carry their
// own copy.
export function sessionCatalogKey(identity: QueryIdentity, contract: string) {
  return [...connectionQueryKey(identity, contract), 'sessions', 'catalog'] as const;
}

export function sessionCatalogOptions(identity: QueryIdentity, client: ScopedOpencodeClient) {
  return queryOptions({
    queryKey: sessionCatalogKey(identity, client.__opencode.contract),
    queryFn: ({ signal }) => listSessions(withReadSignal(client, signal)),
  });
}

export type PendingInteractionsData = {
  permissions: Record<string, import('@/shared/protocol/opencode/client').PendingPermissionRequest[]>;
  questions: Record<string, import('@/shared/protocol/opencode/client').PendingQuestionRequest[]>;
};

// Pending approvals are project-scoped server data. The refresh path writes
// this key; the runtime only selects from it.
export function pendingInteractionsKey(identity: QueryIdentity, client: ScopedOpencodeClient) {
  return projectQueryKey(identity, client, 'pending-interactions');
}
