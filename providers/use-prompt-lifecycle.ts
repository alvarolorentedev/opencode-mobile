import type { FilePartInput, TextPartInput } from '@opencode-ai/sdk/v2/client';
import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react';

import type { OpencodeConnectionSettings, ScopedOpencodeClient } from '@/lib/opencode/client';
import type { SessionMessageRecord } from '@/lib/opencode/format';
import type { Session, SessionStatus } from '@/lib/opencode/types';
import type { PromptDelivery, PromptInput } from '@/lib/opencode/prompt-inbox';
import { pendingNotificationKey } from '@/lib/notification-pending';
import {
  clearPendingTaskFinishedNotification,
  listPendingTaskFinishedNotifications,
  notifyTaskFinished,
  trackPendingTaskFinishedNotification,
} from '@/lib/notifications';
import type { ModelOption } from '@/providers/opencode-model-selection';
import { getSelectedModelParts } from '@/providers/opencode-model-selection';
import type { ChatPreferences } from '@/providers/opencode-preferences';
import { buildSystemPrompt } from '@/providers/opencode-preferences';
import type { SessionRefreshOptions } from '@/providers/opencode-provider-events';

type PromptLifecycleInput = {
  submitPrompt: (input: PromptInput, delivery: PromptDelivery) => Promise<void>;
  client: ScopedOpencodeClient;
  isCurrentClient: (candidate: object) => boolean;
  activeProjectPath?: string;
  connectionScope: string;
  sessions: Session[];
  sessionStatuses: Record<string, SessionStatus>;
  availableModels: ModelOption[];
  chatPreferences: ChatPreferences;
  settingsRef: { current: OpencodeConnectionSettings };
  busyNotificationsRef: { current: Set<string> };
  promptSubmissionRef: { current: { active: boolean; sessionId?: string } };
  setCurrentSessionId: Dispatch<SetStateAction<string | undefined>>;
  setSelectedDiffMessageBySession: Dispatch<SetStateAction<Record<string, string | undefined>>>;
  fetchSessions: (silent?: boolean) => Promise<Session[]>;
  refreshSessions: (silent?: boolean) => Promise<unknown>;
  refreshMessages: (sessionId: string, silent?: boolean, options?: { full?: boolean }) => Promise<SessionMessageRecord[]>;
  refreshSessionDiff: (sessionId: string, silent?: boolean, messageId?: string) => Promise<unknown>;
  refreshSessionTodos: (sessionId: string) => Promise<unknown>;
  scheduleSessionRefresh: (sessionId: string, options?: SessionRefreshOptions) => void;
  summarizeSessionTitle: (sessionId: string, knownSessions?: Session[]) => Promise<Session | undefined>;
};

