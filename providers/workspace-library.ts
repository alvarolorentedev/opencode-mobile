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
  for (const entry of connections) {
    const runtimes = Object.entries(snapshots).filter(([key]) => (JSON.parse(key) as string[])[0] === entry.id).map(([, runtime]) => runtime);
    const primary = runtimes[0];
    if (!primary) continue;
    const label = connections.filter((other) => other.name === entry.name).length > 1 ? `${entry.name} · ${new URL(entry.settings.serverUrl).host}` : entry.name;
    const scope = getConnectionScope(entry.settings);
    for (const runtime of runtimes) for (const session of [...runtime.catalogSessions, ...runtime.values.sessionLibraryValue.sessions]) {
      const projectPath = session.directory || runtime.values.projectsValue.activeProjectPath;
      if (!projectPath || session.time.archived) continue;
      const target = { connectionId: entry.id, projectPath, sessionId: session.id };
      const key = sessionKey(target);
      const local = runtimes.find((item) => item.values.projectsValue.activeProjectPath === projectPath);
      const live = local?.values.sessionLibraryValue;
      const actual = live?.sessions.find((item) => item.id === session.id) ?? session;
      rows.set(key, { ...target, session: actual, serverName: label,
        status: live?.sessionStatuses[session.id] ?? runtime.catalogStatuses[session.id] ?? { type: 'idle' },
        preview: live?.sessionPreviewById[session.id],
        current: focus?.connectionId === entry.id && (!focus.projectPath || focus.projectPath === projectPath) && local?.values.currentSessionValue.currentSessionId === session.id,
        favorite: primary.values.sessionLibraryValue.favoriteSessions.some((favorite) => favorite.connectionScope === scope && favorite.projectPath === projectPath && favorite.sessionId === session.id),
        connected: entry.enabled && primary.values.connectionValue.connection.status === 'connected' });
    }
    for (const favorite of primary.values.sessionLibraryValue.favoriteSessions) {
      if (favorite.connectionScope !== scope) continue;
      const target = { connectionId: entry.id, projectPath: favorite.projectPath, sessionId: favorite.sessionId };
      const key = sessionKey(target);
      const known = runtimes.flatMap((runtime) => runtime.catalogSessions).find((session) => session.id === favorite.sessionId && session.directory === favorite.projectPath);
      if (rows.has(key) || known?.time.archived) continue;
      rows.set(key, { ...target, session: { id: favorite.sessionId, title: favorite.title ?? '', directory: favorite.projectPath,
        time: { created: favorite.favoritedAt, updated: favorite.favoritedAt } }, serverName: label, status: { type: 'idle' },
        current: false, favorite: true, connected: entry.enabled && primary.values.connectionValue.connection.status === 'connected' });
    }
  }
  return [...rows.values()].sort((a, b) => Number(b.current) - Number(a.current)
    || Number(b.status.type !== 'idle') - Number(a.status.type !== 'idle') || b.session.time.updated - a.session.time.updated || sessionKey(a).localeCompare(sessionKey(b)));
}
