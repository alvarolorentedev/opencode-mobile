import { useCallback } from 'react';

import { FAVORITE_SESSIONS_MAX } from '@/providers/opencode-provider-types';
import type { SessionActionsInput } from '@/providers/opencode-provider-action-inputs';

export function useSessionFavoriteActions({
  connectionScopeRef,
  favoriteSessions,
  setFavoriteSessions,
}: SessionActionsInput) {
  const toggleFavoriteSession = useCallback((sessionId: string, projectPath: string, title?: string) => {
    const trimmedSessionId = sessionId.trim();
    const trimmedPath = projectPath.trim();
    if (!trimmedSessionId || !trimmedPath) {
      return;
    }
    const scope = connectionScopeRef.current;
    setFavoriteSessions((current) => {
      if (current.some((favorite) => favorite.connectionScope === scope && favorite.sessionId === trimmedSessionId)) {
        return current.filter((favorite) => !(favorite.connectionScope === scope && favorite.sessionId === trimmedSessionId));
      }
      const trimmedTitle = title?.trim();
      const next = [
        {
          sessionId: trimmedSessionId,
          connectionScope: scope,
          projectPath: trimmedPath,
          ...(trimmedTitle ? { title: trimmedTitle } : {}),
          favoritedAt: Date.now(),
        },
        ...current,
      ];
      return next.length > FAVORITE_SESSIONS_MAX ? next.slice(0, FAVORITE_SESSIONS_MAX) : next;
    });
  }, [connectionScopeRef, setFavoriteSessions]);

  const isFavoriteSession = useCallback(
    (sessionId: string) => favoriteSessions.some(
      (favorite) => favorite.connectionScope === connectionScopeRef.current && favorite.sessionId === sessionId,
    ),
    [connectionScopeRef, favoriteSessions],
  );

  const clearFavoriteSession = useCallback((sessionId: string) => {
    setFavoriteSessions((current) => current.filter(
      (favorite) => !(favorite.connectionScope === connectionScopeRef.current && favorite.sessionId === sessionId),
    ));
  }, [connectionScopeRef, setFavoriteSessions]);

  return { toggleFavoriteSession, isFavoriteSession, clearFavoriteSession };
}
