import { useMemo } from 'react';

import { projectCheckouts, type ProjectCheckout } from '@/shared/protocol/opencode/project';
import { useProjectFiles, useProjects } from '@/features/projects/context';
import type { OpencodeProject } from '@/shared/contracts/domain';
import type { WorktreeCatalog } from '@/features/projects/state/use-worktree-state';

export type ProjectCheckoutState = {
  activeProject?: OpencodeProject;
  root?: string;
  checkouts: ProjectCheckout[];
  activeCheckout?: ProjectCheckout;
  multiple: boolean;
  worktrees: WorktreeCatalog;
};

// The current project's worktree catalog is already server-scoped and is
// refreshed by the provider. This derives the two-level header without adding
// another network owner.
export function useProjectCheckouts(): ProjectCheckoutState {
  const { activeProject } = useProjects();
  const { worktrees, vcsInfo } = useProjectFiles();
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
  }), [activeProject, checkouts, root, worktrees]);
}
