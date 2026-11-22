import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { useProjectScope } from '@/runtime/core';
import { projectCheckouts, type ProjectCheckout } from '@/shared/protocol/opencode/project';
import type { OpencodeProject, WorktreeCatalog } from '@/features/projects/model/types';
import { useProjectInventory } from './use-project-inventory';
import { useWorktreeActions } from './use-worktree-actions';
import { vcsInfoOptions } from '../services/queries/status';

export type ProjectCheckoutState = {
  activeProject?: OpencodeProject;
  root?: string;
  checkouts: ProjectCheckout[];
  activeCheckout?: ProjectCheckout;
  multiple: boolean;
  worktrees: WorktreeCatalog;
  refreshWorktrees: () => Promise<void>;
  removeWorktree: (directory: string) => Promise<void>;
};

// The current project's worktree catalog is already server-scoped and is
// refreshed by the provider. This derives the two-level header without adding
// another network owner.
export function useProjectCheckouts(): ProjectCheckoutState {
  const scope = useProjectScope();
  const { project: { activeProject }, worktrees, serverProjects } = useProjectInventory(scope);
  const { data: vcsInfo } = useQuery({ ...vcsInfoOptions(scope.identity, scope.client), enabled: false });
  const { refreshWorktrees, removeWorktree } = useWorktreeActions(scope, serverProjects);
  const root = worktrees.project?.root ?? activeProject?.path;
  const checkouts = useMemo(
    () => projectCheckouts(root, worktrees.entries, activeProject?.path, vcsInfo?.branch),
    [root, worktrees.entries, activeProject?.path, vcsInfo?.branch],
  );
  return useMemo(() => ({
    activeProject,
    root,
    checkouts,
    activeCheckout: checkouts.find((checkout) => checkout.directory === activeProject?.path) ?? checkouts.find((checkout) => checkout.isMain),
    multiple: checkouts.length > 1,
    worktrees,
    refreshWorktrees,
    removeWorktree,
  }), [activeProject, checkouts, refreshWorktrees, removeWorktree, root, worktrees]);
}
