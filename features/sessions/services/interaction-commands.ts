import type { PendingPermissionRequest, PendingQuestionAnswer, PendingQuestionRequest, ScopedOpencodeClient } from '@/shared/protocol/opencode/client';
import { listPendingInteractions, rejectPendingQuestion, replyToPendingPermission, replyToPendingQuestion } from '@/shared/protocol/opencode/client';

type Request = { id: string; sessionID: string };
type Requests<T extends Request> = Record<string, T[]>;
type Update<T extends Request> = (change: (current: Requests<T>) => Requests<T>) => void;

type InteractionContext = {
  client: ScopedOpencodeClient;
  isCurrent: () => boolean;
  readPermissions: () => Requests<PendingPermissionRequest>;
  readQuestions: () => Requests<PendingQuestionRequest>;
  updatePermissions: Update<PendingPermissionRequest>;
  updateQuestions: Update<PendingQuestionRequest>;
  runPermissionReply: (id: string, run: () => Promise<void>) => Promise<void>;
  refreshMessages: (sessionId: string, silent: boolean) => Promise<unknown>;
  refreshSavedPermissions: () => Promise<unknown>;
};

function findRequest<T extends Request>(current: Requests<T>, id: string) {
  return Object.values(current).flat().find((item) => item.id === id);
}
function withoutRequest<T extends Request>(current: Requests<T>, request: T) {
  const items = current[request.sessionID] || [];
  if (!items.some((item) => item.id === request.id)) return current;
  return { ...current, [request.sessionID]: items.filter((item) => item.id !== request.id) };
}
function withRequest<T extends Request>(current: Requests<T>, request: T, index: number) {
  const items = current[request.sessionID] || [];
  if (items.some((item) => item.id === request.id)) return current;
  const next = [...items];
  next.splice(Math.min(Math.max(index, 0), next.length), 0, request);
  return { ...current, [request.sessionID]: next };
}

export function createInteractionCommands(context: InteractionContext) {
  const { client, isCurrent, readPermissions, readQuestions, updatePermissions, updateQuestions, runPermissionReply,
    refreshMessages, refreshSavedPermissions } = context;
  const refresh = (sessionId: string) => { if (isCurrent()) void refreshMessages(sessionId, true).catch(() => undefined); };

  async function replyToPermission(requestId: string, reply: 'once' | 'always' | 'reject') {
    const permissions = readPermissions();
    const request = findRequest(permissions, requestId);
    if (!request) throw new Error('This permission request is no longer available.');
    const index = permissions[request.sessionID].findIndex((item) => item.id === request.id);

    return runPermissionReply(requestId, async () => {
      if (!isCurrent()) throw new Error('This permission request is no longer available.');
      // Hide the card while its reply is in flight. Refreshes ignore that
      // pending mutation so a response from before the reply cannot restore it.
      updatePermissions((current) => withoutRequest(current, request));
      try {
        await replyToPendingPermission(client, request.id, reply);
      } catch (error) {
        if (!isCurrent()) throw error;
        // The reply may have reached the server before the response was lost.
        const latest = await listPendingInteractions(client).catch(() => undefined);
        if (!isCurrent()) throw error;
        if (latest?.permissions && !latest.permissions.some((item) => item.id === request.id)) {
          refresh(request.sessionID);
          return;
        }
        updatePermissions((current) => withRequest(current, request, index));
        throw error;
      }

      refresh(request.sessionID);
      if (reply === 'always' && isCurrent()) void refreshSavedPermissions().catch(() => undefined);
    });
  }

  async function settleQuestion(requestId: string, send: (id: string) => Promise<unknown>) {
    const request = findRequest(readQuestions(), requestId);
    if (!request || !isCurrent()) throw new Error('This question is no longer available.');
    // The question dialog keeps its answers until the server accepts them.
    try {
      await send(request.id);
    } catch (error) {
      if (!isCurrent()) throw error;
      const latest = await listPendingInteractions(client).catch(() => undefined);
      if (!latest?.questions || latest.questions.some((item) => item.id === request.id)) throw error;
    }
    if (!isCurrent()) return;
    updateQuestions((current) => withoutRequest(current, request));
    refresh(request.sessionID);
  }

  return {
    replyToPermission,
    replyToQuestion: (requestId: string, answers: PendingQuestionAnswer[]) =>
      settleQuestion(requestId, (id) => replyToPendingQuestion(client, id, answers)),
    rejectQuestion: (requestId: string) => settleQuestion(requestId, (id) => rejectPendingQuestion(client, id)),
  };
}
