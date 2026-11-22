import type { ProviderOption } from '@/features/ai/index';
import { getEffectiveSessionModel, getInitialMode, getSelectedModelParts, routePrompt } from '@/features/ai/runtime';
import { clearPendingTaskFinishedNotification, pendingNotificationKey, trackPendingTaskFinishedNotification } from '@/features/notifications/runtime';
import { buildSystemPrompt } from '@/features/chat/model/system-prompt';
import { getConnectionScope, getConnectionUiScope } from '@/shared/contracts/connection-scope';
import type { AgentOption, ModelOption } from '@/shared/contracts/model-options';
import { i18n } from '@/shared/i18n/index';
import type { ChatPreferences } from '@/shared/preferences/opencode-preferences';
import type { SessionMessageRecord } from '@/shared/presentation/format';
import { prepareAttachment } from '@/shared/protocol/opencode/attachment';
import type { OpencodeConnectionSettings, ScopedOpencodeClient } from '@/shared/protocol/opencode/client';
import type { SessionRefreshOptions } from '@/shared/protocol/opencode/event-dispatch';
import type { PendingPrompt, PromptContextItem, PromptDelivery, PromptInput } from '@/shared/protocol/opencode/prompt-inbox';
import type { Config, FilePartInput, Session, SessionStatus, TextPartInput } from '@/shared/protocol/opencode/types';
import { interruptSession, switchSessionModel as switchSessionModelService } from '@/shared/protocol/services/session-service';

export type PromptSubmission = { active: true; sessionId: string; requestedAt: number; owner: string };

export type PromptCommandInput = {
  submitPrompt: (input: PromptInput, delivery: PromptDelivery) => Promise<PendingPrompt | undefined>;
  client: ScopedOpencodeClient;
  isCurrentClient: (candidate: object) => boolean;
  activeProjectPath?: string;
  connectionScope: string;
  sessions: Session[];
  availableAgents: AgentOption[];
  currentConfig?: Config;
  availableModels: ModelOption[];
  availableProviders: ProviderOption[];
  sessionStatuses: Record<string, SessionStatus>;
  messagesBySession: Record<string, SessionMessageRecord[]>;
  chatPreferences: ChatPreferences;
  readSettings: () => OpencodeConnectionSettings;
  refreshSessions: () => Promise<unknown>;
  refreshSessionDiff: (sessionId: string, silent?: boolean, messageId?: string, records?: SessionMessageRecord[]) => Promise<unknown>;
  refreshSessionTodos: (sessionId: string) => Promise<unknown>;
  scheduleSessionRefresh: (sessionId: string, options?: SessionRefreshOptions) => void;
};

type PromptOperations = {
  begin: (sessionId: string, owner: string) => PromptSubmission | undefined;
  owns: (submission: PromptSubmission) => boolean;
  latest: () => PromptSubmission | undefined;
  release: (submission: PromptSubmission) => void;
  finish: (submission: PromptSubmission) => void;
  setError: (error: { message: string; occurredAt: number; sessionId?: string }) => void;
  clearDiffPin: (sessionId: string) => void;
  clearBusyNotification: (key: string) => void;
  markLocalSend: (sessionId: string) => void;
  clock: () => number;
};

