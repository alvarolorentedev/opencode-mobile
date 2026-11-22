import { projectSessionsKey } from '@/features/sessions/runtime';
import type { CommandContext } from '@/runtime/core/commands/context';
import type { RealtimeScopeInput } from '@/runtime/realtime/create-realtime';
import type { WorkspaceTarget } from '@/shared/contracts/workspace';
import type { Session } from '@/shared/protocol/opencode/types';

type SessionNavigation = {
  openSession: (sessionId: string) => Promise<void>;
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

export function createSessionNavigationCommands({ store, queryClient, connections }: CommandContext) {
  const bootstraps = new Map<string, { token: object; promise: Promise<string | undefined> }>();
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
      if (!access || !sources || (access.revision ?? 0) !== (revision ?? 0)) return;
      return { access, sources };
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
        // The retained adapter still supplies creation until CRUD is migrated.
        const create: ((title?: string) => Promise<Session>) | undefined =
          store.getState().registry.snapshots[scopeKey]?.values.currentSessionValue.createSession;
        const session = pendingTarget
          ? refreshed.find(({ id }) => id === pendingTarget.sessionId)
          : refreshed[0] ?? await create?.();
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

    return { openSession, ensureActiveSession };
  }

  return { navigation, cancelBootstrap };
}
