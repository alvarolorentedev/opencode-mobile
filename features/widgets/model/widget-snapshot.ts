// Headless widgets render this bounded provider snapshot. Enabled previews
// contain user-visible content; routing links never carry authentication data.
import { WIDGET_STATUSES } from '@/shared/contracts/widget-snapshot';

import type { WidgetSessionStatus, WidgetSessionEntry, WidgetSnapshot } from '@/shared/contracts/widget-snapshot';
export const WIDGET_SNAPSHOT_MAX_SESSIONS = 3;
export const WIDGET_SNAPSHOT_MAX_TITLE = 80;
const WIDGET_LINK_PREFIX = 'opencodemobile://session/';

function isWidgetStatus(value: unknown): value is WidgetSessionStatus {
  return typeof value === 'string' && (WIDGET_STATUSES as readonly string[]).includes(value);
}

export function parseWidgetSnapshot(value: unknown): WidgetSnapshot | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const record = value as Record<string, unknown>;
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
      ...(typeof (entry as Record<string, unknown>).preview === 'string' ? { preview: ((entry as Record<string, unknown>).preview as string).slice(0, WIDGET_MAX_EXCERPT) } : {}),
      ...(finite((entry as Record<string, unknown>).replyAt) ? { replyAt: (entry as Record<string, unknown>).replyAt as number } : {}),
    });
  }
  const snapshot: WidgetSnapshot = { updatedAt: record.updatedAt, sessions };
  if (typeof record.connectionScope === 'string') snapshot.connectionScope = record.connectionScope.slice(0, 2048);
  if (typeof record.showPreviews === 'boolean') snapshot.showPreviews = record.showPreviews;
  if (typeof record.language === 'string') snapshot.language = record.language.slice(0, 32);
  const attention = object(record.attention);
  if (attention && finite(attention.updatedAt) && Array.isArray(attention.rows) && count(attention.total)) {
    const rows = attention.rows.slice(0, 3).flatMap((entry) => {
      const row = object(entry);
      const base = row && parseWidgetSnapshot({ updatedAt: attention.updatedAt, sessions: [row] })?.sessions[0];
      if (!base || !row || !count(row.permissions) || !count(row.questions)) return [];
      return [{ ...base, permissions: row.permissions as number, questions: row.questions as number,
        ...(typeof row.excerpt === 'string' ? { excerpt: row.excerpt.slice(0, WIDGET_MAX_EXCERPT) } : {}) }];
    });
    snapshot.attention = { updatedAt: attention.updatedAt as number, rows, total: Math.max(attention.total as number, rows.length) };
  }
  const plan = object(record.plan);
  const session = plan && parseWidgetSnapshot({ updatedAt: plan.updatedAt, sessions: [plan.session] })?.sessions[0];
  if (plan && session && finite(plan.updatedAt) && count(plan.completed) && count(plan.total) && plan.completed <= plan.total && Array.isArray(plan.steps)) {
    snapshot.plan = { updatedAt: plan.updatedAt as number, session, completed: plan.completed as number, total: plan.total as number,
      steps: plan.steps.slice(0, 3).flatMap((entry) => {
        const step = object(entry);
        if (!step || !count(step.index) || step.index < 1 || !['pending', 'in_progress', 'completed', 'cancelled'].includes(String(step.status))) return [];
        return [{ index: step.index as number, status: String(step.status),
          ...(typeof step.content === 'string' ? { content: step.content.slice(0, WIDGET_MAX_EXCERPT) } : {}) }];
      }) };
  }
  return snapshot.showPreviews === false ? hideWidgetPreviews(snapshot) : snapshot;
}

const object = (value: unknown): Record<string, unknown> | undefined => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const count = (value: unknown): value is number => finite(value) && Number.isSafeInteger(value);

export const WIDGET_MAX_EXCERPT = 160;

export function hideWidgetPreviews(snapshot: WidgetSnapshot): WidgetSnapshot {
  return {
    ...snapshot, showPreviews: false,
    sessions: snapshot.sessions.map(({ preview: _preview, ...row }) => row),
    ...(snapshot.attention ? { attention: { ...snapshot.attention, rows: snapshot.attention.rows.map(({ excerpt: _excerpt, preview: _preview, ...row }) => row) } } : {}),
    ...(snapshot.plan ? { plan: { ...snapshot.plan, session: { ...snapshot.plan.session, preview: undefined }, steps: snapshot.plan.steps.map(({ content: _content, ...step }) => step) } } : {}),
  };
}
