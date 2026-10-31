import { z } from 'zod';

import { getConnectionScope } from '@/shared/contracts/connection-scope';
import { stripServerUrlCredentials } from '@/shared/contracts/server-url';
import type { OpencodeConnectionSettings } from '@/shared/protocol/opencode/client';

// Pending completion-notification records are the durable contract between a
// running prompt and the background monitor. They must stay non-secret: only
// the connection identity (`serverUrl`, `username`, `connectionScope`) is
// stored, never a password. Credentials are resolved at runtime through
// `resolveConnectionCredentials`.
export type PendingNotificationSession = {
  sessionId: string;
  sessionTitle?: string;
  projectPath: string;
  connectionScope: string;
  settings: Pick<OpencodeConnectionSettings, 'serverUrl' | 'username'>;
  requestedAt: number;
  // Non-secret marker for the last attention alert raised for this record
  // (for example "blocked"). It prevents repeated needs-input alerts while a
  // task stays blocked and is cleared again when the block resolves.
  attentionKey?: string;
};

// Session IDs are only unique per server, so the persisted map and the
// in-memory tracker both key records by connection scope + session ID.
export function pendingNotificationKey(connectionScope: string, sessionId: string) {
  return `${connectionScope}\u0000${sessionId}`;
}

const PendingNotificationSessionSchema = z.object({
  sessionId: z.string().refine((value) => value.trim().length > 0),
  sessionTitle: z.string().optional(),
  projectPath: z.string().refine((value) => value.trim().length > 0),
  connectionScope: z.unknown().optional(),
  settings: z.object({
    serverUrl: z.string().refine((value) => value.trim().length > 0),
    username: z.string(),
  }),
  requestedAt: z.number().finite(),
  attentionKey: z.string().optional(),
});

function toPendingNotificationSession(value: unknown): PendingNotificationSession | undefined {
  const parsed = PendingNotificationSessionSchema.safeParse(value);
  if (!parsed.success) return undefined;
  const { sessionId, sessionTitle, projectPath, connectionScope, settings, requestedAt, attentionKey } = parsed.data;

  // Records written before multi-server support carry the connection fields but
  // no scope; the scope is derived from them, never guessed, so those pending
  // tasks keep working.
  const scope = typeof connectionScope === 'string' && connectionScope.trim()
    ? connectionScope
    : getConnectionScope({ serverUrl: settings.serverUrl, username: settings.username });

  return {
    sessionId,
    ...(sessionTitle?.trim() ? { sessionTitle: sessionTitle.trim() } : {}),
    projectPath,
    connectionScope: scope,
    settings: { serverUrl: stripServerUrlCredentials(settings.serverUrl), username: settings.username },
    requestedAt,
    ...(attentionKey?.trim() ? { attentionKey: attentionKey.trim() } : {}),
  };
}

/**
 * Validates a persisted pending-notification map and rebuilds it with explicit
 * DTOs. Extra fields (including a legacy plaintext `password`) are dropped, and
 * malformed entries are discarded individually instead of failing hydration.
 * Keys are always recomputed from the record so two servers can never collide
 * on the same session ID.
 */
export function parsePendingNotificationSessions(raw: string): Record<string, PendingNotificationSession> {
  const value = z.record(z.string(), z.unknown()).parse(JSON.parse(raw));

  const parsed: Record<string, PendingNotificationSession> = {};
  for (const entry of Object.values(value)) {
    const pending = toPendingNotificationSession(entry);
    if (!pending) continue;
    parsed[pendingNotificationKey(pending.connectionScope, pending.sessionId)] = pending;
  }
  return parsed;
}

export function serializePendingNotificationSessions(value: Record<string, PendingNotificationSession>) {
  const sanitized: Record<string, PendingNotificationSession> = {};
  for (const entry of Object.values(value)) {
    const pending = toPendingNotificationSession(entry);
    if (!pending) continue;
    sanitized[pendingNotificationKey(pending.connectionScope, pending.sessionId)] = pending;
  }
  return JSON.stringify(sanitized);
}
