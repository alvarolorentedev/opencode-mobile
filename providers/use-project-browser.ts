import type { ScopedOpencodeClient } from '@/lib/opencode/client';
import { projectPath, type ProjectFileEntry } from '@/lib/opencode/project';
import { useQueryActivity, useQueryIdentity } from '@/providers/queries/client';
import { directoryOptions, searchOptions } from '@/providers/queries/files';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';

export type ProjectBrowserState = {
  path: string; entries: ProjectFileEntry[]; results: string[]; query?: string;
  initialized: boolean; loading: boolean; searching: boolean; error?: string;
};
const EMPTY: never[] = [];
export function useProjectBrowser({ client, isCurrentClient }: { client: ScopedOpencodeClient; isCurrentClient: (client: object) => boolean }) {
  const cache = useQueryClient();
  const identity = useQueryIdentity();
  const active = useQueryActivity();
  const [selection, setSelection] = useState<{ client: object; path: string; query?: string }>();
  const current = selection?.client === client ? selection : undefined;
  const path = current?.path ?? '';
  const query = current?.query;
  const [directory] = useQueries({ queries: [{ ...directoryOptions(identity, client, path), enabled: Boolean(current) && !query }].filter(() => active) });
  const [searchResult] = useQueries({ queries: [{ ...searchOptions(identity, client, query ?? ''), enabled: Boolean(query) }].filter(() => active) });
  const openDirectory = useCallback(async (requested: string) => {
    const path = projectPath(requested, client.__opencode.directory || '', true);
    if (!isCurrentClient(client) || !active) return;
    setSelection({ client, path });
    await cache.fetchQuery(directoryOptions(identity, client, path)).catch(() => undefined);
  }, [active, cache, client, identity, isCurrentClient]);
  const search = useCallback(async (requested: string) => {
    projectPath('', client.__opencode.directory || '', true);
    if (!isCurrentClient(client) || !active) return;
    const query = requested.trim() || undefined;
    setSelection((previous) => ({ client, path: previous?.client === client ? previous.path : '', query }));
    if (query) await cache.fetchQuery(searchOptions(identity, client, query)).catch(() => undefined);
  }, [active, cache, client, identity, isCurrentClient]);
  const refresh = useCallback(async () => {
    if (!current || !active || !isCurrentClient(client)) return;
    if (query) await cache.fetchQuery(searchOptions(identity, client, query));
    else await cache.fetchQuery(directoryOptions(identity, client, path));
  }, [active, cache, client, current, identity, isCurrentClient, path, query]);
  return useMemo(() => ({ path, query, initialized: Boolean(current), entries: directory?.data ?? EMPTY, results: searchResult?.data ?? EMPTY,
    loading: !query && Boolean(directory?.isFetching), searching: Boolean(query && searchResult?.isFetching),
    error: (query ? searchResult?.error : directory?.error)?.message, openDirectory, search, refresh,
  }), [path, query, current, directory?.data, directory?.isFetching, directory?.error, searchResult?.data, searchResult?.isFetching, searchResult?.error, openDirectory, search, refresh]);
}
