import { FAVORITE_SESSIONS_MAX, type FavoriteSession } from './types';

export function toggleFavoriteSession(current: FavoriteSession[], connectionScope: string, sessionId: string, projectPath: string, title: string | undefined, now: number) {
  const id = sessionId.trim();
  const path = projectPath.trim();
  if (!id || !path) return current;

  const matches = (favorite: FavoriteSession) => favorite.connectionScope === connectionScope && favorite.sessionId === id;
  if (current.some(matches)) return current.filter((favorite) => !matches(favorite));

  const label = title?.trim();
  return [{ sessionId: id, connectionScope, projectPath: path, ...(label ? { title: label } : {}), favoritedAt: now }, ...current]
    .slice(0, FAVORITE_SESSIONS_MAX);
}
