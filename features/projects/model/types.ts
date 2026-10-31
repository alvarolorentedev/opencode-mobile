import type { useProjectBrowser } from '@/features/projects/state/use-project-browser';

import type { WorktreeCatalog } from '@/features/projects/state/use-worktree-state';

import type { ProjectFile } from '@/shared/protocol/opencode/project-file';

import type { File, VcsInfo } from '@/shared/protocol/opencode/types';

import type { OpencodeProject } from '@/shared/contracts/domain';

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
  createWorktree: (name?: string) => Promise<import('@/shared/protocol/opencode/project').ProjectWorktree>;
  removeWorktree: (directory: string) => Promise<void>;
};
