import { getInitialMode } from '@/features/ai/runtime';
import { buildSideQuestionPrompt, isBuiltinSessionCommand, type SideQuestionAnswer } from '@/shared/contracts/session-commands';
import { i18n } from '@/shared/i18n/index';
import type { CommandOptions } from '@/shared/protocol/opencode/prompt-inbox';
import { compactSession as svcCompactSession, executeCommand as svcExecuteCommand, executeShell as svcExecuteShell, generateSessionText as svcGenerateSessionText } from '@/shared/protocol/services/session-service';
import type { SessionExecutionInput } from '@/features/sessions/model/action-inputs';

export function createSessionExecutionActions({
  client, isCurrentClient, availableAgents, commands, currentConfig, refreshMessages, refreshSessions, chatPreferences,
}: SessionExecutionInput) {
  const executeCommand = async (sessionId: string, command: string, args: string, input?: Pick<CommandOptions, 'attachments' | 'context'>): Promise<SideQuestionAnswer | void> => {
    if (!isCurrentClient(client)) throw new Error(i18n.t('chat:composer.noEligibleAgent'));
    // Client built-ins are not in the server catalog. Intercept them before
    // agent/model resolution so they never reach session.command.
    if (client.__opencode?.contract === 'v2' && isBuiltinSessionCommand(command) && !commands.some((item) => item.name === command)) {
      if (input?.attachments?.length) throw new Error(i18n.t('chat:composer.builtinAttachmentsUnsupported'));
      if (command === 'compact') {
        await svcCompactSession(client, sessionId);
        await Promise.all([refreshMessages(sessionId, true, { mode: 'replace' }), refreshSessions()]).catch(() => undefined);
        return;
      }
      const question = args.trim();
      if (!question) throw new Error(i18n.t('chat:composer.sideQuestionEmpty'));
      const answer = await svcGenerateSessionText(client, sessionId, buildSideQuestionPrompt(question));
      return { question, answer };
    }
    const agent = getInitialMode(availableAgents, currentConfig, chatPreferences.mode);
    if (!agent) throw new Error(i18n.t('chat:composer.noEligibleAgent'));
    await svcExecuteCommand(client, sessionId, command, args, {
      ...input,
      agent,
    });
    await Promise.all([refreshMessages(sessionId, true), refreshSessions()]).catch(() => undefined);
  };

  const executeShell = async (sessionId: string, command: string) => {
    await svcExecuteShell(client, sessionId, command);
    await Promise.all([refreshMessages(sessionId, true), refreshSessions()]).catch(() => undefined);
  };

  return { executeCommand, executeShell };
}
