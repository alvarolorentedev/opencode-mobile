import type { CommandContext } from '@/runtime/core/commands/context';
import { createProjectRefreshQueue } from '@/runtime/realtime/project-refresh-queue';
import { handleProviderEvent, type ProviderEventActions } from '@/shared/protocol/opencode/event-dispatch';
import type { OpencodeEvent } from '@/shared/protocol/opencode/events';
import type { McpStatus } from '@/shared/protocol/opencode/types';

type StoreActions = 'sendingSessionId' | 'focusSessionIds' | 'transcriptSessionIds'
  | 'clearExplicitSelection' | 'setPromptError' | 'setMcpAuthPrompt' | 'readPinnedDiffMessage';

type ProjectEventBinding = {
  workspaceKey: string;
  mcpQueryKey: readonly unknown[];
  isCurrent: () => boolean;
  pendingSessionIds: string[];
  actions: Omit<ProviderEventActions, StoreActions>;
};

export function createCoreEvents({ store, queryClient }: Pick<CommandContext, 'store' | 'queryClient'>) {
  const { setSelection, setPrompt, setMcpAuthPrompt } = store.getState();

  function clearConnectedMcpPrompt() {
    const { mcpAuthPrompt } = store.getState();
    if (mcpAuthPrompt && queryClient.getQueryData<Record<string, McpStatus>>(mcpAuthPrompt.queryKey)?.[mcpAuthPrompt.mcpName]?.status === 'connected') {
      setMcpAuthPrompt((current) => current === mcpAuthPrompt ? undefined : current);
    }
  }

  function observeMcpStatus() {
    clearConnectedMcpPrompt();
    return queryClient.getQueryCache().subscribe((event) => {
      const key = event.query.queryKey;
      if (event.type === 'updated' && key[0] === 'opencode' && key.at(-1) === 'mcp') clearConnectedMcpPrompt();
    });
  }

  function dispatch(event: OpencodeEvent, { workspaceKey, mcpQueryKey, isCurrent, pendingSessionIds, actions }: ProjectEventBinding) {
    if (!isCurrent()) return;
    const { selection, prompt, conversation } = store.getState();
    const transcriptSessionIds = new Set<string>();
    const currentSessionId = selection[workspaceKey]?.currentSessionId;
    const conversationSessionId = conversation[workspaceKey]?.sessionId;
    if (currentSessionId) transcriptSessionIds.add(currentSessionId);
    if (conversationSessionId) transcriptSessionIds.add(conversationSessionId);
    const sending = prompt[workspaceKey]?.sending;

    handleProviderEvent(event, {
      ...actions,
      transcriptSessionIds,
      focusSessionIds: new Set([...transcriptSessionIds, ...pendingSessionIds]),
      sendingSessionId: sending?.active ? sending.sessionId : undefined,
      clearExplicitSelection(sessionId) {
        if (store.getState().selection[workspaceKey]?.explicitSessionId === sessionId) {
          setSelection(workspaceKey, { explicitSessionId: undefined });
        }
      },
      setPromptError: (value) => setPrompt(workspaceKey, (current) => ({
        error: typeof value === 'function' ? value(current.error) : value,
      })),
      setMcpAuthPrompt(value) {
        setMcpAuthPrompt((current) => {
          const next = typeof value === 'function' ? value(current) : value;
          return next && { ...next, scopeKey: workspaceKey, queryKey: mcpQueryKey };
        });
        clearConnectedMcpPrompt();
      },
      readPinnedDiffMessage: (sessionId) => store.getState().chat[workspaceKey]?.selectedDiffMessageBySession[sessionId],
    });
  }

  return { dispatch, createProjectRefreshQueue, observeMcpStatus };
}
