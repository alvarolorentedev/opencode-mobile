import type { QueryClient } from '@tanstack/react-query';

import type { ScopedOpencodeClient } from '@/shared/protocol/opencode/client';
import type { Project } from '@/shared/protocol/opencode/types';
import { resolveProjectLocation } from '@/shared/protocol/services/session-service';
import type { QueryIdentity } from '@/shared/server-data/keys';

import { createWorktree as createServerWorktree, listWorktrees, removeWorktree as removeServerWorktree } from './project-service';
import { locationOptions, projectsOptions } from './queries/catalog';
import { worktreeOptions } from './queries/files';

export function createWorktreeCommands({ cache, identity, client, isCurrent, shouldRefresh }: {
  cache: QueryClient;
  identity: QueryIdentity;
  client: ScopedOpencodeClient;
  isCurrent: () => boolean;
  shouldRefresh: () => boolean;
}) {
  const directory = client.__opencode.directory;
  const options = worktreeOptions(identity, client);
  const projects = projectsOptions(identity, client);

  async function refresh() {
    if (!directory || !isCurrent()) return;
    await cache.invalidateQueries({ queryKey: options.queryKey, refetchType: 'none' });
    if (shouldRefresh() && isCurrent()) await cache.fetchQuery(options);
  }

  async function refreshAfterWrite() {
    await Promise.all([
      refresh(),
      cache.invalidateQueries({ queryKey: projects.queryKey }),
      cache.invalidateQueries({ queryKey: locationOptions(identity, client).queryKey }),
    ]);
  }

  return {
    refreshWorktrees: refresh,
    async createWorktree(name?: string) {
      if (!directory) throw new Error('Choose a project before creating a worktree.');
      if (!isCurrent()) throw new Error('The project changed while creating the worktree.');
      const checkout = await createServerWorktree(client, name?.trim() || undefined);
      if (!isCurrent()) throw new Error('The project changed while creating the worktree.');
      await refreshAfterWrite();
      return checkout;
    },
    async removeWorktree(path: string, serverProjects: readonly Project[]) {
      if (!isCurrent()) throw new Error('The project changed.');
      const project = await resolveProjectLocation(client);
      if (!isCurrent()) throw new Error('The project changed.');
      if (path === project.worktree || path === directory) throw new Error('Switch to another project before managing this directory.');
      if (serverProjects.some(({ worktree }) => worktree === path)) {
        throw new Error('This directory is a project root, not a worktree.');
      }
      const entries = await listWorktrees(client);
      if (!isCurrent() || !entries.some((entry) => entry.directory === path)) throw new Error('The worktree is no longer available.');
      await removeServerWorktree(client, path);
      if (isCurrent()) await refreshAfterWrite();
    },
  };
}
