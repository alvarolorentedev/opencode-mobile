import type { QueryClient } from '@tanstack/react-query';

import { listPendingInteractions } from '@/shared/protocol/opencode/client/interactions';
import type { ScopedOpencodeClient } from '@/shared/protocol/opencode/client';
import type { SessionStatus } from '@/shared/protocol/opencode/types';
import { getActiveSessionStatuses, listSessions } from '@/shared/protocol/services/session-service';
import type { QueryIdentity } from '@/shared/server-data/keys';

import { areSessionListsEqual, areSessionStatusMapsEqual, groupPendingRequestsBySession, mergeSessionStatuses } from '../model/session-utils';
import { approvalsAccess } from './approvals';
import { recentlyCreatedSessionIds } from './session-creation';
import { sessionCatalogAccess } from './session-catalog-access';

export function sessionRefreshCommands({ cache, identity, client, isCurrent, clock, isPermissionReplyPending }: {
  cache: QueryClient;
  identity: QueryIdentity;
  client: ScopedOpencodeClient;
  isCurrent: () => boolean;
  clock: () => number;
  isPermissionReplyPending: (id: string) => boolean;
}) {
  const catalog = sessionCatalogAccess(cache, identity, client);
  const approvals = approvalsAccess(cache, identity, client);

  async function refreshSessions() {
    if (!client.__opencode.directory) {
      catalog.setSessions([]);
      catalog.setSessionStatuses({});
      return [];
    }
    const result = await listSessions(client);
    if (!isCurrent()) return result.sessions;

    const now = clock();
    const seen = new Set(result.sessions.map(({ id }) => id));
    const recent = recentlyCreatedSessionIds(cache, identity, client, seen, now);
    const retained = recent.size ? catalog.readSessions().filter(({ id }) => recent.has(id) && !seen.has(id)) : [];
    const sessions = retained.length ? [...retained, ...result.sessions] : result.sessions;
    catalog.setSessions((current) => areSessionListsEqual(current, sessions) ? current : sessions);
    catalog.setSessionStatuses((current) => {
      const next = mergeSessionStatuses(current, result.statuses, now);
      for (const { id } of retained) {
        if (!next[id]) next[id] = current[id] ?? { type: 'idle' };
      }
      return areSessionStatusMapsEqual(current, next) ? current : next;
    });
    return sessions;
  }

  async function refreshSessionStatuses() {
    const active = await getActiveSessionStatuses(client).catch(() => undefined);
    if (!isCurrent()) return;
    if (!active) {
      await refreshSessions();
      return;
    }
    catalog.setSessionStatuses((current) => {
      const fetched: Record<string, SessionStatus> = {};
      for (const id of Object.keys(current)) fetched[id] = { type: id in active ? 'busy' : 'idle' };
      for (const id of Object.keys(active)) fetched[id] = { type: 'busy' };
      const next = mergeSessionStatuses(current, fetched, clock());
      return areSessionStatusMapsEqual(current, next) ? current : next;
    });
  }

  async function refreshPendingInteractions() {
    const { permissions, questions } = await listPendingInteractions(client);
    if (!isCurrent()) return;
    const visible = <T extends { id: string }>(requests: T[]) => requests.filter(({ id }) => !isPermissionReplyPending(id));
    if (permissions) approvals.setPermissions(groupPendingRequestsBySession(visible(permissions)));
    if (questions) approvals.setQuestions(groupPendingRequestsBySession(visible(questions)));
  }

  return { refreshSessions, refreshSessionStatuses, refreshPendingInteractions };
}
