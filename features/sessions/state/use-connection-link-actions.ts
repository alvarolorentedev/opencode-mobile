import { withReadSignal, type ScopedOpencodeClient } from '@/shared/protocol/opencode/client';
import type { SessionDeepLinkTarget } from '@/shared/contracts/domain';
import { listSessions } from '@/shared/protocol/services/session-service';
import { useCallback, useRef } from 'react';

// The workspace manager resolves cross-server/project targets before invoking
// this runtime. Validation consumes the authoritative result, not render timing.
export function useConnectionLinkActions({ client, isCurrentClient, connectionScope, activeProjectPath, openSession, connect, connection }: {
  client: ScopedOpencodeClient; isCurrentClient: (client: object) => boolean;
  connectionScope: string; activeProjectPath?: string;
  openSession: (id: string) => Promise<void>;
  connection: import('@/shared/contracts/domain').ConnectionState;
  connect: () => Promise<import('@/shared/contracts/domain').ConnectionState>;
}) {
  const operation = useRef(0);
  const openDeepLinkSession = useCallback(async (target: SessionDeepLinkTarget, signal?: AbortSignal) => {
    const attempt = ++operation.current;
    try {
      const id = target.sessionId.trim();
      if (!id) throw new Error('This session link is missing a session ID.');
      const current = () => {
        if (signal?.aborted) throw new Error('This session link was cancelled.');
        if (attempt !== operation.current || !isCurrentClient(client)) throw new Error('This session link was superseded.');
      };
      current();
      if (target.connectionScope && target.connectionScope !== connectionScope) throw new Error('The saved connection for this session is not available.');
      if (!activeProjectPath || target.projectPath && target.projectPath !== activeProjectPath) throw new Error('This session link does not name a project, and no project is open.');
      const result = connection.status === 'connected' ? connection : await connect(); current();
      if (result.status !== 'connected') throw new Error(result.message);
      const { sessions } = await listSessions(signal ? withReadSignal(client, signal) : client); current();
      if (!sessions.some((session) => session.id === id)) throw new Error(`Session ${id} was not found in the ${activeProjectPath} project.`);
      await openSession(id); current();
      return { ok: true };
    } catch (error) { return { ok: false, error: error instanceof Error ? error.message : 'Could not open this session link.' }; }
  }, [activeProjectPath, client, connect, connection, connectionScope, isCurrentClient, openSession]);
  const openSessionInProject = useCallback(async (projectPath: string, sessionId: string, targetConnectionScope?: string) => {
    const result = await openDeepLinkSession({ projectPath, sessionId, connectionScope: targetConnectionScope });
    if (!result.ok) throw new Error(result.error);
  }, [openDeepLinkSession]);
  return { openDeepLinkSession, openSessionInProject };
}
