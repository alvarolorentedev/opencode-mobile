import { compareLabels } from '@/shared/utilities/compare-labels';
import { projectCheckouts, type ProjectCheckout, type ProjectWorktree } from '@/shared/protocol/opencode/project';
import type { OpencodeProject } from '@/shared/contracts/domain';
import { getProjectLabel } from '@/features/projects/model/project-utils';
import type { ConnectionRecord } from '@/shared/contracts/workspace';
import type { WorkspaceSnapshot } from '@/runtime/workspace';

export type WorkspaceProject = OpencodeProject & {
  checkouts: ProjectCheckout[];
  loadingWorktrees: boolean;
  opened: boolean;
  worktreesError?: string;
};

export type WorkspaceServerGroup = {
  id: string;
  name: string;
  enabled: boolean;
  status: string;
  contract?: 'v1' | 'v2';
  projects: WorkspaceProject[];
};

type ProjectSnapshotValues = {
  projectsValue: {
    activeProjectPath?: string;
    activeProject?: OpencodeProject;
    projects?: OpencodeProject[];
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

  // Only connected servers own selectable project groups. Disconnected and
  // non-connected profiles stay in Connection management so they can be
  // reconnected without appearing in settings or project selectors.
  return connections.map((entry) => {
    const runtimes = byConnection.get(entry.id) ?? [];
    // The server catalog is the list, like the web client. Retained runtimes
    // for directories the server no longer reports must not become rows.
    // Until any runtime on the connection reports a catalog, keep the active
    // roots so a cold start never flashes an empty picker.
    const serverKnown = new Set<string>();
    for (const runtime of runtimes) {
      const values = runtime.values as unknown as ProjectSnapshotValues;
      for (const project of values.projectsValue.projects ?? []) {
        if (project.id) serverKnown.add(project.path);
      }
    }
    const byRoot = new Map<string, WorkspaceProject>();
    for (const runtime of runtimes) {
      const values = runtime.values as unknown as ProjectSnapshotValues;
      // The server catalog is connection-wide while a snapshot is per opened
      // project. Every runtime carries the same catalog, so seed every known
      // server project first and let the active runtime below enrich its own
      // row. Opened worktree paths have no server project id and stay in their
      // owning project's checkout list instead of becoming project rows.
      for (const project of values.projectsValue.projects ?? []) {
        if (!project.id || byRoot.has(project.path)) continue;
        byRoot.set(project.path, {
          ...(project.id ? { id: project.id } : {}),
          label: project.label,
          path: project.path,
          checkouts: projectCheckouts(project.path, []),
          loadingWorktrees: false,
          opened: false,
        });
      }
      const active = values.projectsValue.activeProject;
      const activePath = values.projectsValue.activeProjectPath ?? active?.path;
      const catalog = values.projectFilesValue.worktrees;
      const root = catalog.project?.root ?? activePath;
      if (!root) continue;
      // Skip retained runtimes the server no longer lists. Before any catalog
      // arrives, keep the active root so a cold start never flashes an empty
      // picker.
      if (serverKnown.size > 0 && !serverKnown.has(root)) continue;

      const label = catalog.project?.label ?? active?.label ?? getProjectLabel(root);
      const project = byRoot.get(root) ?? {
        ...(catalog.project?.id || active?.id ? { id: catalog.project?.id ?? active?.id } : {}),
        label,
        path: root,
        checkouts: [],
        loadingWorktrees: false,
        opened: true,
      };
      project.opened = true;
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
  }).filter((group) => group.enabled && group.status === 'connected');
}
