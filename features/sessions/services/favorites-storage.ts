import { z } from 'zod';

import { FAVORITE_SESSIONS_MAX, type FavoriteSession } from '@/shared/contracts/domain';

// Maps one persisted entry to the explicit favorite model, dropping unknown
// fields (for example the legacy `projectLabel`, which is derived from the
// project path) and discarding malformed entries instead of failing the whole
// list.
//
// `connectionScope` is required: favorites written before multi-server support
// have no way to say which server their session belongs to, so they are
// dropped rather than guessed.
const FavoriteSessionSchema = z.object({
  sessionId: z.string().refine((value) => value.trim().length > 0),
  connectionScope: z.string().refine((value) => value.trim().length > 0).transform((value) => value.trim()),
  projectPath: z.string().refine((value) => value.trim().length > 0),
  title: z.string().optional().transform((value) => value?.trim() || undefined),
  favoritedAt: z.number().finite(),
});

function toFavoriteEntry(value: unknown): FavoriteSession | undefined {
  const parsed = FavoriteSessionSchema.safeParse(value);
  if (!parsed.success) return undefined;
  const { title, ...entry } = parsed.data;
  return { ...entry, ...(title ? { title } : {}) };
}

// The maximum is enforced on hydration too, so a hand-edited or corrupt value
// can never hydrate an unbounded list.
export function parseFavoriteSessions(raw: string): FavoriteSession[] {
  const value = z.array(z.unknown()).parse(JSON.parse(raw));
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
