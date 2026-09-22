import { FAVORITE_SESSIONS_MAX, type FavoriteSession } from '@/providers/opencode-provider-types';

// Maps one persisted entry to the explicit favorite model, dropping unknown
// fields (for example the legacy `projectLabel`, which is derived from the
// project path) and discarding malformed entries instead of failing the whole
// list.
function toFavoriteEntry(value: unknown): FavoriteSession | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }
  const { sessionId, projectPath, title, favoritedAt } = value as Record<string, unknown>;
  if (typeof sessionId !== 'string' || sessionId.trim().length === 0) {
    return undefined;
  }
  if (typeof projectPath !== 'string' || projectPath.trim().length === 0) {
    return undefined;
  }
  if (typeof favoritedAt !== 'number' || !Number.isFinite(favoritedAt)) {
    return undefined;
  }
  if (title !== undefined && typeof title !== 'string') {
    return undefined;
  }
  const trimmedTitle = typeof title === 'string' ? title.trim() : '';
  return {
    sessionId,
    projectPath,
    ...(trimmedTitle ? { title: trimmedTitle } : {}),
    favoritedAt,
  };
}

// The maximum is enforced on hydration too, so a hand-edited or corrupt value
// can never hydrate an unbounded list.
export function parseFavoriteSessions(raw: string): FavoriteSession[] {
  const value: unknown = JSON.parse(raw);
  if (!Array.isArray(value)) {
    throw new Error('Expected a list of favorite sessions.');
  }
  return value
    .map(toFavoriteEntry)
    .filter((entry): entry is FavoriteSession => entry !== undefined)
    .slice(0, FAVORITE_SESSIONS_MAX);
}

export function serializeFavoriteSessions(favorites: FavoriteSession[]): string {
  const entries = favorites
    .map(toFavoriteEntry)
    .filter((entry): entry is FavoriteSession => entry !== undefined)
    .slice(0, FAVORITE_SESSIONS_MAX);
  return JSON.stringify(entries);
}
