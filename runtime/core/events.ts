import type { CommandContext } from '@/runtime/core/commands/context';
import { createProjectRefreshQueue } from '@/runtime/realtime/project-refresh-queue';
import { handleProviderEvent, type ProviderEventActions } from '@/shared/protocol/opencode/event-dispatch';
import type { OpencodeEvent } from '@/shared/protocol/opencode/events';

type StoreActions = 'sendingSessionId' | 'focusSessionIds' | 'transcriptSessionIds'
  | 'clearExplicitSelection' | 'setPromptError' | 'setMcpAuthPrompt' | 'readPinnedDiffMessage';

type ProjectEventBinding = {
  workspaceKey: string;
  isCurrent: () => boolean;
  pendingSessionIds: string[];
  actions: Omit<ProviderEventActions, StoreActions>;
};

export function createCoreEvents({ store }: Pick<CommandContext, 'store'>) {
  const { setSelection, setPrompt, setMcpAuthPrompt } = store.getState();

  function dispatch(event: OpencodeEvent, { workspaceKey, isCurrent, pendingSessionIds, actions }: ProjectEventBinding) {
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
      setMcpAuthPrompt,
      readPinnedDiffMessage: (sessionId) => store.getState().chat[workspaceKey]?.selectedDiffMessageBySession[sessionId],
    });
  }

  return { dispatch, createProjectRefreshQueue };
}
