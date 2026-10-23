import { useCallback } from 'react';

import {
  rejectPendingQuestion,
  replyToPendingPermission,
  replyToPendingQuestion,
  type PendingQuestionAnswer,
} from '@/lib/opencode/client';
import type { SessionActionsInput } from '@/providers/opencode-provider-action-inputs';

type PendingRequest = { id: string; sessionID: string };

function withoutRequest<T extends PendingRequest>(current: Record<string, T[]>, request: T) {
  const items = current[request.sessionID] || [];
  if (!items.some((item) => item.id === request.id)) {
    return current;
  }
  return {
    ...current,
    [request.sessionID]: items.filter((item) => item.id !== request.id),
  };
}

function withRequest<T extends PendingRequest>(current: Record<string, T[]>, request: T, index: number) {
  const items = current[request.sessionID] || [];
  if (items.some((item) => item.id === request.id)) {
    return current;
  }
  const next = [...items];
  next.splice(Math.min(Math.max(index, 0), next.length), 0, request);
  return { ...current, [request.sessionID]: next };
}

export function useSessionInteractionActions({
  client,
  pendingPermissionsBySession,
  pendingQuestionsBySession,
  setPendingPermissionsBySession,
  setPendingQuestionsBySession,
  suppressedPendingRequestIdsRef,
  refreshMessages,
  refreshSavedPermissions,
}: SessionActionsInput) {
  const replyToPermission = useCallback(
    async (requestId: string, reply: 'once' | 'always' | 'reject') => {
      const request = Object.values(pendingPermissionsBySession).flat().find((item) => item.id === requestId);
      if (!request) {
        throw new Error('This permission request is no longer available.');
      }
      const items = pendingPermissionsBySession[request.sessionID] || [];
      const index = items.findIndex((item) => item.id === request.id);
      // Remove the card as soon as the user decides. The server reply is still
      // authoritative: a failure restores the card and surfaces the error.
      suppressedPendingRequestIdsRef.current.add(request.id);
      setPendingPermissionsBySession((current) => withoutRequest(current, request));
      try {
        await replyToPendingPermission(client, request.id, reply);
      } catch (error) {
        setPendingPermissionsBySession((current) => withRequest(current, request, index));
        throw error;
      } finally {
        suppressedPendingRequestIdsRef.current.delete(request.id);
      }
      void refreshMessages(request.sessionID, true).catch(() => undefined);
      // An "always" reply may persist a new server-side rule; refresh the list.
      if (reply === 'always' && refreshSavedPermissions) {
        void refreshSavedPermissions().catch(() => undefined);
      }
    },
    [client, pendingPermissionsBySession, refreshMessages, refreshSavedPermissions, setPendingPermissionsBySession, suppressedPendingRequestIdsRef],
  );

  const replyToQuestion = useCallback(
    async (requestId: string, answers: PendingQuestionAnswer[]) => {
      const request = Object.values(pendingQuestionsBySession).flat().find((item) => item.id === requestId);
      if (!request) {
        throw new Error('This question is no longer available.');
      }
      // Keep the question flow mounted until the server accepts it: it owns the
      // draft answers and its inline error/retry state.
      await replyToPendingQuestion(client, request.id, answers);
      setPendingQuestionsBySession((current) => ({
        ...current,
        [request.sessionID]: (current[request.sessionID] || []).filter((item) => item.id !== request.id),
      }));
      void refreshMessages(request.sessionID, true).catch(() => undefined);
    },
    [client, pendingQuestionsBySession, refreshMessages, setPendingQuestionsBySession],
  );

  const rejectQuestion = useCallback(
    async (requestId: string) => {
      const request = Object.values(pendingQuestionsBySession).flat().find((item) => item.id === requestId);
      if (!request) {
        throw new Error('This question is no longer available.');
      }
      await rejectPendingQuestion(client, request.id);
      setPendingQuestionsBySession((current) => ({
        ...current,
        [request.sessionID]: (current[request.sessionID] || []).filter((item) => item.id !== request.id),
      }));
      void refreshMessages(request.sessionID, true).catch(() => undefined);
    },
    [client, pendingQuestionsBySession, refreshMessages, setPendingQuestionsBySession],
  );

  return { replyToPermission, replyToQuestion, rejectQuestion };
}