export function usePromptLifecycle({
  submitPrompt,
  client,
  isCurrentClient,
  activeProjectPath,
  connectionScope,
  sessions,
  sessionStatuses,
  availableModels,
  chatPreferences,
  settingsRef,
  busyNotificationsRef,
  promptSubmissionRef,
  setCurrentSessionId,
  setSelectedDiffMessageBySession,
  fetchSessions,
  refreshSessions,
  refreshMessages,
  refreshSessionDiff,
  refreshSessionTodos,
  scheduleSessionRefresh,
  summarizeSessionTitle,
}: PromptLifecycleInput) {
  const [sendingState, setSendingState] = useState<{ sessionId?: string; active: boolean }>({ active: false });
  const [promptError, setPromptError] = useState<{ message: string; occurredAt: number; sessionId?: string }>();

  const sendPrompt = useCallback(
    async (
      sessionId: string,
      prompt: string,
      attachments?: { uri: string; mime?: string; filename?: string }[],
    ) => {
      const trimmedPrompt = prompt.trim();
      if (!trimmedPrompt && (!attachments || attachments.length === 0)) {
        return false;
      }

      if (promptSubmissionRef.current.active) {
        return false;
      }

      promptSubmissionRef.current = { active: true, sessionId };
      setPromptError(undefined);

      const currentSession = sessions.find((session) => session.id === sessionId);
      let promptAccepted = false;
      const trackingKey = pendingNotificationKey(connectionScope, sessionId);
      const requestedAt = Date.now();

      try {
        busyNotificationsRef.current.delete(trackingKey);
        if (activeProjectPath) {
          await trackPendingTaskFinishedNotification({
            sessionId,
            sessionTitle: currentSession?.title,
            projectPath: activeProjectPath,
            connectionScope,
            settings: {
              serverUrl: settingsRef.current.serverUrl,
              username: settingsRef.current.username,
            },
            requestedAt,
          }).catch(() => undefined);
        }

        setSendingState({ active: true, sessionId });
        const selectedModel = availableModels.find((model) => model.id === chatPreferences.modelId);
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

        // Prepare file parts. For local URIs (file://, content://, asset://) read the
        // file and convert it to a data URL so the server receives the attachment bytes.
        // Mobile-local URIs are not reachable from the OpenCode server.
        const preparedFileParts: { type: 'file'; mime: string; filename?: string; url: string }[] = [];

        if (attachments && attachments.length > 0) {
          for (const att of attachments) {
            const filename = att.filename || att.uri.split('/').pop();
            const mime = att.mime || 'application/octet-stream';

            // Remote and picker-provided data URLs are already server-readable.
            if (/^(?:https?:\/\/|data:)/i.test(att.uri)) {
              preparedFileParts.push({ type: 'file', mime, filename, url: att.uri });
              continue;
            }

            try {
              const FileSystem = await import('expo-file-system/legacy');
              const info = await FileSystem.getInfoAsync(att.uri);
              if (info.exists && typeof info.size === 'number' && info.size > 10 * 1024 * 1024) {
                throw new Error('File exceeds the 10 MB attachment limit.');
              }
              const base64 = await FileSystem.readAsStringAsync(att.uri, { encoding: 'base64' });
              const dataUrl = `data:${mime};base64,${base64}`;
              preparedFileParts.push({ type: 'file', mime, filename, url: dataUrl });
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

        await submitPrompt({
          sessionID: sessionId,
          agent: chatPreferences.mode,
          model: getSelectedModelParts(chatPreferences.modelId),
          system: buildSystemPrompt(chatPreferences),
          parts,
        }, chatPreferences.promptDelivery ?? 'steer');
        promptAccepted = true;
        if (promptSubmissionRef.current.sessionId === sessionId) {
          promptSubmissionRef.current = { active: false, sessionId: undefined };
        }
        if (!isCurrentClient(client)) {
          return true;
        }
        // Delayed safety refresh. The server may finish after promptAsync
        // returns, and a completion across workspaces can be missed when the
        // event directory does not match the active project. Re-read the
        // transcript once after the typical completion window so the busy
        // safety poll can run at a slower, lower-data cadence.
        scheduleSessionRefresh(sessionId, { sessions: true, messages: true, fullMessages: true, diff: true, todos: true, delayMs: 5000 });

        setCurrentSessionId(sessionId);
        // A new user turn supersedes any earlier turn the diff surface was pinned to.
        setSelectedDiffMessageBySession((current) => ({ ...current, [sessionId]: undefined }));
        const nextSessions = await fetchSessions(true);
        await Promise.all([
          refreshMessages(sessionId, true),
          refreshSessionDiff(sessionId, true),
          refreshSessionTodos(sessionId),
        ]);

        const refreshedSession = nextSessions.find((session) => session.id === sessionId);
        if (!refreshedSession?.title?.trim()) {
          try {
            await summarizeSessionTitle(sessionId, nextSessions);
          } catch {
            // Leave the session untitled if summarization is unavailable.
          }
        }
        return true;
      } catch (error) {
        if (promptSubmissionRef.current.sessionId === sessionId) {
          promptSubmissionRef.current = { active: false, sessionId: undefined };
        }
        if (promptAccepted) {
          scheduleSessionRefresh(sessionId, { sessions: true, messages: true, diff: true, todos: true, delayMs: 1000 });
          return true;
        }
        setPromptError({
          message: error instanceof Error ? error.message : 'OpenCode could not send that message.',
          occurredAt: Date.now(),
          sessionId,
        });
        if (!promptAccepted) {
          await clearPendingTaskFinishedNotification(connectionScope, sessionId).catch(() => undefined);
        }

        throw error;
      } finally {
        setSendingState((current) => (
          current.sessionId === sessionId
            ? { active: false, sessionId: undefined }
            : current
        ));
      }
    },
    [activeProjectPath, availableModels, busyNotificationsRef, chatPreferences, client, connectionScope, fetchSessions, isCurrentClient, promptSubmissionRef, refreshMessages, refreshSessionDiff, refreshSessionTodos, scheduleSessionRefresh, sessions, setCurrentSessionId, setPromptError, setSelectedDiffMessageBySession, settingsRef, submitPrompt, summarizeSessionTitle],
  );

  const abortSession = useCallback(
    async (sessionId: string) => {
      const trackingKey = pendingNotificationKey(connectionScope, sessionId);
      busyNotificationsRef.current.delete(trackingKey);
      await clearPendingTaskFinishedNotification(connectionScope, sessionId).catch(() => undefined);
      await client.session.abort({ sessionID: sessionId });

      // Reset prompt guards immediately so the user can submit again without
      // waiting for the in-flight promptAsync to settle. sendPrompt's finally
      // block sets the same values; both writes compose to the same state.
      if (promptSubmissionRef.current.sessionId === sessionId) {
        promptSubmissionRef.current = { active: false, sessionId: undefined };
      }
      setSendingState((current) => (
        current.sessionId === sessionId
          ? { active: false, sessionId: undefined }
          : current
      ));

      await Promise.all([
        refreshSessions(true),
        refreshMessages(sessionId, true),
        refreshSessionDiff(sessionId, true),
        refreshSessionTodos(sessionId),
      ]);
    },
    [busyNotificationsRef, client, connectionScope, promptSubmissionRef, refreshMessages, refreshSessionDiff, refreshSessionTodos, refreshSessions],
  );

  useEffect(() => {
    let cancelled = false;

    async function flushCompletedNotifications() {
      const pendingEntries = await listPendingTaskFinishedNotifications(connectionScope);
      if (cancelled || pendingEntries.length === 0) {
        return;
      }

      for (const pending of pendingEntries) {
        const { sessionId } = pending;
        const key = pendingNotificationKey(pending.connectionScope, sessionId);
        const status = sessionStatuses[sessionId];
        // Latch once the session has actually started working so an early
        // completion notifies without waiting out the debounce below.
        if (status && status.type !== 'idle') {
          busyNotificationsRef.current.add(key);
          continue;
        }

        const oldEnough = Date.now() - pending.requestedAt >= 5000;
        if ((!busyNotificationsRef.current.has(key) && !oldEnough) || (sendingState.active && sendingState.sessionId === sessionId)) {
          continue;
        }

        const session = sessions.find((item) => item.id === sessionId);
        if (!session) {
          busyNotificationsRef.current.delete(key);
          await clearPendingTaskFinishedNotification(connectionScope, sessionId).catch(() => undefined);
          continue;
        }
        const cleared = await clearPendingTaskFinishedNotification(connectionScope, sessionId, pending.requestedAt);
        if (cancelled) {
          return;
        }

        busyNotificationsRef.current.delete(key);
        if (cleared) await notifyTaskFinished(session.title, connectionScope);
      }
    }

    void flushCompletedNotifications().catch((reason) => console.warn('Could not complete task notification.', reason));

    return () => {
      cancelled = true;
    };
  }, [busyNotificationsRef, connectionScope, sendingState.active, sendingState.sessionId, sessionStatuses, sessions]);

  const clearPromptError = useCallback(() => setPromptError(undefined), []);

  return {
    sendPrompt,
    abortSession,
    sendingState,
    setSendingState,
    promptError,
    setPromptError,
    clearPromptError,
  };
}
