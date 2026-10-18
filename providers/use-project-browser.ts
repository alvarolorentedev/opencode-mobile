import { useCallback, useRef, useState } from 'react';

import type { ScopedOpencodeClient } from '@/lib/opencode/client';
import { projectPath, type ProjectFileEntry } from '@/lib/opencode/project';
import { findFiles, listFiles } from '@/providers/services/project-service';

export type ProjectBrowserState = {
  path: string;
  entries: ProjectFileEntry[];
  results: string[];
  query?: string;
  initialized: boolean;
  loading: boolean;
  searching: boolean;
  error?: string;
};

const emptyBrowser: ProjectBrowserState = { path: '', entries: [], results: [], initialized: false, loading: false, searching: false };

export function useProjectBrowser({ client, isCurrentClient }: {
  client: ScopedOpencodeClient;
  isCurrentClient: (candidate: object) => boolean;
}) {
  const [state, setState] = useState({ client, browser: emptyBrowser });
  const directoryRequest = useRef(0);
  const searchRequest = useRef(0);
  const browser = state.client === client ? state.browser : emptyBrowser;
  const update = useCallback((change: Partial<ProjectBrowserState>) => {
    setState((current) => ({ client, browser: { ...(current.client === client ? current.browser : emptyBrowser), ...change } }));
  }, [client]);

  const openDirectory = useCallback(async (requestedPath: string) => {
    const path = projectPath(requestedPath, client.__opencode.directory || '', true);
    const request = ++directoryRequest.current;
    searchRequest.current += 1;
    update({ path, entries: [], initialized: true, loading: true, searching: false, query: undefined, results: [], error: undefined });
    try {
      const entries = await listFiles(client, path);
      if (isCurrentClient(client) && request === directoryRequest.current) update({ entries, loading: false });
    } catch (reason) {
      if (isCurrentClient(client) && request === directoryRequest.current) update({ loading: false, error: reason instanceof Error ? reason.message : 'Could not list this folder.' });
    }
  }, [client, isCurrentClient, update]);

  const search = useCallback(async (query: string) => {
    projectPath('', client.__opencode.directory || '', true);
    const request = ++searchRequest.current;
    const trimmed = query.trim();
    update({ query: trimmed || undefined, results: [], searching: Boolean(trimmed), error: undefined });
    if (!trimmed) return;
    try {
      const results = (await findFiles(client, trimmed)).map((path) => projectPath(path, client.__opencode.directory || ''));
      if (isCurrentClient(client) && request === searchRequest.current) update({ results, searching: false });
    } catch (reason) {
      if (isCurrentClient(client) && request === searchRequest.current) update({ searching: false, error: reason instanceof Error ? reason.message : 'Could not search project files.' });
    }
  }, [client, isCurrentClient, update]);

  return { ...browser, openDirectory, search };
}
