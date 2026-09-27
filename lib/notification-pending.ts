import { getConnectionScope } from '@/lib/connection-scope';
import type { OpencodeConnectionSettings } from '@/lib/opencode/client';

// Pending completion-notification records are the durable contract between a
// running prompt and the background monitor. They must stay non-secret: only
// the connection identity (`serverUrl`, `username`, `connectionScope`) is
// stored, never a password. Credentials are resolved at runtime through
// `resolveConnectionPassword`.
export type PendingNotificationSession = {
  sessionId: string;
  sessionTitle?: string;
  projectPath: string;
  connectionScope: string;
  settings: Pick<OpencodeConnectionSettings, 'serverUrl' | 'username'>;
  requestedAt: number;
};

// Session IDs are only unique per server, so the persisted map and the
// in-memory tracker both key records by connection scope + session ID.
export function pendingNotificationKey(connectionScope: string, sessionId: string) {
  return `${connectionScope}\u0000${sessionId}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toPendingNotificationSession(value: unknown): PendingNotificationSession | undefined {
  if (!isRecord(value)) return undefined;

  const { sessionId, sessionTitle, projectPath, connectionScope, settings, requestedAt } = value;
  if (typeof sessionId !== 'string' || !sessionId.trim()) return undefined;
  if (typeof projectPath !== 'string' || !projectPath.trim()) return undefined;
  if (typeof requestedAt !== 'number' || !Number.isFinite(requestedAt)) return undefined;
  if (sessionTitle !== undefined && typeof sessionTitle !== 'string') return undefined;
  if (!isRecord(settings)) return undefined;
  const { serverUrl, username } = settings;
  if (typeof serverUrl !== 'string' || !serverUrl.trim()) return undefined;
  if (typeof username !== 'string') return undefined;

  // Records written before multi-server support carry the connection fields but
  // no scope; the scope is derived from them, never guessed, so those pending
  // tasks keep working.
  const scope = typeof connectionScope === 'string' && connectionScope.trim()
    ? connectionScope
    : getConnectionScope({ serverUrl, username });

  return {
    sessionId,
    ...(typeof sessionTitle === 'string' && sessionTitle.trim() ? { sessionTitle: sessionTitle.trim() } : {}),
    projectPath,
    connectionScope: scope,
    settings: { serverUrl, username },
    requestedAt,
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
  const value: unknown = JSON.parse(raw);
  if (!isRecord(value)) {
    throw new Error('Expected pending notification records.');
  }

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
