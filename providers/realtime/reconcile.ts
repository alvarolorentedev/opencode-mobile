export function collectReconcileSessionIds({
  pendingSessionIds,
  currentSessionId,
  conversationSessionId,
}: {
  pendingSessionIds: string[];
  currentSessionId?: string;
  conversationSessionId?: string;
}) {
  return new Set(
    [...pendingSessionIds, currentSessionId, conversationSessionId]
      .filter((id): id is string => Boolean(id)),
  );
}
