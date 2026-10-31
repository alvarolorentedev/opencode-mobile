import type { Session, SessionStatus } from '@/shared/protocol/opencode/types';
import type { ActiveSessionItem } from '@/shared/contracts/domain';

// Pure active-session selection for the Chat Library "Active across projects"
// group. Kept dependency-free so node tests can transpile and exercise it
// without pulling in the provider or RN runtime.
//
// The group is connection-wide (not filtered by the active project) so it
// stays stable while switching projects. Running sessions come first (newest
// updated first), then the most recently updated idle ones, capped to a short
// list. Sessions here are de-duplicated out of the current-project Chat list
// by the library, so nothing appears twice.
export function getActiveSessions({
  sessions,
  statuses,
  currentSessionId,
  hideSubagentChats,
  maxTotal = 4,
}: {
  sessions: Session[];
  statuses: Record<string, SessionStatus>;
  currentSessionId?: string;
  hideSubagentChats?: boolean;
  maxTotal?: number;
}): ActiveSessionItem[] {
  const eligible = sessions.filter((session) => (
    Boolean(session.directory)
    && !session.time.archived
    && (!hideSubagentChats || !session.parentID)
  ));
  const byRecency = (left: Session, right: Session) => right.time.updated - left.time.updated;
  const running = eligible.filter((session) => (statuses[session.id]?.type ?? 'idle') !== 'idle').sort(byRecency);
  const runningIds = new Set(running.map((session) => session.id));
  const recent = eligible.filter((session) => !runningIds.has(session.id)).sort(byRecency);

  return [...running, ...recent].slice(0, maxTotal).map((session) => ({
    sessionId: session.id,
    projectPath: session.directory || '',
    title: session.title,
    status: statuses[session.id] ?? { type: 'idle' },
    isCurrent: session.id === currentSessionId,
    updatedAt: session.time.updated,
  }));
}
