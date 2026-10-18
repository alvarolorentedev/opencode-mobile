// Small provider-agnostic helpers that do not belong to a specific domain
// (project labels, workspace list derivation, and grouping pending interactions
// by session).

import type { Project, Session, SessionStatus } from '@/lib/opencode/types';
import type { OpencodeProject } from '@/providers/opencode-provider-types';
import type { WorktreeCatalog } from '@/providers/use-worktree-state';

// V2 `retry` is event-only: the session-list status endpoint derives its map
// from the running set, which cannot express a retry. A list refresh would
// therefore downgrade a server-scheduled retry to idle, disabling the safety
// poll (idle connected sessions do not poll) and freezing the transcript if the
// retry's SSE frames are missed. Preserve the event-derived retry until the
// server reports the session running, a terminal execution/idle event clears
// it, or it goes stale.
// ponytail: 2-minute stale ceiling; a legitimately longer retry window would
// need a real completion signal instead of the `next` timestamp.
export const RETRY_STATUS_STALE_MS = 120_000;

export function mergeSessionStatuses(
  previous: Record<string, SessionStatus>,
  fetched: Record<string, SessionStatus>,
  now = Date.now(),
): Record<string, SessionStatus> {
  const next: Record<string, SessionStatus> = {};
  for (const [id, status] of Object.entries(fetched)) {
    const prior = previous[id];
    const stale = prior?.type === 'retry' && prior.next ? now - prior.next >= RETRY_STATUS_STALE_MS : false;
    next[id] = status.type === 'idle' && prior?.type === 'retry' && !stale ? prior : status;
  }
  return next;
}

export function getProjectLabel(path: string) {
  const normalized = path.trim().replace(/\/$/, '');
  const segments = normalized.split('/').filter(Boolean);
  return segments.at(-1) || normalized || 'Project';
}

// The picker mirrors the server's project list. Nothing is derived from the
// selected path, so a refresh that omits a directory can never leave a phantom
// workspace behind.
export function buildOpencodeProjects(serverProjects: Project[], currentProjectPath?: string): OpencodeProject[] {
  const entries = new Map<string, OpencodeProject>();
  serverProjects.forEach((project) => {
    entries.set(project.worktree, {
      id: project.id,
      label: getProjectLabel(project.worktree),
      path: project.worktree,
      source: 'server',
      updatedAt: project.time.initialized || project.time.created,
      isCurrent: project.worktree === currentProjectPath,
    });
  });
  return [...entries.values()].sort((left, right) => (right.updatedAt || 0) - (left.updatedAt || 0));
}

// The active location can be a worktree: a server-known directory that belongs
// to a project but is not a project itself. Worktrees are confirmed by the
// worktree catalog (which resolves them server-side); a project entry is only
// used when it came from the server list.
export function resolveActiveProject(projects: OpencodeProject[], activeProjectPath: string | undefined, currentProjectPath: string | undefined, worktrees: WorktreeCatalog | undefined): OpencodeProject | undefined {
  const listed = projects.find((project) => project.path === activeProjectPath);
  if (listed) return listed;
  const project = worktrees?.project;
  if (!activeProjectPath || !project || project.root === activeProjectPath) return undefined;
  if (!worktrees.entries.some((entry) => entry.directory === activeProjectPath)) return undefined;
  return { id: project.id, label: project.label, path: activeProjectPath, source: 'server', isCurrent: activeProjectPath === currentProjectPath };
}

// Equality guards so a no-op poll refresh keeps the previous state identity and
// does not wake every consumer of the session contexts.
export function areSessionListsEqual(previous: Session[], next: Session[]): boolean {
  if (previous === next) {
    return true;
  }
  if (previous.length !== next.length) {
    return false;
  }
  for (let index = 0; index < previous.length; index += 1) {
    const left = previous[index];
    const right = next[index];
    if (left.id !== right.id || left.time.updated !== right.time.updated || left.title !== right.title
      || left.cost !== right.cost || JSON.stringify(left.tokens) !== JSON.stringify(right.tokens)) {
      return false;
    }
  }
  return true;
}

export function areSessionStatusMapsEqual(
  previous: Record<string, SessionStatus>,
  next: Record<string, SessionStatus>,
): boolean {
  if (previous === next) {
    return true;
  }
  const previousKeys = Object.keys(previous);
  if (previousKeys.length !== Object.keys(next).length) {
    return false;
  }
  for (const key of previousKeys) {
    const left = previous[key];
    const right = next[key];
    if (!right || left.type !== right.type) {
      return false;
    }
    if (left.type === 'retry' && right.type === 'retry' && (left.attempt !== right.attempt || left.next !== right.next)) {
      return false;
    }
  }
  return true;
}

// Subagent (and nested sub-subagent) permission/question requests carry the
// child session's id, but the active chat only knows the root session. Walk the
// parentID tree so a blocker raised anywhere below the current/sending session
// still surfaces instead of hanging the whole subtree. Roots are included.
export function collectDescendantSessionIds(
  sessions: Session[],
  rootIds: (string | undefined)[],
): Set<string> {
  const result = new Set(rootIds.filter((id): id is string => Boolean(id)));
  let frontier = [...result];
  while (frontier.length > 0) {
    const parents = new Set(frontier);
    frontier = [];
    for (const session of sessions) {
      if (session.parentID && parents.has(session.parentID) && !result.has(session.id)) {
        result.add(session.id);
        frontier.push(session.id);
      }
    }
  }
  return result;
}

export function groupPendingRequestsBySession<T extends { id: string; sessionID: string }>(requests: T[]) {
  return requests.reduce<Record<string, T[]>>((acc, request) => {
    const existing = acc[request.sessionID] || [];
    if (existing.some((item) => item.id === request.id)) {
      return acc;
    }

    acc[request.sessionID] = [...existing, request];
    return acc;
  }, {});
}
