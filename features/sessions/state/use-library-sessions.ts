import { useQueries } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';

import { useAppStore, useConnectedProjectScopes } from '@/runtime/core';
import type { WorkspaceCatalog } from '@/shared/contracts/workspace';
import type { Session } from '@/shared/protocol/opencode/types';

import { librarySessions } from '../model/workspace-library';
import { projectSessionsOptions } from '../services/queries';

function readLists(results: readonly { data?: Session[] }[]) {
  return results.map(({ data }) => data);
}

export function useLibrarySessions(catalogs: Record<string, WorkspaceCatalog>, { visible = true, includePreviews = true } = {}) {
  const { connections, lifecycles, servers } = useConnectedProjectScopes(visible);
  const sources = useMemo(() => servers.flatMap(({ projects }) => projects), [servers]);
  const sessions = useQueries({ queries: sources.map(({ identity, client }) => projectSessionsOptions(identity, client)), combine: readLists });
  const currentIds = useAppStore(useShallow(({ selection }) => sources.map(({ scopeKey }) => selection[scopeKey]?.currentSessionId)));
  const previews = useAppStore(useShallow(({ registry }) => includePreviews ? sources.map(({ scopeKey }) => registry.snapshots[scopeKey]?.sessionPreviews) : []));
  const focus = useAppStore((state) => visible ? state.registry.focus : undefined);
  const favoriteSessions = useAppStore((state) => visible ? state.shell.favoriteSessions : undefined);
  return useMemo(() => {
    if (!favoriteSessions) return [];
    const projects = sources.map(({ identity, directory }, index) => ({
      connectionId: identity.connectionId, projectPath: directory || undefined, sessions: sessions[index] ?? [],
      currentSessionId: currentIds[index], previews: previews[index],
    }));
    return librarySessions(connections, projects, lifecycles, catalogs, favoriteSessions, focus);
  }, [catalogs, connections, currentIds, favoriteSessions, focus, lifecycles, previews, sessions, sources]);
}
