import type { SessionMessageRecord } from '@/shared/presentation/format';
import { getToolTitle } from '@/shared/presentation/format/tool';
import type { Session, SessionStatus } from '@/shared/protocol/opencode/types';

export type ActivitySnapshot = {
  sessions: Session[];
  statuses: Record<string, SessionStatus>;
  blocked: Set<string>;
  queued: Set<string>;
  messages: Record<string, SessionMessageRecord[]>;
};

export type SessionActivity = {
  session: Session;
  active: boolean;
  state: 'thinking' | 'needsInput' | 'retrying' | 'queued' | 'finished' | 'failed' | 'stopped';
  tool?: string;
};

export function getSessionActivities(snapshot: ActivitySnapshot): SessionActivity[] {
  const byId = new Map(snapshot.sessions.map((session) => [session.id, session]));
  const groups = new Map<string, Session[]>();
  for (const session of snapshot.sessions) {
    if (session.time.archived || !session.directory) continue;
    let root = session;
    const seen = new Set([session.id]);
    while (root.parentID && byId.has(root.parentID) && !seen.has(root.parentID)) {
      seen.add(root.parentID);
      root = byId.get(root.parentID)!;
    }
    if (root.time.archived || !root.directory) continue;
    groups.set(root.id, [...(groups.get(root.id) ?? []), session]);
  }
  return [...groups.entries()].map(([id, family]) => {
    const session = byId.get(id)!;
    const blocked = family.some((child) => snapshot.blocked.has(child.id));
    const retrying = family.some((child) => snapshot.statuses[child.id]?.type === 'retry');
    const busy = family.some((child) => snapshot.statuses[child.id]?.type === 'busy');
    const queued = family.some((child) => snapshot.queued.has(child.id));
    const records = family.flatMap((child) => snapshot.messages[child.id] ?? []).sort((a, b) => a.info.time.created - b.info.time.created);
    const latest = records.filter((record) => record.info.role === 'assistant').at(-1);
    const runningTool = records.flatMap((record) => record.parts).findLast((part) => part.type === 'tool' && part.state.status === 'running');
    const error = latest?.info.role === 'assistant' ? latest.info.error : undefined;
    return {
      session, active: blocked || retrying || busy || queued,
      state: blocked ? 'needsInput' : retrying ? 'retrying' : busy ? 'thinking' : queued ? 'queued'
        : error?.name === 'MessageAbortedError' ? 'stopped' : error ? 'failed' : 'finished',
      tool: busy && runningTool?.type === 'tool' ? getToolTitle(runningTool).replace(/\s+/g, ' ').slice(0, 100) : undefined,
    };
  });
}

export function selectDisplayedActivity(activities: SessionActivity[], currentSessionId?: string) {
  return activities.filter((activity) => activity.active).sort((a, b) =>
    Number(b.state === 'needsInput') - Number(a.state === 'needsInput')
    || Number(b.session.id === currentSessionId) - Number(a.session.id === currentSessionId)
    || b.session.time.updated - a.session.time.updated
    || a.session.id.localeCompare(b.session.id))[0];
}
