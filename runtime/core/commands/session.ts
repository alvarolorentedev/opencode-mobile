import type { CommandContext } from '@/runtime/core/commands/context';
import { agentsOptions, capabilitiesOptions } from '@/features/ai/runtime';
import { approvalsAccess, createInteractionCommands, forgetSessionCreation, pendingInteractionsKey, recentlyCreatedSessionIds, savedPermissionOptions, sessionCreationCommands } from '@/features/sessions/runtime';
import type { PendingQuestionAnswer, ScopedOpencodeClient } from '@/shared/protocol/opencode/client';
import type { WorkspaceTarget } from '@/shared/contracts/workspace';
import type { QueryIdentity } from '@/shared/server-data/keys';
import { configurationOptions } from '@/shared/server-data/catalogs';
import { createSessionNavigationCommands } from './session-navigation';

const permissionReplyKey = (queryKey: readonly unknown[], id: string) => [...queryKey, 'permission-reply', id];

export function createSessionCommands(context: CommandContext) {
  const { connections, queryClient, store, clock } = context;

  function creation(target: WorkspaceTarget, scopeKey: string, revision?: number) {
    function requireCommands() {
      const manager = connections.get(target.connectionId);
      const access = manager?.getProjectAccess(target.projectPath);
      if (!access || !manager || (access.revision ?? 0) !== (revision ?? 0)) throw new Error('This server is no longer available.');
      const { identity, client } = access;
      const sources = () => manager.realtime.getProjectSources(target.projectPath, scopeKey);
      return sessionCreationCommands({
        cache: queryClient, identity, client, clock,
        isCurrent: () => access.isCurrent() && Boolean(sources()),
        recentModel() {
          if (!sources()?.demanded) return undefined;
          const preferences = store.getState().registry.connections.find(({ id }) => id === target.connectionId)?.preferences;
          const model = preferences?.recentModelIds?.[0];
          if (!model || !queryClient.getQueryData(configurationOptions(identity, client).queryKey)
            || !queryClient.getQueryData(agentsOptions(identity, client).queryKey)) return undefined;
          return queryClient.getQueryData(capabilitiesOptions(identity, client).queryKey)?.models.find(({ id }) => id === model);
        },
      });
    }
    return {
      async createSession(title?: string) { return requireCommands().createSession(title); },
      async forkSession(sessionId: string, messageId?: string) {
        const session = await requireCommands().forkSession(sessionId, messageId);
        await navigation(target, scopeKey, revision).openSession(session.id);
        return session;
      },
    };
  }

  const { navigation, cancelBootstrap } = createSessionNavigationCommands(context,
    (target, scopeKey, revision) => creation(target, scopeKey, revision).createSession());
  function interactions(target: WorkspaceTarget, revision?: number) {
    function readScope() {
      const manager = connections.get(target.connectionId);
      const scope = manager?.getProjectAccess(target.projectPath);
      if (!manager || !scope || (scope.revision ?? 0) !== (revision ?? 0)) return undefined;
      return { manager, scope };
    }
    function getCommands(kind: 'permission' | 'question') {
      const access = readScope();
      if (!access) throw new Error(kind === 'permission' ? 'This permission request is no longer available.' : 'This question is no longer available.');
      const { manager, scope } = access;
      const approvals = approvalsAccess(queryClient, scope.identity, scope.client);
      return createInteractionCommands({
        client: scope.client,
        isCurrent: scope.isCurrent,
        readPermissions: () => approvals.read().permissions,
        readQuestions: () => approvals.read().questions,
        updatePermissions: approvals.setPermissions,
        updateQuestions: approvals.setQuestions,
        runPermissionReply(id, run) {
          const mutationKey = permissionReplyKey(approvals.queryKey, id);
          if (queryClient.isMutating({ mutationKey, exact: true })) throw new Error('This permission request is no longer available.');
          return queryClient.getMutationCache().build(queryClient, { mutationKey, retry: false, networkMode: 'always', gcTime: 0, mutationFn: run }).execute(undefined);
        },
        refreshMessages: (sessionId, silent) => manager.realtime.getProjectSources(target.projectPath)?.refreshMessages(sessionId, silent) ?? Promise.resolve(),
        refreshSavedPermissions: async () => {
          if (manager.isDemanded()) await queryClient.fetchQuery(savedPermissionOptions(scope.identity, scope.client));
        },
      });
    }

    return {
      async replyToPermission(id: string, reply: 'once' | 'always' | 'reject') { return getCommands('permission').replyToPermission(id, reply); },
      async replyToQuestion(id: string, answers: PendingQuestionAnswer[]) { return getCommands('question').replyToQuestion(id, answers); },
      async rejectQuestion(id: string) { return getCommands('question').rejectQuestion(id); },
    };
  }

  return {
    navigation, cancelBootstrap,
    creation,
    recentlyCreatedSessionIds: (identity: QueryIdentity, client: ScopedOpencodeClient, seen: ReadonlySet<string>) =>
      recentlyCreatedSessionIds(queryClient, identity, client, seen, clock()),
    forgetSessionCreation: (identity: QueryIdentity, client: ScopedOpencodeClient, sessionId?: string) =>
      forgetSessionCreation(queryClient, identity, client, sessionId),
    interactions,
    isPermissionReplyPending(identity: QueryIdentity, client: ScopedOpencodeClient, id: string) {
      return queryClient.isMutating({ mutationKey: permissionReplyKey(pendingInteractionsKey(identity, client), id), exact: true }) > 0;
    },
  };
}
