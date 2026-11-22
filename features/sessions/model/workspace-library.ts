import type { Session, SessionStatus } from '@/shared/protocol/opencode/types';
import type { ConnectionRecord, WorkspaceCatalog, WorkspaceTarget } from '@/shared/contracts/workspace';
import type { WorkspaceSnapshot } from '@/runtime/workspace';
import { sessionKey } from '@/shared/contracts/workspace';
import { getConnectionScope } from '@/shared/contracts/connection-scope';

type ConnectionStates = ReadonlyMap<string, { connection: { status: string } }>;
type SessionSelection = { activeProjectPath?: string; currentSessionId?: string };
type ProjectSessions = { runtime: WorkspaceSnapshot; projectPath?: string; currentSessionId?: string };

export type LibrarySession = WorkspaceTarget & {
  sessionId: string; session: Session; status: SessionStatus; serverName: string; preview?: string;
  current: boolean; favorite: boolean;
};
export function connectedConnections(connections: ConnectionRecord[], lifecycles: ConnectionStates) {
  return connections.filter((entry) => entry.enabled && lifecycles.get(entry.id)?.connection.status === 'connected');
}
export function librarySessions(connections: ConnectionRecord[], snapshots: Record<string, WorkspaceSnapshot>, lifecycles: ConnectionStates,
  selections: Record<string, SessionSelection>, catalogs: Record<string, Pick<WorkspaceCatalog, 'sessions' | 'statuses'>>, focus?: WorkspaceTarget) {
  const rows = new Map<string, LibrarySession>();
  const projectsByConnection = new Map<string, ProjectSessions[]>();
  for (const [key, runtime] of Object.entries(snapshots)) {
    const [connectionId, directory] = JSON.parse(key) as [string, string];
    const project = { runtime, projectPath: selections[key]?.activeProjectPath ?? (directory || undefined), currentSessionId: selections[key]?.currentSessionId };
    const list = projectsByConnection.get(connectionId);
    if (list) list.push(project);
    else projectsByConnection.set(connectionId, [project]);
  }
  const servers = connectedConnections(connections, lifecycles);
  const nameCounts = new Map<string, number>();
  for (const entry of servers) nameCounts.set(entry.name, (nameCounts.get(entry.name) ?? 0) + 1);
  for (const entry of servers) {
    const projects = projectsByConnection.get(entry.id) ?? [];
    const primary = projects[0]?.runtime;
    if (!primary) continue;
    const label = (nameCounts.get(entry.name) ?? 0) > 1
      ? `${entry.name} · ${new URL(entry.settings.serverUrl).host}`
      : entry.name;
    const scope = getConnectionScope(entry.settings);
    const localByProject = new Map<string, ProjectSessions>();
    const liveSessionsByProject = new Map<string, Map<string, Session>>();
    const catalogByIdAndDirectory = new Map<string, Session>();
    const catalog = catalogs[entry.id];
    const catalogSessions = catalog?.sessions ?? [];
    for (const session of catalogSessions) {
      if (!session.directory) continue;
      const key = `${session.id}\u0000${session.directory}`;
      if (!catalogByIdAndDirectory.has(key)) catalogByIdAndDirectory.set(key, session);
    }
    for (const project of projects) {
      const { runtime, projectPath } = project;
      if (projectPath && !localByProject.has(projectPath)) {
        localByProject.set(projectPath, project);
        const live = runtime.values.sessionLibraryValue.sessions;
        const liveById = new Map<string, Session>();
        for (const session of live) {
          if (!liveById.has(session.id)) liveById.set(session.id, session);
        }
        liveSessionsByProject.set(projectPath, liveById);
      }
    }
    const favoriteKeys = new Set(primary.values.sessionLibraryValue.favoriteSessions
      .filter((favorite) => favorite.connectionScope === scope)
      .map((favorite) => `${favorite.projectPath}\u0000${favorite.sessionId}`));
    for (const { runtime, projectPath: directory } of projects) {
      for (const session of [...catalogSessions, ...runtime.values.sessionLibraryValue.sessions]) {
        const projectPath = session.directory || directory;
        if (!projectPath || session.time.archived) continue;
        const target = { connectionId: entry.id, projectPath, sessionId: session.id };
        const key = sessionKey(target);
        const local = localByProject.get(projectPath);
        const live = local?.runtime.values.sessionLibraryValue;
        rows.set(key, {
          ...target,
          session: liveSessionsByProject.get(projectPath)?.get(session.id) ?? session,
          serverName: label,
          status: catalog?.statuses[session.id] ?? { type: 'idle' },
          preview: live?.sessionPreviewById[session.id],
          current: focus?.connectionId === entry.id && (!focus.projectPath || focus.projectPath === projectPath) && local?.currentSessionId === session.id,
          favorite: favoriteKeys.has(`${projectPath}\u0000${session.id}`),
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
      });
    }
  }
  return [...rows.values()].sort((a, b) => Number(b.current) - Number(a.current)
    || Number(b.status.type !== 'idle') - Number(a.status.type !== 'idle') || b.session.time.updated - a.session.time.updated || sessionKey(a).localeCompare(sessionKey(b)));
}
