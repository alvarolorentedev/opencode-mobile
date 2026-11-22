import { createPromptInboxCommands, createPromptSubmissionActions, EMPTY_OUTBOX, reconcilePromptSettlement, type PromptCommandInput, type PromptSubmission } from '@/features/chat/runtime';
import type { CommandContext } from '@/runtime/core/commands/context';
import type { PromptUiState } from '@/runtime/core/store';

type Update<T> = T | ((current: T) => T);
type PendingSubmission = { active?: PromptSubmission; latest: PromptSubmission };

export function createPromptCommands({ store, clock, queryClient }: Pick<CommandContext, 'store' | 'clock' | 'queryClient'>) {
  const submissions = new Map<string, PendingSubmission>();
  const { setPrompt, setChat } = store.getState();

  function workspace(scopeKey: string) {
    const busyNotifications = new Set<string>();
    const readSending = () => store.getState().prompt[scopeKey]?.sending;
    function setPromptError(value: Update<PromptUiState['error']>) {
      setPrompt(scopeKey, (current) => ({ error: typeof value === 'function' ? value(current.error) : value }));
    }
    function finish(submission: PromptSubmission) {
      if (readSending() === submission) setPrompt(scopeKey, { sending: { active: false } });
    }
    const operations = {
      begin(sessionId: string, owner: string): PromptSubmission | undefined {
        const current = submissions.get(scopeKey);
        if (current?.active) return;
        const submission: PromptSubmission = { active: true, sessionId, owner,
          requestedAt: Math.max(clock(), (current?.latest.requestedAt ?? 0) + 1) };
        submissions.set(scopeKey, { active: submission, latest: submission });
        setPrompt(scopeKey, { sending: submission, error: undefined });
        return submission;
      },
      owns: (submission: PromptSubmission) => submissions.get(scopeKey)?.active === submission,
      latest: () => submissions.get(scopeKey)?.latest,
      release(submission: PromptSubmission) {
        const current = submissions.get(scopeKey);
        if (current?.active === submission) current.active = undefined;
      },
      finish,
      setError: setPromptError,
      clearBusyNotification: (key: string) => busyNotifications.delete(key),
      clearDiffPin(sessionId: string) {
        setChat(scopeKey, (current) => ({ selectedDiffMessageBySession: { ...current.selectedDiffMessageBySession, [sessionId]: undefined } }));
      },
      clock,
    };
    return {
      actions: (input: PromptCommandInput) => createPromptSubmissionActions(input, operations),
      reconcileSettlement: (input: Parameters<typeof reconcilePromptSettlement>[0], signal: AbortSignal) =>
        reconcilePromptSettlement(input, {
          busyNotifications, clock, signal,
          isSending: (sessionId) => {
            const sending = readSending();
            return Boolean(sending?.active && sending.sessionId === sessionId);
          },
        }),
      setPromptError,
      clearPromptError: () => setPromptError(undefined),
      reset() {
        busyNotifications.clear();
        const submission = submissions.get(scopeKey)?.latest;
        submissions.delete(scopeKey);
        if (submission) finish(submission);
      },
    };
  }

  function createInbox() {
    return createPromptInboxCommands({
      cache: queryClient, clock,
      readOutbox: (scope) => store.getState().prompt[scope]?.outbox,
      writeOutbox: (scope, change) => setPrompt(scope, (current) => ({ outbox: change(current.outbox ?? EMPTY_OUTBOX) })),
      subscribe: (scope, listener) => store.subscribe((current, previous) => {
        if (current.prompt[scope]?.outbox !== previous.prompt[scope]?.outbox) listener();
      }),
    });
  }

  return { workspace, createInbox };
}
