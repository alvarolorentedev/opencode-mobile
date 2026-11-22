import { useCallback, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { useTranslation } from 'react-i18next';

import type { useChat } from '@/features/chat/context';
import { parseShellCommand, parseSlashCommand } from '@/features/chat/model/composer';
import type { useChatDraft } from '@/features/chat/ui/use-chat-draft';
import type { useCurrentSession } from '@/features/sessions/context';
import type { SideQuestionAnswer } from '@/shared/contracts/session-commands';
import type { PromptAttachment } from '@/shared/protocol/opencode/prompt-inbox';

type ChatCommands = ReturnType<typeof useChat>['view']['commands'];
type Input = {
  hasActiveProject: boolean;
  connectionStatus: string;
  currentSessionId?: string;
  isV2: boolean;
  shellCommandAvailable: boolean;
  commands: ChatCommands['available'];
  executeCommand: ChatCommands['execute'];
  executeShell: ChatCommands['executeShell'];
  sendPrompt: ReturnType<typeof useChat>['view']['sendPrompt'];
  ensureActiveSession: ReturnType<typeof useCurrentSession>['ensureActiveSession'];
  capture: ReturnType<typeof useChatDraft>['capture'];
  clearRevertPrefill: (sessionId: string) => void;
  setSendFeedback: Dispatch<SetStateAction<string | undefined>>;
  t: ReturnType<typeof useTranslation>['t'];
};

export function useComposerSubmission({
  hasActiveProject, connectionStatus, currentSessionId, isV2, shellCommandAvailable,
  commands, executeCommand, executeShell, sendPrompt, ensureActiveSession,
  capture, clearRevertPrefill, setSendFeedback, t,
}: Input) {
  const submittingRef = useRef(false);
  const [isSubmittingPrompt, setIsSubmittingPrompt] = useState(false);
  const [sideQuestion, setSideQuestion] = useState<SideQuestionAnswer>();
  const lastSentAttachmentsRef = useRef<PromptAttachment[]>([]);
  const handleSendPrompt = useCallback(async (promptOverride?: string) => {
    if (submittingRef.current) return;
    const snapshot = capture(promptOverride);
    const nextDraft = promptOverride ?? snapshot.draft;
    const nextAttachments = snapshot.attachments;
    const prompt = nextDraft.trim();
    if (!hasActiveProject || (!prompt && nextAttachments.length === 0) || connectionStatus !== 'connected') {
      return;
    }
    const shellCommand = isV2 && shellCommandAvailable && nextAttachments.length === 0 && prompt.startsWith('!')
      ? parseShellCommand(prompt)
      : undefined;
    if (isV2 && shellCommandAvailable && nextAttachments.length === 0 && prompt.startsWith('!') && !shellCommand) {
      setSendFeedback(t('chat:composer.shellEmpty'));
      return;
    }

    submittingRef.current = true;
    setIsSubmittingPrompt(true);
    let sessionId = currentSessionId;
    try {
      setSendFeedback(undefined);
      lastSentAttachmentsRef.current = nextAttachments;
      sessionId = currentSessionId || (await ensureActiveSession());
      if (!sessionId) {
        return;
      }

      if (!snapshot.belongsHere(sessionId)) return;
      snapshot.clear(sessionId);

      if (shellCommand) {
        await executeShell(sessionId, shellCommand);
        return;
      }

      const command = parseSlashCommand(isV2 ? nextDraft : prompt);
      if (command && (isV2 || (nextAttachments.length === 0 && commands.some((item) => item.name === command.name)))) {
        const result = await executeCommand(sessionId, command.name, isV2 ? command.args : command.args.trimStart(), { attachments: nextAttachments, context: snapshot.context });
        if (result && snapshot.belongsHere(sessionId)) setSideQuestion(result);
        return;
      }

      const sent = await sendPrompt(sessionId, prompt, nextAttachments, snapshot.context);
      if (sent) {
        clearRevertPrefill(sessionId);
      } else {
        if (snapshot.restore(sessionId)) setSendFeedback(t('chat:view.couldNotSendRetry'));
      }
    } catch (error) {
      if (snapshot.restore(sessionId)) setSendFeedback(error instanceof Error ? error.message : t('chat:view.couldNotSend'));
    } finally {
      submittingRef.current = false;
      setIsSubmittingPrompt(false);
    }
  }, [hasActiveProject, capture, clearRevertPrefill, commands, connectionStatus, currentSessionId, ensureActiveSession, executeCommand, executeShell, isV2, sendPrompt, shellCommandAvailable, t, setSendFeedback]);

  const closeSideQuestion = useCallback(() => setSideQuestion(undefined), []);
  return {
    handleSendPrompt, isSubmittingPrompt, lastSentAttachmentsRef, sideQuestion,
    closeSideQuestion,
  };
}
