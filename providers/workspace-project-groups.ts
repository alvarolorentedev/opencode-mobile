import { compareLabels } from '@/lib/compare-labels';
import { projectCheckouts, type ProjectCheckout, type ProjectWorktree } from '@/lib/opencode/project';
import type { OpencodeProject } from '@/providers/opencode-provider-types';
import { getProjectLabel } from '@/providers/opencode-provider-utils';
import type { ConnectionRecord, WorkspaceSnapshot } from '@/providers/workspace-types';

export type WorkspaceProject = OpencodeProject & {
  checkouts: ProjectCheckout[];
  loadingWorktrees: boolean;
  worktreesError?: string;
};

export type WorkspaceServerGroup = {
  id: string;
  name: string;
  enabled: boolean;
  status: string;
  projects: WorkspaceProject[];
};

type ProjectSnapshotValues = {
  projectsValue: {
    activeProjectPath?: string;
    activeProject?: OpencodeProject;
  };
  projectFilesValue: {
    worktrees: {
      entries: ProjectWorktree[];
      project?: { id?: string; root: string; label: string };
      loading: boolean;
      error?: string;
    };
    vcsInfo?: { branch?: string };
  };
};

// Merge the runtimes for one repository checkout into one project row. A
// repository can be opened once as its main checkout and again as a worktree;
// the project list must still show one project with several checkouts.
export function buildWorkspaceProjectGroups(
  connections: readonly ConnectionRecord[],
  snapshots: Record<string, WorkspaceSnapshot>,
): WorkspaceServerGroup[] {
  const byConnection = new Map<string, WorkspaceSnapshot[]>();
  for (const [key, snapshot] of Object.entries(snapshots)) {
    const connectionId = (JSON.parse(key) as [string, string])[0];
    const list = byConnection.get(connectionId);
    if (list) list.push(snapshot);
    else byConnection.set(connectionId, [snapshot]);
  }

  return connections.map((entry) => {
    const runtimes = byConnection.get(entry.id) ?? [];
    const byRoot = new Map<string, WorkspaceProject>();
    for (const runtime of runtimes) {
      const values = runtime.values as unknown as ProjectSnapshotValues;
      const active = values.projectsValue.activeProject;
      const activePath = values.projectsValue.activeProjectPath ?? active?.path;
      const catalog = values.projectFilesValue.worktrees;
      const root = catalog.project?.root ?? activePath;
      if (!root) continue;

      const label = catalog.project?.label ?? active?.label ?? getProjectLabel(root);
      const project = byRoot.get(root) ?? {
        ...(catalog.project?.id || active?.id ? { id: catalog.project?.id ?? active?.id } : {}),
        label,
        path: root,
        checkouts: [],
        loadingWorktrees: false,
      };
      const checkouts = projectCheckouts(root, catalog.entries, activePath, values.projectFilesValue.vcsInfo?.branch);
      for (const checkout of checkouts) {
        const previous = project.checkouts.find((item) => item.directory === checkout.directory);
        if (!previous) project.checkouts.push({ ...checkout });
        else if (!previous.branch && checkout.branch) previous.branch = checkout.branch;
      }
      project.checkouts.sort((left, right) => (
        left.isMain === right.isMain ? compareLabels(left.name, right.name) : left.isMain ? -1 : 1
      ));
      project.loadingWorktrees = project.loadingWorktrees || catalog.loading;
      if (catalog.error && !project.worktreesError) project.worktreesError = catalog.error;
      if (catalog.project?.label) project.label = catalog.project.label;
      if (catalog.project?.id) project.id = catalog.project.id;
      byRoot.set(root, project);
    }
    return {
      id: entry.id,
      name: entry.name,
      enabled: entry.enabled,
      status: runtimes[0]?.values.connectionValue.connection.status ?? 'idle',
      projects: [...byRoot.values()].sort((left, right) => compareLabels(left.label, right.label)),
    };
  });
}
