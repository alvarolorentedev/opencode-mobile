import type { Session } from '@/shared/protocol/opencode/types';

export function reconcileProjectSessionSelection({ sessions, currentSessionId, explicitSessionId, setCurrentSessionId, clearExplicitSessionId }: {
  sessions: Pick<Session, 'id'>[];
  currentSessionId?: string;
  explicitSessionId?: string;
  setCurrentSessionId: (id?: string) => void;
  clearExplicitSessionId: () => void;
}) {
  // An explicit selection can arrive before the project catalog catches up.
  if (currentSessionId && explicitSessionId !== currentSessionId && !sessions.some(({ id }) => id === currentSessionId)) {
    setCurrentSessionId(sessions[0]?.id);
  }
  if (explicitSessionId && sessions.some(({ id }) => id === explicitSessionId)) clearExplicitSessionId();
}
