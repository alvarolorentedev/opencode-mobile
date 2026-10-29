import { compareLabels } from '@/lib/compare-labels';
import type { FileNode, Worktree } from './types';

export type ProjectFileEntry = Pick<FileNode, 'path' | 'name' | 'type'>;
export type ProjectWorktree = Pick<Worktree, 'directory' | 'name'> & { branch?: string };
export type ProjectCheckout = {
  directory: string;
  name: string;
  branch?: string;
  isMain: boolean;
};

export function projectPath(path: string, root: string, allowRoot = false): string {
  if (!root.trim()) throw new Error('Choose a project before accessing files.');
  const value = path.replace(/\\/g, '/');
  const base = root.replace(/\\/g, '/').replace(/\/+$/, '');
  const absolute = value.startsWith('/') || /^[a-z]:\//i.test(value);
  if (absolute && value !== base && !value.startsWith(`${base}/`)) throw new Error('The path is outside the selected project.');
  const relative = absolute ? value.slice(base.length).replace(/^\//, '') : value;
  if (relative.split('/').includes('..') || /[\x00-\x1f]/.test(relative)) throw new Error('Invalid project path.');
  const normalized = relative.split('/').filter((part) => part && part !== '.').join('/');
  if (!allowRoot && !normalized) throw new Error('A file path is required.');
  return normalized;
}

export function projectEntries(entries: Pick<FileNode, 'path' | 'type'>[], root: string): ProjectFileEntry[] {
  return entries.map((entry) => {
    const path = projectPath(entry.path, root);
    return { path, name: path.split('/').pop()!, type: entry.type };
  }).sort((a, b) => a.type === b.type ? compareLabels(a.name, b.name) : a.type === 'directory' ? -1 : 1);
}

export function projectWorktrees(entries: (string | Pick<Worktree, 'directory'> & Partial<Worktree>)[]): ProjectWorktree[] {
  return entries.map((entry) => {
    const directory = typeof entry === 'string' ? entry : entry.directory;
    return { directory, name: (typeof entry === 'string' ? undefined : entry.name) || directory.split(/[\\/]/).filter(Boolean).pop() || directory,
      branch: typeof entry === 'string' ? undefined : entry.branch };
  });
}

// The main checkout is always first. The active checkout is included even when
// the worktree catalog is still loading, so the header never loses the current
// location while it resolves.
export function projectCheckouts(
  root: string | undefined,
  entries: ProjectWorktree[],
  activePath?: string,
  activeBranch?: string,
): ProjectCheckout[] {
  const mainRoot = root?.trim();
  const byDirectory = new Map<string, ProjectCheckout>();
  if (mainRoot) {
    byDirectory.set(mainRoot, {
      directory: mainRoot,
      name: 'Local',
      branch: activePath === mainRoot ? activeBranch : undefined,
      isMain: true,
    });
  }
  for (const entry of entries) {
    if (!entry.directory || entry.directory === mainRoot || byDirectory.has(entry.directory)) {
      continue;
    }
    byDirectory.set(entry.directory, {
      directory: entry.directory,
      name: entry.name || entry.directory.split(/[\\/]/).filter(Boolean).pop() || entry.directory,
      branch: entry.branch,
      isMain: false,
    });
  }
  if (activePath && !byDirectory.has(activePath)) {
    byDirectory.set(activePath, {
      directory: activePath,
      name: activePath.split(/[\\/]/).filter(Boolean).pop() || activePath,
      branch: activeBranch,
      isMain: !mainRoot,
    });
  }
  return [...byDirectory.values()].sort((left, right) => (
    left.isMain === right.isMain ? compareLabels(left.name, right.name) : left.isMain ? -1 : 1
  ));
}
