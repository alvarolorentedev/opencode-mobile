import { useAppCore, useAppStore } from '@/runtime/core';
import type { ScopedOpencodeClient } from '@/shared/protocol/opencode/client';
import { projectPath, type ProjectFileEntry } from '@/shared/protocol/opencode/project';
import { useQueryActivity, useQueryIdentity } from '@/shared/server-data/client';
import { directoryOptions, searchOptions } from '@/features/projects/services/queries/files';
import { projectParentPath } from '@/features/projects/model/project-utils';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';

export type ProjectBrowserState = {
  path: string; entries: ProjectFileEntry[]; results: string[]; query?: string;
  initialized: boolean; loading: boolean; searching: boolean; error?: string;
};
const EMPTY: never[] = [];
export function useProjectBrowser({ scopeKey, client, isCurrentClient }: { scopeKey: string; client: ScopedOpencodeClient; isCurrentClient: (client: object) => boolean }) {
  const cache = useQueryClient();
  const identity = useQueryIdentity();
  const active = useQueryActivity();
  const { store } = useAppCore();
  const owner = useMemo(() => Symbol(client.__opencode.directory), [client]);
  const selection = useAppStore((state) => state.workspaceUi[scopeKey]?.browser);
  const current = selection?.owner === owner ? selection : undefined;
  const path = current?.path ?? '';
  const query = current?.query;
  const [directory] = useQueries({ queries: [{ ...directoryOptions(identity, client, path), enabled: Boolean(current) && !query }].filter(() => active) });
  const [searchResult] = useQueries({ queries: [{ ...searchOptions(identity, client, query ?? ''), enabled: Boolean(query) }].filter(() => active) });
  const openDirectory = useCallback(async (requested: string) => {
    const path = projectPath(requested, client.__opencode.directory || '', true);
    if (!isCurrentClient(client) || !active) return;
    store.getState().setWorkspaceUi(scopeKey, { browser: { owner, path } });
    await cache.fetchQuery(directoryOptions(identity, client, path)).catch(() => undefined);
  }, [active, cache, client, identity, isCurrentClient, owner, scopeKey, store]);
  const search = useCallback(async (requested: string) => {
    projectPath('', client.__opencode.directory || '', true);
    if (!isCurrentClient(client) || !active) return;
    const query = requested.trim() || undefined;
    const previous = store.getState().workspaceUi[scopeKey]?.browser;
    store.getState().setWorkspaceUi(scopeKey, { browser: { owner, path: previous?.owner === owner ? previous.path : '', query } });
    if (query) await cache.fetchQuery(searchOptions(identity, client, query)).catch(() => undefined);
  }, [active, cache, client, identity, isCurrentClient, owner, scopeKey, store]);
  const refresh = useCallback(async () => {
    if (!current || !active || !isCurrentClient(client)) return;
    if (query) await cache.fetchQuery(searchOptions(identity, client, query));
    else await cache.fetchQuery(directoryOptions(identity, client, path));
  }, [active, cache, client, current, identity, isCurrentClient, path, query]);
  // Android back walks the folder tree before leaving the tab. Search is a
  // project-wide view rather than a folder, so dismiss it first.
  const goBack = useCallback(() => {
    if (!current || !active || !isCurrentClient(client)) return false;
    if (query) { void search(''); return true; }
    if (!path) return false;
    void openDirectory(projectParentPath(path));
    return true;
  }, [active, client, current, isCurrentClient, openDirectory, path, query, search]);
  return useMemo(() => ({ path, query, initialized: Boolean(current), entries: directory?.data ?? EMPTY, results: searchResult?.data ?? EMPTY,
    loading: !query && Boolean(directory?.isFetching), searching: Boolean(query && searchResult?.isFetching),
    error: (query ? searchResult?.error : directory?.error)?.message, openDirectory, search, refresh, goBack,
  }), [path, query, current, directory?.data, directory?.isFetching, directory?.error, searchResult?.data, searchResult?.isFetching, searchResult?.error, openDirectory, search, refresh, goBack]);
}
