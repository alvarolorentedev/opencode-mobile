import { useQueries } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';

import { useAppStore, useCachedProjectTranscripts, useConnectedProjectScopes } from '@/runtime/core';
import type { WorkspaceCatalog } from '@/shared/contracts/workspace';
import type { Session } from '@/shared/protocol/opencode/types';

import { librarySessions } from '../model/workspace-library';
import { getSessionPreviewById } from '../model/selectors';
import { projectSessionsOptions } from '../services/queries';

function readLists(results: readonly { data?: Session[] }[]) {
  return results.map(({ data }) => data);
}

const NONE: never[] = [];

export function useLibrarySessions(catalogs: Record<string, WorkspaceCatalog>, { visible = true, includePreviews = true } = {}) {
  const { connections, lifecycles, servers } = useConnectedProjectScopes(visible);
  const sources = useMemo(() => servers.flatMap(({ projects }) => projects), [servers]);
  const sessions = useQueries({ queries: sources.map(({ identity, client }) => projectSessionsOptions(identity, client)), combine: readLists });
  const currentIds = useAppStore(useShallow(({ selection }) => sources.map(({ scopeKey }) => selection[scopeKey]?.currentSessionId)));
  const heldTranscripts = useCachedProjectTranscripts(includePreviews ? sources : NONE);
  const previews = useMemo(() => heldTranscripts.map(getSessionPreviewById), [heldTranscripts]);
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
