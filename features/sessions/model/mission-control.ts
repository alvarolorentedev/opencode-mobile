import type { MissionConnectionActivity, MissionCounts, MissionFilter } from '@/shared/contracts/mission-control';
import { sessionKey, type ConnectionRecord, type SessionTarget, type WorkspaceCatalog } from '@/shared/contracts/workspace';
import type { Session } from '@/shared/protocol/opencode/types';

export const RECENT_COMPLETION_MS = 24 * 60 * 60 * 1000;
export type MissionStatus = MissionFilter | 'idle' | 'unknown';
export type MissionRow = {
  key: string;
  target: SessionTarget;
  title: string;
  server: string;
  project: string;
  projectKey: string;
  worktree?: string;
  agent?: string;
  model?: string;
  updatedAt: number;
  status: MissionStatus;
  permission: boolean;
  question: boolean;
  retrying: boolean;
  stale: boolean;
};

export const EMPTY_MISSION_COUNTS: MissionCounts = { attention: 0, running: 0, failed: 0, completed: 0 };
const order: MissionStatus[] = ['attention', 'running', 'failed', 'completed', 'idle', 'unknown'];
const basename = (path: string) => path.split(/[/\\]/).filter(Boolean).at(-1) ?? path;

function sessionStatus(session: Session, catalog: WorkspaceCatalog, activity: MissionConnectionActivity, now: number) {
  const event = activity.execution[session.id];
  const statusAt = Math.max(activity.running?.at ?? 0, activity.catalogAt ?? 0);
  const running = activity.running && activity.running.at >= (activity.catalogAt ?? 0)
    ? activity.running.ids.has(session.id) : Boolean(activity.catalogAt && catalog.statuses[session.id]?.type === 'busy');
  const newerEvent = event && (event.observedAt ?? event.at) >= statusAt;
  const settlementAt = session.time.idle;
  const settledAfterEvent = event && settlementAt && settlementAt > event.at && session.outcome;
  const retrying = event?.type === 'retry' && !settledAfterEvent && !running;
  if (retrying || (newerEvent ? event.type === 'busy' : running)) return { status: 'running' as const, retrying };
  const outcome = event && !settledAfterEvent ? event.type : activity.catalogAt ? session.outcome : undefined;
  const at = event && !settledAfterEvent ? event.at : settlementAt;
  const observedNow = Math.max(now, activity.checkedAt ?? 0, activity.catalogAt ?? 0, event?.observedAt ?? 0);
  if (outcome === 'failed') return { status: 'failed' as const, retrying: false };
  if (outcome === 'succeeded' && at && at <= observedNow && observedNow - at < RECENT_COMPLETION_MS) {
    return { status: 'completed' as const, retrying: false, expires: at + RECENT_COMPLETION_MS };
  }
  return { status: statusAt || event || outcome ? 'idle' as const : 'unknown' as const, retrying: false };
}

export function countMissionRows(rows: MissionRow[]): MissionCounts {
  const counts = { ...EMPTY_MISSION_COUNTS };
  for (const { status } of rows) {
    if (status !== 'idle' && status !== 'unknown') counts[status]++;
  }
  return counts;
}

export function missionBadge(count: number) {
  return count > 99 ? '99+' : count || undefined;
}

export function selectMission(connections: readonly Pick<ConnectionRecord, 'id' | 'name' | 'revision' | 'enabled'>[], catalogs: Record<string, WorkspaceCatalog>, now: number) {
  const rows: MissionRow[] = [];
  const servers = [];
  let expires: number | undefined;
  let checkedAt: number | undefined;
  for (const connection of connections) {
    if (!connection.enabled) continue;
    const catalog = catalogs[connection.id];
    const candidate = catalog?.mission;
    const activity = candidate?.revision === connection.revision ? candidate : undefined;
    const phase = activity?.phase ?? 'checking';
    const live = phase === 'ready' || phase === 'partial' || phase === 'checking';
    const global = { permissions: new Set<string>(), questions: new Set<string>() };
    let globalTarget: MissionRow | undefined;
    if (activity && activity.authorized && phase !== 'unsupported') {
      const sessions = new Map([...activity.supplemental, ...catalog.sessions].map((session) => [session.id, session]));
      const pending = { permissions: new Set<string>(), questions: new Set<string>() };
      if (live) {
        for (const [directory, approvals] of Object.entries(activity.approvals)) {
          for (const kind of ['permissions', 'questions'] as const) {
            for (const request of approvals[kind] ?? []) {
              if (request.sessionID === 'global') global[kind].add(request.id);
              if (sessions.get(request.sessionID)?.directory === directory) pending[kind].add(request.sessionID);
            }
          }
        }
      }
      const projects = new Map(activity.projects.map((project) => [project.id, project]));
      for (const session of sessions.values()) {
        if (!session.directory || session.time.archived || activity.removed.has(session.id)
          || (session.projectID && activity.archivedProjects?.has(session.projectID))) continue;
        const permission = pending.permissions.has(session.id);
        const question = pending.questions.has(session.id);
        const state = sessionStatus(session, catalog, activity, now);
        const target = { connectionId: connection.id, projectPath: session.directory, sessionId: session.id };
        const project = session.projectID ? projects.get(session.projectID) : undefined;
        const status = live ? permission || question ? 'attention' : state.status : 'unknown';
        const row: MissionRow = { key: sessionKey(target), target, title: session.title, status, permission, question, retrying: state.retrying,
          updatedAt: session.time.updated, server: connection.name, project: project?.name || basename(project?.worktree || session.directory),
          projectKey: JSON.stringify([connection.id, project?.id ?? session.directory]),
          worktree: project && project.worktree !== session.directory ? basename(session.directory) : undefined,
          agent: session.agent, model: session.model?.id, stale: !live || (state.status === 'unknown' && status !== 'attention' && phase !== 'checking') };
        rows.push(row);
        if (!session.parentID && (!globalTarget || globalTarget.updatedAt < row.updatedAt)) globalTarget = row;
        if (state.expires && status === 'completed') expires = Math.min(expires ?? Infinity, state.expires);
      }
      if (live && activity.checkedAt) checkedAt = Math.min(checkedAt ?? Infinity, activity.checkedAt);
    }
    servers.push({ id: connection.id, name: connection.name, phase, refresh: activity?.refresh, authorized: activity?.authorized,
      requests: global.permissions.size + global.questions.size, globalTarget });
  }
  rows.sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status) || b.updatedAt - a.updatedAt || a.key.localeCompare(b.key));
  return { rows, counts: countMissionRows(rows), servers, expires, checkedAt };
}

export type MissionOverview = ReturnType<typeof selectMission>;
