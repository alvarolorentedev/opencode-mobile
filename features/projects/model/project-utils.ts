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

// The picker mirrors the desktop Home list: it renders the projects the user
// opened on this connection and enriches them with the server's project
// metadata (id and display name). A remote project that was never opened is not
// rendered.
export function buildOpencodeProjects(openedPaths: string[], serverProjects: Project[]): OpencodeProject[] {
  const remoteByPath = new Map(serverProjects.map((project) => [project.worktree, project]));
  return openedPaths.map((path) => {
    const remote = remoteByPath.get(path);
    return {
      ...(remote ? { id: remote.id } : {}),
      label: remote?.name || getProjectLabel(path),
      path,
    };
  });
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
