import { createPromptSubmissionActions, type PromptCommandInput, type PromptSubmission } from '@/features/chat/runtime';
import type { CommandContext } from '@/runtime/core/commands/context';
import type { PromptUiState } from '@/runtime/core/store';

type Update<T> = T | ((current: T) => T);
type PendingSubmission = { active?: PromptSubmission; latest: PromptSubmission };

export function createPromptCommands({ store, clock }: Pick<CommandContext, 'store' | 'clock'>) {
  const submissions = new Map<string, PendingSubmission>();
  const { setPrompt, setChat } = store.getState();

  function workspace(scopeKey: string) {
    function setSendingState(value: Update<PromptUiState['sending']>) {
      setPrompt(scopeKey, (current) => ({ sending: typeof value === 'function' ? value(current.sending) : value }));
    }
    function setPromptError(value: Update<PromptUiState['error']>) {
      setPrompt(scopeKey, (current) => ({ error: typeof value === 'function' ? value(current.error) : value }));
    }
    function finish(submission: PromptSubmission) {
      if (store.getState().prompt[scopeKey]?.sending === submission) setSendingState({ active: false });
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
      clearDiffPin(sessionId: string) {
        setChat(scopeKey, (current) => ({ selectedDiffMessageBySession: { ...current.selectedDiffMessageBySession, [sessionId]: undefined } }));
      },
      clock,
    };
    return {
      actions: (input: PromptCommandInput) => createPromptSubmissionActions(input, operations),
      setSendingState,
      setPromptError,
      clearPromptError: () => setPromptError(undefined),
      dispose() {
        const submission = submissions.get(scopeKey)?.latest;
        submissions.delete(scopeKey);
        if (submission) finish(submission);
      },
    };
  }

  return { workspace };
}
