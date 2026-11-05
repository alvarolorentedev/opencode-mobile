// Small provider-agnostic helpers that do not belong to a specific domain
// (project labels, project list derivation, and grouping pending interactions
// by session).

import type { Project } from '@/shared/protocol/opencode/types';

import type { OpencodeProject } from '@/shared/contracts/domain';

import type { WorktreeCatalog } from '@/features/projects/state/use-worktree-state';

export function getProjectLabel(path: string) {
  const normalized = path.trim().replace(/\/$/, '');
  const segments = normalized.split('/').filter(Boolean);
  return segments.at(-1) || normalized || 'Project';
}

// Browser paths are relative to the project root; an empty result means root.
export function projectParentPath(path: string) {
  const normalized = path.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  const index = normalized.lastIndexOf('/');
  return index < 0 ? '' : normalized.slice(0, index);
}

// The picker renders the server catalog only. Labels come from the server.
export function buildOpencodeProjects(serverProjects: Project[]): OpencodeProject[] {
  const projects: OpencodeProject[] = [];
  const seen = new Set<string>();
  for (const remote of serverProjects) {
    if (seen.has(remote.worktree)) continue;
    seen.add(remote.worktree);
    projects.push({
      id: remote.id,
      label: remote.name || getProjectLabel(remote.worktree),
      path: remote.worktree,
    });
  }
  return projects;
}

// The active location can be a worktree: a server-known directory that belongs
// to a project but is not a project itself. Worktrees are confirmed by the
// worktree catalog (which resolves them server-side) so the owning project
// labels the active entry.
export function resolveActiveProject(projects: OpencodeProject[], activeProjectPath: string | undefined, worktrees: WorktreeCatalog | undefined): OpencodeProject | undefined {
  const worktree = worktrees?.project;
  if (activeProjectPath && worktree && worktree.root !== activeProjectPath && worktrees.entries.some((entry) => entry.directory === activeProjectPath)) {
    return { id: worktree.id, label: worktree.label, path: activeProjectPath };
  }
  return projects.find((project) => project.path === activeProjectPath);
}
