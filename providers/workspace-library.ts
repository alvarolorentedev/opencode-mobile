import type { Session, SessionStatus } from '@/lib/opencode/types';
import type { ConnectionRecord, WorkspaceSnapshot, WorkspaceTarget } from '@/providers/workspace-types';
import { sessionKey } from '@/providers/workspace-types';
import { getConnectionScope } from '@/lib/connection-scope';
export type LibrarySession = WorkspaceTarget & {
  sessionId: string; session: Session; status: SessionStatus; serverName: string; preview?: string;
  current: boolean; favorite: boolean; connected: boolean;
};
export function librarySessions(connections: ConnectionRecord[], snapshots: Record<string, WorkspaceSnapshot>, focus?: WorkspaceTarget) {
  const rows = new Map<string, LibrarySession>();
  const runtimesByConnection = new Map<string, WorkspaceSnapshot[]>();
  for (const [key, runtime] of Object.entries(snapshots)) {
    const [connectionId] = JSON.parse(key) as [string, string];
    const list = runtimesByConnection.get(connectionId);
    if (list) list.push(runtime);
    else runtimesByConnection.set(connectionId, [runtime]);
  }
  const nameCounts = new Map<string, number>();
  for (const entry of connections) nameCounts.set(entry.name, (nameCounts.get(entry.name) ?? 0) + 1);
  for (const entry of connections) {
    const runtimes = runtimesByConnection.get(entry.id) ?? [];
    const primary = runtimes[0];
    if (!primary) continue;
    const label = (nameCounts.get(entry.name) ?? 0) > 1
      ? `${entry.name} · ${new URL(entry.settings.serverUrl).host}`
      : entry.name;
    const scope = getConnectionScope(entry.settings);
    const connected = entry.enabled && primary.values.connectionValue.connection.status === 'connected';
    const localByProject = new Map<string, WorkspaceSnapshot>();
    const liveSessionsByProject = new Map<string, Map<string, Session>>();
    const catalogByIdAndDirectory = new Map<string, Session>();
    for (const runtime of runtimes) {
      const projectPath = runtime.values.projectsValue.activeProjectPath;
      if (projectPath && !localByProject.has(projectPath)) {
        localByProject.set(projectPath, runtime);
        const live = runtime.values.sessionLibraryValue.sessions;
        const liveById = new Map<string, Session>();
        for (const session of live) {
          if (!liveById.has(session.id)) liveById.set(session.id, session);
        }
        liveSessionsByProject.set(projectPath, liveById);
      }
      for (const session of runtime.catalogSessions) {
        if (!session.directory) continue;
        const key = `${session.id}\u0000${session.directory}`;
        if (!catalogByIdAndDirectory.has(key)) catalogByIdAndDirectory.set(key, session);
      }
    }
    const favoriteKeys = new Set(primary.values.sessionLibraryValue.favoriteSessions
      .filter((favorite) => favorite.connectionScope === scope)
      .map((favorite) => `${favorite.projectPath}\u0000${favorite.sessionId}`));
    for (const runtime of runtimes) {
      for (const session of [...runtime.catalogSessions, ...runtime.values.sessionLibraryValue.sessions]) {
        const projectPath = session.directory || runtime.values.projectsValue.activeProjectPath;
        if (!projectPath || session.time.archived) continue;
        const target = { connectionId: entry.id, projectPath, sessionId: session.id };
        const key = sessionKey(target);
        const local = localByProject.get(projectPath);
        const live = local?.values.sessionLibraryValue;
        rows.set(key, {
          ...target,
          session: liveSessionsByProject.get(projectPath)?.get(session.id) ?? session,
          serverName: label,
          status: live?.sessionStatuses[session.id] ?? runtime.catalogStatuses[session.id] ?? { type: 'idle' },
          preview: live?.sessionPreviewById[session.id],
          current: focus?.connectionId === entry.id && (!focus.projectPath || focus.projectPath === projectPath) && local?.values.currentSessionValue.currentSessionId === session.id,
          favorite: favoriteKeys.has(`${projectPath}\u0000${session.id}`),
          connected,
        });
      }
    }
    for (const favorite of primary.values.sessionLibraryValue.favoriteSessions) {
      if (favorite.connectionScope !== scope) continue;
      const target = { connectionId: entry.id, projectPath: favorite.projectPath, sessionId: favorite.sessionId };
      const key = sessionKey(target);
      const known = catalogByIdAndDirectory.get(`${favorite.sessionId}\u0000${favorite.projectPath}`);
      if (rows.has(key) || known?.time.archived) continue;
      rows.set(key, {
        ...target,
        session: {
          id: favorite.sessionId,
          title: favorite.title ?? '',
          directory: favorite.projectPath,
          time: { created: favorite.favoritedAt, updated: favorite.favoritedAt },
        },
        serverName: label,
        status: { type: 'idle' },
        current: false,
        favorite: true,
        connected,
      });
    }
  }
  return [...rows.values()].sort((a, b) => Number(b.current) - Number(a.current)
    || Number(b.status.type !== 'idle') - Number(a.status.type !== 'idle') || b.session.time.updated - a.session.time.updated || sessionKey(a).localeCompare(sessionKey(b)));
}
