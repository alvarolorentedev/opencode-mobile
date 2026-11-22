import { queryOptions, skipToken, useQueries, useQuery } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';

import { useAppCore, useAppStore } from '@/runtime/core';
import { getConnectionScope } from '@/shared/contracts/connection-scope';
import { workspaceKey } from '@/shared/contracts/workspace';
import type { PendingPermissionRequest } from '@/shared/protocol/opencode/client';
import type { Session } from '@/shared/protocol/opencode/types';

import { pendingInteractionsKey, projectSessionsKey, sessionCatalogKey, type PendingInteractionsData, type SessionCatalogData } from '../services/queries';

type PendingPermission = {
  request: PendingPermissionRequest;
  projectPath: string;
  sourceTitle?: string;
  reply: (value: 'once' | 'always' | 'reject') => Promise<void>;
};

export function useServerPendingInteractions(connectionId: string) {
  const { connections, commands: { session } } = useAppCore();
  const entry = useAppStore(({ registry }) => registry.connections.find(({ id }) => id === connectionId));
  const selection = useAppStore((state) => state.selection);
  const manager = connections.get(connectionId);
  const lifecycle = useSyncExternalStore(connections.subscribeState, () => connections.get(connectionId)?.getState(), () => undefined);
  const identity = entry && { connectionId, connectionScope: getConnectionScope(entry.settings), authRevision: entry.authRevision ?? 0 };
  const { data: catalog } = useQuery<SessionCatalogData>({
    queryKey: identity && lifecycle ? sessionCatalogKey(identity, lifecycle.contract) : ['disabled', 'server-approvals', connectionId],
    queryFn: skipToken,
  });
  const paths = [...new Set(entry?.projects.map((projectPath) =>
    selection[workspaceKey({ connectionId, projectPath })]?.activeProjectPath ?? projectPath))];
  const projects = identity && lifecycle ? paths.flatMap((projectPath) => {
    const client = manager?.getProjectClient(projectPath);
    return client ? [{ projectPath, approvalsKey: pendingInteractionsKey(identity, client), sessionsKey: projectSessionsKey(identity, client) }] : [];
  }) : [];
  const pending = useQueries({ queries: projects.map(({ approvalsKey }) => queryOptions<PendingInteractionsData>({ queryKey: approvalsKey, queryFn: skipToken })) });
  const sessions = useQueries({ queries: projects.map(({ sessionsKey }) => queryOptions<Session[]>({ queryKey: sessionsKey, queryFn: skipToken })) });

  const permissions = new Map<string, PendingPermission>();
  const questions = new Map<string, { sessionId: string; projectPath: string; title?: string }>();
  projects.forEach(({ projectPath }, index) => {
    const data = pending[index].data;
    if (!data) return;
    const currentSessions = sessions[index].data;
    const getSession = (id: string) => currentSessions?.find((item) => item.id === id);
    const getPath = (id: string) => catalog?.sessions.find((item) => item.id === id)?.directory ?? projectPath;
    const { replyToPermission } = session.interactions({ connectionId, projectPath }, entry?.revision);
    for (const request of Object.values(data.permissions).flat()) {
      permissions.set(request.id, { request, projectPath: getPath(request.sessionID),
        sourceTitle: getSession(request.sessionID)?.title, reply: (value) => replyToPermission(request.id, value) });
    }
    for (const request of Object.values(data.questions).flat()) {
      questions.set(request.id, { sessionId: request.sessionID, projectPath: getPath(request.sessionID), title: request.title });
    }
  });
  return { permissions, questions };
}
