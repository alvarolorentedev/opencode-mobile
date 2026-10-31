import { getHistoryPreview, type SessionMessageRecord } from '@/shared/presentation/format';

export function getCurrentPendingRequests<T>(
  currentSessionId: string | undefined,
  sendingSessionId: string | undefined,
  pendingRequestsBySession: Record<string, T[]>,
  relatedSessionIds: Iterable<string> = [],
) {
  const candidateSessionIds = [...new Set([
    currentSessionId,
    sendingSessionId,
    ...relatedSessionIds,
  ].filter(Boolean))] as string[];
  const matches = candidateSessionIds.flatMap((sessionId) => pendingRequestsBySession[sessionId] || []);

  // MCP elicitation forms are owned by the server's `global` sentinel rather
  // than a real session. Surface them with the active chat instead of dropping
  // a blocking request that the user must answer.
  const globalRequests = pendingRequestsBySession.global || [];
  return globalRequests.length > 0 ? [...matches, ...globalRequests] : matches;
}

// Cache history preview per messages array reference. mergeSessionMessageRecords
// in the provider preserves record refs AND array ref when content is unchanged,
// so this key stays stable for sessions whose messages have not changed and the
// reverse+find pass is skipped for them.
const sessionPreviewCache = new WeakMap<SessionMessageRecord[], string>();

export function getSessionPreviewById(messagesBySession: Record<string, SessionMessageRecord[]>) {
  return Object.fromEntries(
    Object.entries(messagesBySession).map(([sessionId, messages]) => {
      let preview = sessionPreviewCache.get(messages);
      if (preview === undefined) {
        preview = getHistoryPreview(messages);
        sessionPreviewCache.set(messages, preview);
      }
      return [sessionId, preview];
    }),
  );
}