export function createPromptSubmissionActions({
  submitPrompt, client, isCurrentClient, activeProjectPath, connectionScope, sessions, availableAgents,
  currentConfig, availableModels, availableProviders, chatPreferences, readSettings, sessionStatuses, messagesBySession, refreshSessions,
  refreshSessionDiff, refreshSessionTodos, scheduleSessionRefresh,
}: PromptCommandInput, operations: PromptOperations) {
  async function sendPrompt(
    sessionId: string,
    prompt: string,
    attachments?: { uri: string; mime?: string; filename?: string }[],
    context?: PromptContextItem[],
  ) {
    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt && (!attachments || attachments.length === 0)) {
      return false;
    }

    if (!isCurrentClient(client)) {
      return false;
    }

    const submission = operations.begin(sessionId, getConnectionUiScope(readSettings()));
    if (!submission) return false;
    const { requestedAt } = submission;
    const ownsSubmission = () => operations.owns(submission) && isCurrentClient(client);

    const currentSession = sessions.find((session) => session.id === sessionId);
    let promptAccepted = false;
    const trackingKey = pendingNotificationKey(connectionScope, sessionId);
    const canceled = async () => {
      await clearPendingTaskFinishedNotification(connectionScope, sessionId, requestedAt).catch(() => undefined);
      if (submission.owner === getConnectionUiScope(readSettings())) {
        const currentScope = getConnectionScope(readSettings());
        if (currentScope !== connectionScope) await clearPendingTaskFinishedNotification(currentScope, sessionId, requestedAt).catch(() => undefined);
      }
      return false;
    };

    try {
      const agent = getInitialMode(availableAgents, currentConfig, chatPreferences.mode);
      if (!agent) throw new Error(i18n.t('chat:composer.noEligibleAgent'));
      const routingPromise = routePrompt({ sessionId, prompt: trimmedPrompt, attachments }, {
        client, isCurrentClient, currentConfig, availableModels, availableProviders, availableAgents, chatPreferences,
        sessions, sessionStatuses, messagesBySession,
      }).catch(() => undefined);
      operations.clearBusyNotification(trackingKey);
      if (activeProjectPath) {
        await trackPendingTaskFinishedNotification({
          sessionId,
          sessionTitle: currentSession?.title,
          projectPath: activeProjectPath,
          connectionScope,
          settings: {
            serverUrl: readSettings().serverUrl,
            username: readSettings().username,
          },
          requestedAt,
        }).catch(() => undefined);
      }

      if (!ownsSubmission()) return canceled();

      // Prepare file parts. For local URIs (file://, content://, asset://) read the
      // file and convert it to a data URL so the server receives the attachment bytes.
      // Mobile-local URIs are not reachable from the OpenCode server.
      const preparedFileParts: { type: 'file'; mime: string; filename?: string; url: string }[] = [];

      if (attachments && attachments.length > 0) {
        for (const att of attachments) {
          const filename = att.filename || att.uri.split('/').pop();
          try {
            preparedFileParts.push(await prepareAttachment(att));
          } catch (error) {
            const reason = error instanceof Error ? error.message : 'unknown error';
            throw new Error(`Could not read attachment${filename ? ` \"${filename}\"` : ''}: ${reason}`);
          }
        }
      }

      const parts: (TextPartInput | FilePartInput)[] = [];
      if (trimmedPrompt) {
        parts.push({ type: 'text', text: trimmedPrompt });
      }
      parts.push(...preparedFileParts);

      if (!ownsSubmission()) return canceled();
      const routed = await routingPromise;
      if (!ownsSubmission()) return canceled();
      const effectiveModel = getEffectiveSessionModel(
        availableModels,
        currentConfig,
        availableAgents,
        currentSession,
        agent,
      );
      const effectiveModelId = routed?.model.id ?? (effectiveModel ? `${effectiveModel.providerID}/${effectiveModel.id}` : undefined);
      const selectedModel = availableModels.find((model) => model.id === effectiveModelId);
      if (attachments?.length && !selectedModel) {
        throw new Error('Select a model that supports attachments first.');
      }
      if (attachments?.length && !selectedModel?.supportsAttachments) {
        throw new Error(`${selectedModel?.label || 'The selected model'} does not support file attachments.`);
      }
      if (attachments?.length && selectedModel?.inputModalities?.length) {
        const unsupported = attachments.find((attachment) => {
          const mime = attachment.mime || '';
          const modality = mime.startsWith('image/') ? 'image'
            : mime.startsWith('audio/') ? 'audio'
              : mime.startsWith('video/') ? 'video'
                : mime === 'application/pdf' ? 'pdf'
                  : undefined;
          return modality && !selectedModel.inputModalities.includes(modality);
        });
        if (unsupported) {
          throw new Error(`${selectedModel.label} does not support ${unsupported.mime || 'this attachment type'} input.`);
        }
      }

      const isV2 = client.__opencode?.contract === 'v2';
      const variant = isV2 && routed && !routed.sameAsCurrent ? routed.variant : undefined;
      const root = activeProjectPath?.replace(/\/+$/, '');
      const resolvedContext = context?.map((item) => item.kind === 'file' && root && !item.path.startsWith('/')
        ? { ...item, path: `${root}/${item.path}` }
        : item);
      operations.markLocalSend(sessionId);
      await submitPrompt({
        sessionID: sessionId,
        agent,
        model: routed && !routed.sameAsCurrent ? getSelectedModelParts(routed.model.id) : undefined,
        system: buildSystemPrompt(chatPreferences),
        variant,
        parts,
        ...(resolvedContext?.length ? { context: resolvedContext } : {}),
      }, chatPreferences.promptDelivery ?? 'steer');
      promptAccepted = true;
      const owned = ownsSubmission();
      if (owned) operations.release(submission);
      if (!isCurrentClient(client)) {
        return true;
      }
      // Delayed safety refresh for title/diff/todos. The transcript paints from
      // live V2 events and reconciles its assistant message at idle, so this
      // never re-reads the sent prompt or its attachments.
      scheduleSessionRefresh(sessionId, { sessions: true, diff: true, todos: true, delayMs: 5000 });

      // A new user turn supersedes any earlier turn the diff surface was pinned to.
      if (owned) operations.clearDiffPin(sessionId);
      return true;
    } catch (error) {
      const owned = ownsSubmission();
      if (owned) operations.release(submission);
      if (promptAccepted) {
        if (isCurrentClient(client)) scheduleSessionRefresh(sessionId, { sessions: true, diff: true, todos: true, delayMs: 1000 });
        return true;
      }
      if (owned) operations.setError({
        message: error instanceof Error ? error.message : 'OpenCode could not send that message.',
        occurredAt: operations.clock(),
        sessionId,
      });
      if (!promptAccepted) {
        await canceled();
      }

      throw error;
    } finally {
      operations.release(submission);
      operations.finish(submission);
    }
  }

  async function abortSession(sessionId: string) {
    const submission = operations.latest();
    const trackingKey = pendingNotificationKey(connectionScope, sessionId);
    operations.clearBusyNotification(trackingKey);
    const requestedAt = submission?.sessionId === sessionId && submission.owner === getConnectionUiScope(readSettings()) ? submission.requestedAt : undefined;
    await clearPendingTaskFinishedNotification(connectionScope, sessionId, requestedAt).catch(() => undefined);
    await interruptSession(client, sessionId);

    // Release only the submission this abort started with.
    if (submission?.sessionId === sessionId) {
      if (isCurrentClient(client)) operations.release(submission);
      operations.finish(submission);
    }

    await Promise.all([
      refreshSessions(),
      refreshSessionDiff(sessionId, true),
      refreshSessionTodos(sessionId),
    ]);
  }

  async function switchSessionModel(sessionId: string, model: NonNullable<Session['model']>) {
    if (!isCurrentClient(client)) throw new Error('The connection changed before updating the session model.');
    await switchSessionModelService(client, sessionId, model);
    if (!isCurrentClient(client)) throw new Error('The connection changed before refreshing the session model.');
    await refreshSessions().catch(() => undefined);
  }

  return { sendPrompt, abortSession, switchSessionModel };
}
