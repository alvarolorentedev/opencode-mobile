import type { useProjectBrowser } from '@/features/projects/state/use-project-browser';

import type { WorktreeCatalog } from '@/features/projects/state/use-worktree-state';

import type { ProjectFile } from '@/shared/protocol/opencode/project-file';

import type { File, Project, VcsInfo } from '@/shared/protocol/opencode/types';

export type OpencodeProject = {
  id?: string;
  label: string;
  path: string;
};

// Device-local project archive markers per connection scope. They are a
// preference like favorites, not a catalog: a path only hides a matching
// server project, and a stale path never creates a row.
export type HiddenProjectsByConnection = Record<string, string[]>;

export const HIDDEN_PROJECTS_MAX = 50;

// Which diff source the Files Changed surface reads from. `turn` is the
// per-user-message snapshot diff; the VCS scopes come from the project
// working tree and are not tied to the current session.
export type DiffScope = 'turn' | 'uncommitted' | 'branch';

export type ProjectCatalog = {
  currentProjectPath?: string;
  serverRootPath?: string;
  serverProjects: Project[];
};

export type ProjectsContextValue = {
  projects: OpencodeProject[];
  activeProjectPath?: string;
  activeProject?: OpencodeProject;
  selectProject: (path: string) => void;
  addProject: (directory: string) => Promise<string>;
  isRefreshingProjectCatalog: boolean;
  refreshProjectCatalog: (silent?: boolean) => Promise<void>;
  refreshProjectStatus: () => Promise<void>;
};

export type ProjectFilesContextValue = {
  browser: ReturnType<typeof useProjectBrowser> & { actions: import('@/features/projects/state/use-project-entry-actions').ProjectEntryActions };
  projectFileStatuses: File[];
  // The selected file, its bytes for inline media preview, and every file
  // action share one member so the public context surface stays bounded.
  projectFile: {
    selected?: ProjectFile;
    open: (path: string) => Promise<void>;
    save: (path: string, expectedContent: string, content: string) => Promise<void>;
    close: () => void;
    download: (path: string, signal?: AbortSignal) => Promise<void>;
  };
  vcsInfo?: VcsInfo;
  worktrees: WorktreeCatalog;
  refreshWorktrees: () => Promise<void>;
  removeWorktree: (directory: string) => Promise<void>;
};
