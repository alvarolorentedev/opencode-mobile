import { buildSessionLink } from '@/lib/session-link';
import type { ActiveSessionItem } from '@/providers/opencode-provider-types';

// Persisted, non-secret snapshot of the most recent tasks for the Android home
// widget. The widget handler runs headless (outside React), so it cannot read
// provider state and renders from this bounded snapshot instead. Session links
// carry no credentials; they resolve through app/session/[id].tsx like every
// other session deep link.
export const WIDGET_SNAPSHOT_MAX_SESSIONS = 3;
export const WIDGET_SNAPSHOT_MAX_TITLE = 80;
const WIDGET_LINK_PREFIX = 'opencodemobile://session/';
const WIDGET_STATUSES = ['idle', 'busy', 'retry'] as const;

export type WidgetSessionStatus = (typeof WIDGET_STATUSES)[number];

export type WidgetSessionEntry = {
  id: string;
  title: string;
  status: WidgetSessionStatus;
  link: string;
};

export type WidgetSnapshot = {
  updatedAt: number;
  sessions: WidgetSessionEntry[];
};

export function buildWidgetSnapshot({
  activeSessions,
  connectionScope,
  untitledLabel,
  updatedAt,
}: {
  activeSessions: ActiveSessionItem[];
  connectionScope: string;
  untitledLabel: string;
  updatedAt: number;
}): WidgetSnapshot {
  const sessions = connectionScope
    ? activeSessions
      .filter((session) => Boolean(session.sessionId) && Boolean(session.projectPath))
      .slice(0, WIDGET_SNAPSHOT_MAX_SESSIONS)
      .map((session) => ({
        id: session.sessionId,
        title: (session.title?.trim() || untitledLabel).slice(0, WIDGET_SNAPSHOT_MAX_TITLE),
        status: session.status.type,
        link: buildSessionLink({
          sessionId: session.sessionId,
          projectPath: session.projectPath,
          connectionScope,
        }),
      }))
    : [];
  return { updatedAt, sessions };
}

function isWidgetStatus(value: unknown): value is WidgetSessionStatus {
  return typeof value === 'string' && (WIDGET_STATUSES as readonly string[]).includes(value);
}

export function parseWidgetSnapshot(value: unknown): WidgetSnapshot | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const record = value as { updatedAt?: unknown; sessions?: unknown };
  if (typeof record.updatedAt !== 'number' || !Number.isFinite(record.updatedAt)) return undefined;
  if (!Array.isArray(record.sessions)) return undefined;
  const sessions: WidgetSessionEntry[] = [];
  for (const entry of record.sessions.slice(0, WIDGET_SNAPSHOT_MAX_SESSIONS)) {
    if (typeof entry !== 'object' || entry === null) continue;
    const { id, title, status, link } = entry as Record<string, unknown>;
    if (typeof id !== 'string' || !id.trim()) continue;
    if (typeof title !== 'string' || !title.trim()) continue;
    if (!isWidgetStatus(status)) continue;
    if (typeof link !== 'string' || !link.startsWith(WIDGET_LINK_PREFIX) || link.length > 2048) continue;
    sessions.push({
      id: id.trim(),
      title: title.slice(0, WIDGET_SNAPSHOT_MAX_TITLE),
      status,
      link,
    });
  }
  return { updatedAt: record.updatedAt, sessions };
}
