import type { Session } from '@/shared/protocol/opencode/types';

export type SessionSwipeDirection = 'next' | 'previous';

/** Physical swipe to catalog direction; RTL languages mirror the horizontal axis. */
export function swipeSessionDirection(translationX: number, rtl: boolean): SessionSwipeDirection {
  return (rtl ? translationX > 0 : translationX < 0) ? 'next' : 'previous';
}

/**
 * Adjacent top-level chat in recency order. The catalog is already newest
 * first, but sorting here keeps the gesture deterministic across servers.
 */
export function adjacentSessionId(
  sessions: readonly Session[],
  currentSessionId: string | undefined,
  direction: SessionSwipeDirection,
): string | undefined {
  if (!currentSessionId) return undefined;
  const ordered = sessions
    .filter((session) => !session.time.archived && !session.parentID)
    .sort((left, right) => right.time.updated - left.time.updated || left.id.localeCompare(right.id));
  const index = ordered.findIndex((session) => session.id === currentSessionId);
  if (index < 0) return undefined;
  return ordered[direction === 'next' ? index + 1 : index - 1]?.id;
}
