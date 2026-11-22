import { compareLabels } from '@/shared/utilities/compare-labels';
import { projectCheckouts, type ProjectCheckout } from '@/shared/protocol/opencode/project';
import type { OpencodeProject, WorktreeCatalog } from '@/features/projects/model/types';
import type { ConnectionRecord } from '@/shared/contracts/workspace';

type WorkspaceProject = OpencodeProject & {
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

export type ProjectGroupInventory = {
  activeProjectPath?: string;
  projects: OpencodeProject[];
  worktrees: WorktreeCatalog;
  branch?: string;
};

// Merge the runtimes for one repository checkout into one project row. A
// repository can be opened once as its main checkout and again as a worktree;
// the project list must still show one project with several checkouts.
export function buildWorkspaceProjectGroups(
  connections: readonly ConnectionRecord[],
  inventories: Record<string, ProjectGroupInventory>,
  lifecycles: ReadonlyMap<string, { connection: { status: string }; contract: 'v1' | 'v2' }>,
): WorkspaceServerGroup[] {
  const byConnection = new Map<string, ProjectGroupInventory[]>();
  for (const [key, inventory] of Object.entries(inventories)) {
    const connectionId = (JSON.parse(key) as [string, string])[0];
    const list = byConnection.get(connectionId);
    if (list) list.push(inventory);
    else byConnection.set(connectionId, [inventory]);
  }

  // Only connected servers own selectable project groups. Disconnected and
  // non-connected profiles stay in Connection management so they can be
  // reconnected without appearing in settings or project selectors.
  return connections.flatMap((entry) => {
    const lifecycle = lifecycles.get(entry.id);
    if (!entry.enabled || lifecycle?.connection.status !== 'connected') return [];
    const projectInventories = byConnection.get(entry.id) ?? [];
    // The server catalog is the list, like the web client. Retained runtimes
    // for directories the server no longer reports must not become rows.
    // Until any runtime on the connection reports a catalog, keep the active
    // roots so a cold start never flashes an empty picker.
    const serverKnown = new Set<string>();
    for (const { projects } of projectInventories) {
      for (const project of projects) {
        if (project.id) serverKnown.add(project.path);
      }
    }
    const byRoot = new Map<string, WorkspaceProject>();
    for (const { projects, activeProjectPath: activePath, worktrees: catalog, branch } of projectInventories) {
      // The connection catalog supplies server rows. Per-directory reads
      // enrich the owning row with its worktrees and current branch.
      for (const project of projects) {
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
      const root = catalog.project?.root ?? activePath;
      if (!root) continue;
      // Skip retained runtimes the server no longer lists. Before any catalog
      // arrives, keep the active root so a cold start never flashes an empty
      // picker.
      if (serverKnown.size > 0 && !serverKnown.has(root)) continue;

      const label = catalog.project?.label ?? (root.split('/').filter(Boolean).pop() || root);
      const project = byRoot.get(root) ?? {
        ...(catalog.project?.id ? { id: catalog.project.id } : {}),
        label,
        path: root,
        checkouts: [],
        loadingWorktrees: false,
        opened: true,
      };
      project.opened = true;
      const checkouts = projectCheckouts(root, catalog.entries, activePath, branch);
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
    return [{
      id: entry.id,
      name: entry.name,
      enabled: entry.enabled,
      status: lifecycle.connection.status,
      contract: lifecycle.contract,
      projects: [...byRoot.values()].sort((left, right) => compareLabels(left.label, right.label)),
    }];
  });
}
