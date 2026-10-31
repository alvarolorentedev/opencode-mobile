import type { ActiveSessionItem } from '@/shared/contracts/domain';

// Pure selection of the session quick actions published to the launcher. Kept
// dependency-free so node tests can exercise it without the provider or RN
// runtime. `activeSessions` is already running-first and capped, so this only
// drops entries without usable routing data, applies the labels, and bounds the
// list to leave room for the New chat action.
export const MAX_SESSION_QUICK_ACTIONS = 3;

export type SessionQuickActionItem = {
  id: string;
  title: string;
  params: { sessionId: string; projectPath: string; connectionScope: string };
};

export function getSessionQuickActions({
  activeSessions,
  connectionScope,
  untitledLabel,
  maxItems = MAX_SESSION_QUICK_ACTIONS,
}: {
  activeSessions: ActiveSessionItem[];
  connectionScope: string;
  untitledLabel: string;
  maxItems?: number;
}): SessionQuickActionItem[] {
  if (!connectionScope || maxItems < 1) return [];
  return activeSessions
    .filter((session) => Boolean(session.sessionId) && Boolean(session.projectPath))
    .slice(0, maxItems)
    .map((session) => ({
      id: session.connectionScope ? `session:${session.connectionScope}:${session.projectPath}:${session.sessionId}` : `session:${session.sessionId}`,
      title: session.title?.trim() || untitledLabel,
      params: {
        sessionId: session.sessionId,
        projectPath: session.projectPath,
        connectionScope: session.connectionScope ?? connectionScope,
      },
    }));
}
