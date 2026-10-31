import { useCallback, useMemo } from 'react';

import type { ScopedOpencodeClient } from '@/lib/opencode/client';
import type { ProjectWorktree } from '@/lib/opencode/project';
import type { Project } from '@/lib/opencode/types';
import { getProjectLabel } from '@/providers/opencode-provider-utils';
import { locationOptions, projectsOptions } from '@/providers/queries/catalogs';
import { useQueryActivity, useQueryIdentity } from '@/providers/queries/client';
import { worktreeOptions } from '@/providers/queries/files';
import {
  createWorktree as svcCreateWorktree,
  listWorktrees as svcListWorktrees,
  removeWorktree as svcRemoveWorktree,
} from '@/providers/services/project-service';
import { resolveProjectLocation } from '@/providers/services/session-service';
import { useQueries, useQueryClient } from '@tanstack/react-query';

export type WorktreeCatalog = { entries: ProjectWorktree[]; project?: { id: string; root: string; label: string }; loading: boolean; error?: string };

export function useWorktreeState({ client, isCurrentClient, serverProjects, connected }: {
  client: ScopedOpencodeClient;
  isCurrentClient: (candidate: object) => boolean;
  serverProjects: Project[];
  connected: boolean;
}) {
  const cache = useQueryClient();
  const identity = useQueryIdentity();
  const active = useQueryActivity();
  const options = worktreeOptions(identity, client);
  const [query] = useQueries({ queries: [{ ...options, enabled: connected && active && Boolean(client.__opencode.directory), subscribed: active }].filter(() => active) });
  const worktrees = useMemo<WorktreeCatalog>(() => ({
    entries: (query?.data?.entries ?? []).filter((entry) => !serverProjects.some((known) => known.worktree === entry.directory)),
    project: query?.data ? { id: query?.data.project.id, root: query?.data.project.worktree, label: getProjectLabel(query?.data.project.worktree) } : undefined,
    loading: Boolean(query?.isFetching), error: query?.error?.message,
  }), [query?.data, query?.isFetching, query?.error, serverProjects]);
  const refreshWorktrees = useCallback(async () => {
    if (!client.__opencode.directory || !isCurrentClient(client)) return;
    await cache.invalidateQueries({ queryKey: worktreeOptions(identity, client).queryKey, refetchType: 'none' });
    if (active) await cache.fetchQuery(worktreeOptions(identity, client));
  }, [active, cache, client, identity, isCurrentClient]);
  const refreshCatalog = useCallback(async () => {
    await Promise.all([
      cache.invalidateQueries({ queryKey: projectsOptions(identity, client).queryKey }),
      cache.invalidateQueries({ queryKey: locationOptions(identity, client).queryKey }),
    ]);
  }, [cache, client, identity]);
  const createWorktree = useCallback(async (name?: string) => {
    if (!client.__opencode.directory) throw new Error('Choose a project before creating a worktree.');
    const created = await svcCreateWorktree(client, name?.trim() || undefined);
    if (!isCurrentClient(client)) throw new Error('The project changed while creating the worktree.');
    await Promise.all([refreshWorktrees(), refreshCatalog()]);
    return created;
  }, [client, isCurrentClient, refreshWorktrees, refreshCatalog]);

  const checkTarget = useCallback(async (directory: string) => {
    const project = await resolveProjectLocation(client);
    if (!isCurrentClient(client)) throw new Error('The project changed.');
    if (directory === project.worktree || directory === client.__opencode.directory) throw new Error('Switch to another project before managing this directory.');
    if (serverProjects.some((known) => known.worktree === directory)) throw new Error('This directory is a project root, not a worktree.');
    const entries = await svcListWorktrees(client);
    if (!isCurrentClient(client) || !entries.some((entry) => entry.directory === directory)) throw new Error('The worktree is no longer available.');
  }, [client, isCurrentClient, serverProjects]);

  const removeWorktree = useCallback(async (directory: string) => {
    await checkTarget(directory);
    await svcRemoveWorktree(client, directory);
    if (isCurrentClient(client)) await Promise.all([refreshWorktrees(), refreshCatalog()]);
  }, [client, checkTarget, isCurrentClient, refreshWorktrees, refreshCatalog]);

  return { worktrees, refreshWorktrees, createWorktree, removeWorktree };
}
