import type { Session, SessionStatus } from '@/shared/protocol/opencode/types';
import type { ConnectionRecord, WorkspaceCatalog, WorkspaceTarget } from '@/shared/contracts/workspace';
import { sessionKey } from '@/shared/contracts/workspace';
import { getConnectionScope } from '@/shared/contracts/connection-scope';
import type { FavoriteSession } from './types';
import { sessionUnreadAt } from './session-utils';

type ConnectionStates = ReadonlyMap<string, { connection: { status: string } }>;
export type ProjectSessions = {
  connectionId: string;
  projectPath?: string;
  currentSessionId?: string;
  sessions: readonly Session[];
  previews?: Record<string, string>;
};

export type LibrarySession = WorkspaceTarget & {
  sessionId: string; session: Session; status: SessionStatus; serverName: string; preview?: string;
  current: boolean; favorite: boolean; unread: boolean;
};
export function connectedConnections(connections: ConnectionRecord[], lifecycles: ConnectionStates) {
  return connections.filter((entry) => entry.enabled && lifecycles.get(entry.id)?.connection.status === 'connected');
}
export function librarySessions(connections: ConnectionRecord[], projectSessions: readonly ProjectSessions[], lifecycles: ConnectionStates,
  catalogs: Record<string, Pick<WorkspaceCatalog, 'sessions' | 'statuses'>>,
  favoriteSessions: readonly FavoriteSession[], focus?: WorkspaceTarget) {
  const rows = new Map<string, LibrarySession>();
  const projectsByConnection = new Map<string, ProjectSessions[]>();
  for (const project of projectSessions) {
    const { connectionId } = project;
    const list = projectsByConnection.get(connectionId);
    if (list) list.push(project);
    else projectsByConnection.set(connectionId, [project]);
  }
  const servers = connectedConnections(connections, lifecycles);
  const nameCounts = new Map<string, number>();
  for (const entry of servers) nameCounts.set(entry.name, (nameCounts.get(entry.name) ?? 0) + 1);
  for (const entry of servers) {
    const projects = projectsByConnection.get(entry.id) ?? [];
    if (projects.length === 0) continue;
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
      const { sessions, projectPath } = project;
      if (projectPath && !localByProject.has(projectPath)) {
        localByProject.set(projectPath, project);
        const liveById = new Map<string, Session>();
        for (const session of sessions) {
          if (!liveById.has(session.id)) liveById.set(session.id, session);
        }
        liveSessionsByProject.set(projectPath, liveById);
      }
    }
    const favorites = favoriteSessions.filter((favorite) => favorite.connectionScope === scope);
    const favoriteKeys = new Set(favorites.map((favorite) => `${favorite.projectPath}\u0000${favorite.sessionId}`));
    for (const { sessions, projectPath: directory } of projects) {
      for (const session of [...catalogSessions, ...sessions]) {
        const projectPath = session.directory || directory;
        if (!projectPath || session.time.archived) continue;
        const target = { connectionId: entry.id, projectPath, sessionId: session.id };
        const key = sessionKey(target);
        const local = localByProject.get(projectPath);
        const status = catalog?.statuses[session.id] ?? { type: 'idle' };
        const current = focus?.connectionId === entry.id && (!focus.projectPath || focus.projectPath === projectPath) && local?.currentSessionId === session.id;
        const resolved = liveSessionsByProject.get(projectPath)?.get(session.id) ?? session;
        rows.set(key, {
          ...target,
          session: resolved,
          serverName: label,
          status,
          preview: local?.previews?.[session.id],
          current,
          favorite: favoriteKeys.has(`${projectPath}\u0000${session.id}`),
          unread: !current && status.type === 'idle' && sessionUnreadAt(resolved) !== undefined,
        });
      }
    }
    for (const favorite of favorites) {
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
        unread: false,
      });
    }
  }
  return [...rows.values()].sort((a, b) => Number(b.current) - Number(a.current)
    || Number(b.status.type !== 'idle') - Number(a.status.type !== 'idle') || b.session.time.updated - a.session.time.updated || sessionKey(a).localeCompare(sessionKey(b)));
}
