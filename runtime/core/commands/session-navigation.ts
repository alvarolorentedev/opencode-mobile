import { projectSessionsKey } from '@/features/sessions/runtime';
import type { CommandContext } from '@/runtime/core/commands/context';
import type { RealtimeScopeInput } from '@/runtime/realtime/create-realtime';
import type { SessionDeepLinkTarget } from '@/features/sessions/index';
import type { WorkspaceTarget } from '@/shared/contracts/workspace';
import { withReadSignal } from '@/shared/protocol/opencode/client';
import type { Session } from '@/shared/protocol/opencode/types';
import { findSessionForNavigation } from '@/shared/protocol/services/session-service';

type SessionNavigation = {
  openSession: (sessionId: string) => Promise<void>;
  openDeepLinkSession: (target: SessionDeepLinkTarget, signal?: AbortSignal) => Promise<{ ok: boolean; error?: string }>;
  openSessionInProject: (projectPath: string, sessionId: string, connectionScope?: string) => Promise<void>;
  ensureActiveSession: () => Promise<string | undefined>;
};

function hydrate(sources: RealtimeScopeInput, sessionId: string) {
  return Promise.all([
    sources.refreshMessages(sessionId, false),
    sources.refreshSessionDiff(sessionId, true),
    sources.refreshSessionTodos(sessionId),
    sources.refreshPendingInteractions(),
  ]);
}

export function createSessionNavigationCommands({ store, queryClient, connections }: CommandContext,
  createSession: (target: WorkspaceTarget, scopeKey: string, revision?: number) => Promise<Session>) {
  const bootstraps = new Map<string, { token: object; promise: Promise<string | undefined> }>();
  const links = new Map<string, object>();
  const selection = (key: string) => store.getState().selection[key];
  const { setSelection } = store.getState();

  function cancelBootstrap(scopeKey: string) {
    if (bootstraps.delete(scopeKey)) setSelection(scopeKey, { isBootstrappingChat: false });
  }

  function navigation(target: WorkspaceTarget, scopeKey: string, revision?: number): SessionNavigation {
    function getScope() {
      const manager = connections.get(target.connectionId);
      const access = manager?.getProjectAccess(target.projectPath);
      const sources = manager?.realtime.getProjectSources(target.projectPath, scopeKey);
      if (!manager || !access || !sources || (access.revision ?? 0) !== (revision ?? 0)) return;
      return { manager, access, sources };
    }

    async function openSession(sessionId: string) {
      const scope = getScope();
      if (!scope || !scope.access.isCurrent()) throw new Error('This server is no longer available.');
      // Explicit selection supersedes automatic bootstrap. Publish selection
      // and the hydration marker before any transcript request can settle.
      bootstraps.delete(scopeKey);
      setSelection(scopeKey, { currentSessionId: sessionId, explicitSessionId: sessionId, isBootstrappingChat: false });
      const { sources } = scope;
      const finish = sources.beginHydration?.(sessionId);
      void hydrate(sources, sessionId).then(() => {
        if (!scope.access.isCurrent()) return;
        const diffScope = store.getState().chat[scopeKey]?.diffScopeBySession[sessionId];
        if (diffScope && diffScope !== 'turn') void sources.refreshVcsDiff?.(diffScope, true);
      }).catch(() => undefined).finally(() => finish?.());
    }

    async function openDeepLinkSession(link: SessionDeepLinkTarget, signal?: AbortSignal) {
      const attempt = {};
      links.set(scopeKey, attempt);
      try {
        const id = link.sessionId.trim();
        if (!id) throw new Error('This session link is missing a session ID.');
        if (signal?.aborted) throw new Error('This session link was cancelled.');
        const scope = getScope();
        if (!scope) throw new Error('This session link was superseded.');
        const check = () => {
          if (signal?.aborted) throw new Error('This session link was cancelled.');
          if (links.get(scopeKey) !== attempt || !scope.access.isCurrent()) throw new Error('This session link was superseded.');
        };
        check();
        const { manager, access: { identity, client } } = scope;
        if (link.connectionScope && link.connectionScope !== identity.connectionScope) throw new Error('The saved connection for this session is not available.');
        if (!target.projectPath || (link.projectPath && link.projectPath !== target.projectPath)) {
          throw new Error('This session link does not name a project, and no project is open.');
        }
        const connection = manager.getState().connection;
        const connected = connection.status === 'connected' ? connection : await manager.connect();
        check();
        if (connected.status !== 'connected') throw new Error(connected.message);
        const session = await findSessionForNavigation(signal ? withReadSignal(client, signal) : client, id, signal);
        check();
        if (!session || session.id !== id || session.time.archived || (client.api && session.directory !== target.projectPath)) {
          throw new Error(`Session ${id} was not found in the ${target.projectPath} project.`);
        }
        await openSession(id);
        check();
        return { ok: true };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : 'Could not open this session link.' };
      } finally {
        if (links.get(scopeKey) === attempt) links.delete(scopeKey);
      }
    }

    async function openSessionInProject(projectPath: string, sessionId: string, connectionScope?: string) {
      const result = await openDeepLinkSession({ projectPath, sessionId, connectionScope });
      if (!result.ok) throw new Error(result.error);
    }

    async function ensureActiveSession(): Promise<string | undefined> {
      if (!target.projectPath) return undefined;
      const scope = getScope();
      if (!scope) return undefined;
      const { access, sources } = scope;
      const current = selection(scopeKey);
      const selectedId = current?.currentSessionId;
      const pendingTarget = current?.pendingDeepLink;
      const key = projectSessionsKey(access.identity, access.client);
      const sessions = queryClient.getQueryData<Session[]>(key) ?? [];
      if (selectedId && (current?.explicitSessionId === selectedId || sessions.some(({ id }) => id === selectedId))
        && (!pendingTarget || pendingTarget.sessionId === selectedId)) {
        // A cached window can already paint, then reconcile in the background.
        void sources.refreshMessages(selectedId, Boolean(sources.hasMessages?.(selectedId))).catch(() => undefined);
        return selectedId;
      }

      const existing = bootstraps.get(scopeKey);
      if (existing) return existing.promise;

      const token = {};
      const isCurrent = () => bootstraps.get(scopeKey)?.token === token && access.isCurrent()
        && selection(scopeKey)?.pendingDeepLink === pendingTarget;
      const promise = Promise.resolve().then(async (): Promise<string | undefined> => {
        const hasTarget = sessions.length > 0 && (!pendingTarget || sessions.some(({ id }) => id === pendingTarget.sessionId));
        if (!hasTarget) await sources.refreshSessions();
        if (!isCurrent()) return undefined;
        const refreshed = queryClient.getQueryData<Session[]>(key) ?? [];
        const session = pendingTarget
          ? refreshed.find(({ id }) => id === pendingTarget.sessionId)
          : refreshed[0] ?? await createSession(target, scopeKey, revision);
        if (!session || !isCurrent()) return undefined;
        setSelection(scopeKey, { currentSessionId: session.id });
        void hydrate(sources, session.id).catch(() => undefined);
        return session.id;
      }).finally(() => {
        if (bootstraps.get(scopeKey)?.token === token) cancelBootstrap(scopeKey);
      });
      bootstraps.set(scopeKey, { token, promise });
      setSelection(scopeKey, { isBootstrappingChat: true });
      return promise;
    }

    return { openSession, openDeepLinkSession, openSessionInProject, ensureActiveSession };
  }

  return { navigation, cancelBootstrap };
}
