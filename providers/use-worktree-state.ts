import { useCallback, useRef, useState } from 'react';

import type { ScopedOpencodeClient } from '@/lib/opencode/client';
import type { ProjectWorktree } from '@/lib/opencode/project';
import type { Project } from '@/lib/opencode/types';
import { getProjectLabel } from '@/providers/opencode-provider-utils';
import { resolveProjectLocation } from '@/providers/services/session-service';
import {
  createWorktree as svcCreateWorktree,
  listWorktrees as svcListWorktrees,
  removeWorktree as svcRemoveWorktree,
  resetWorktree as svcResetWorktree,
} from '@/providers/services/project-service';

export type WorktreeCatalog = { entries: ProjectWorktree[]; project?: { id: string; root: string; label: string }; loading: boolean; error?: string };
const emptyCatalog: WorktreeCatalog = { entries: [], loading: false };

export function useWorktreeState({ client, isCurrentClient, refreshProjectCatalog, serverProjectsRef }: {
  client: ScopedOpencodeClient;
  isCurrentClient: (candidate: object) => boolean;
  refreshProjectCatalog: (silent?: boolean) => Promise<void>;
  serverProjectsRef: { current: Project[] };
}) {
  const [state, setState] = useState({ client, catalog: emptyCatalog });
  const requestRef = useRef(0);
  const worktrees = state.client === client ? state.catalog : emptyCatalog;
  const resetWorktrees = useCallback(() => { requestRef.current += 1; setState({ client, catalog: emptyCatalog }); }, [client]);

  const refreshWorktrees = useCallback(async () => {
    if (!client.__opencode.directory) return;
    const request = ++requestRef.current;
    setState((current) => ({ client, catalog: { ...(current.client === client ? current.catalog : emptyCatalog), loading: true, error: undefined } }));
    try {
      const [project, listed] = await Promise.all([resolveProjectLocation(client), svcListWorktrees(client)]);
      // project.list() can report a different canonical for a repository with
      // multiple checkouts. Never present a server project root as a worktree:
      // the server refuses to remove or reset it.
      const entries = listed.filter((entry) => !serverProjectsRef.current.some((known) => known.worktree === entry.directory));
      if (isCurrentClient(client) && request === requestRef.current) setState({ client, catalog: {
        entries, project: { id: project.id, root: project.worktree, label: getProjectLabel(project.worktree) }, loading: false,
      } });
    } catch (reason) {
      if (isCurrentClient(client) && request === requestRef.current) setState({ client, catalog: { ...emptyCatalog, error: reason instanceof Error ? reason.message : 'Could not load worktrees.' } });
    }
  }, [client, isCurrentClient, serverProjectsRef]);

  const createWorktree = useCallback(async (name?: string, startCommand?: string) => {
    if (!client.__opencode.directory) throw new Error('Choose a project before creating a worktree.');
    await svcCreateWorktree(client, name?.trim() || undefined, startCommand?.trim() || undefined);
    if (!isCurrentClient(client)) throw new Error('The project changed while creating the worktree.');
    await Promise.all([refreshWorktrees(), refreshProjectCatalog(true)]);
  }, [client, isCurrentClient, refreshWorktrees, refreshProjectCatalog]);

  const checkTarget = useCallback(async (directory: string) => {
    const project = await resolveProjectLocation(client);
    if (!isCurrentClient(client)) throw new Error('The project changed.');
    if (directory === project.worktree || directory === client.__opencode.directory) throw new Error('Switch to another project before managing this directory.');
    if (serverProjectsRef.current.some((known) => known.worktree === directory)) throw new Error('This directory is a project root, not a worktree.');
    const entries = await svcListWorktrees(client);
    if (!isCurrentClient(client) || !entries.some((entry) => entry.directory === directory)) throw new Error('The worktree is no longer available.');
  }, [client, isCurrentClient, serverProjectsRef]);

  const resetWorktree = useCallback(async (directory: string) => {
    await checkTarget(directory);
    await svcResetWorktree(client, directory);
    if (isCurrentClient(client)) await refreshWorktrees();
  }, [client, checkTarget, isCurrentClient, refreshWorktrees]);

  const removeWorktree = useCallback(async (directory: string) => {
    await checkTarget(directory);
    await svcRemoveWorktree(client, directory);
    if (isCurrentClient(client)) await Promise.all([refreshWorktrees(), refreshProjectCatalog(true)]);
  }, [client, checkTarget, isCurrentClient, refreshWorktrees, refreshProjectCatalog]);

  return { worktrees, refreshWorktrees, createWorktree, resetWorktree, removeWorktree, resetWorktrees };
}
