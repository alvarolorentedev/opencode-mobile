import { useCallback, useMemo } from 'react';

import { useAppCore, useAppStore } from '@/runtime/core';
import { getRequestHeaders, withReadSignal } from '@/shared/protocol/opencode/client';
import { getServerBase } from '@/shared/contracts/server-url';
import { projectPath } from '@/shared/protocol/opencode/project';
import { projectFileDownloadUrl, projectFileFromText, projectFileMime } from '@/shared/protocol/opencode/project-file';
import { createFullFilePatch } from '@/shared/protocol/opencode/project-patch';
import { saveOrShareProjectFile } from '@/features/projects/services/project-file-download';
import type { ProjectFileInput } from '@/features/projects/model/action-inputs';
import { fileStatusOptions, vcsInfoOptions } from '@/features/projects/services/queries/status';
import { useQueryActivity, useQueryIdentity } from '@/shared/server-data/client';
import { searchOptions } from '@/features/projects/services/queries/files';
import { projectQueryKey } from '@/shared/server-data/keys';
import { healthOptions, mcpOptions } from '@/shared/server-data/diagnostics';
import type { Diagnostics } from '@/shared/protocol/services/diagnostics-service';
import { getProjectFileDownloadSource, readFile, readProjectFile, saveFile } from '@/features/projects/services/project-service';
import { useProjectBrowser } from '@/features/projects/state/use-project-browser';
import { useProjectEntryActions } from '@/features/projects/state/use-project-entry-actions';
import { useQueries, useQueryClient } from '@tanstack/react-query';

export function useProjectFileActions({
  scopeKey,
  fileClipboard, connectionId, connected,
  client,
  isCurrentClient,
  projectFileRequestRef,
  currentSessionIdRef,
  readDiffScope,
  settingsRef,
  refreshVcsDiff,
  refreshServerFeatures,
}: ProjectFileInput) {
  const cache = useQueryClient();
  const identity = useQueryIdentity();
  const active = useQueryActivity();
  const { store } = useAppCore();
  const owner = useMemo(() => Symbol(client.__opencode.directory), [client]);
  const selectedPath = useAppStore((state) => state.workspaceUi[scopeKey]?.preview);
  const path = selectedPath?.owner === owner ? selectedPath.path : undefined;
  const previewKey = projectQueryKey(identity, client, 'preview', path);
  const diagnosticsRequested = useAppStore((state) => state.workspaceUi[scopeKey]?.diagnosticsRequested ?? false);
  const [preview] = useQueries({ queries: [{ queryKey: previewKey, enabled: false, gcTime: 0,
    queryFn: ({ signal }: { signal: AbortSignal }) => readProjectFile(withReadSignal(client, signal), path!) }].filter(() => active) });
  const [health] = useQueries({ queries: [{ ...healthOptions(identity, client), enabled: diagnosticsRequested }].filter(() => active) });
  const [diagnosticMcp] = useQueries({ queries: [{ ...mcpOptions(identity, client), enabled: diagnosticsRequested }].filter(() => active) });
  const diagnostics = useMemo<Diagnostics | undefined>(() => health?.data ? { health: health?.data, mcp: diagnosticMcp?.error
    ? { available: false, error: diagnosticMcp?.error.message } : { available: true, data: diagnosticMcp?.data ?? {} } } : undefined, [health?.data, diagnosticMcp?.data, diagnosticMcp?.error]);
  const directoryBrowser = useProjectBrowser({ scopeKey, client, isCurrentClient });
  const setSelectedProjectFile = useCallback((file: import('@/shared/protocol/opencode/project-file').ProjectFile) => {
    cache.setQueryData(projectQueryKey(identity, client, 'preview', file.path), file);
  }, [cache, client, identity]);
  const refreshEntries = useCallback(async () => {
    if (!isCurrentClient(client)) return;
    await Promise.all([cache.fetchQuery(fileStatusOptions(identity, client)), cache.fetchQuery(vcsInfoOptions(identity, client))]);
    if (!isCurrentClient(client)) return;
    await directoryBrowser.refresh();
    const scope = readDiffScope(currentSessionIdRef.current || '');
    if (scope === 'uncommitted' || scope === 'branch') await refreshVcsDiff(scope, true);
  }, [client, currentSessionIdRef, readDiffScope, directoryBrowser, isCurrentClient, refreshVcsDiff, cache, identity]);
  const actions = useProjectEntryActions({ scopeKey, client, isCurrentClient, connectionId, clipboard: fileClipboard, refresh: refreshEntries, enabled: connected });
  const browser = useMemo(() => ({ ...directoryBrowser, actions }), [directoryBrowser, actions]);

  const searchProjectFiles = useCallback(async (query: string) => {
    const trimmed = query.trim();
    if (!trimmed) return [];
    return cache.fetchQuery(searchOptions(identity, client, trimmed));
  }, [cache, client, identity]);

  const refreshDiagnostics = useCallback(async () => {
    if (!active) return;
    store.getState().setWorkspaceUi(scopeKey, { diagnosticsRequested: true });
    await Promise.allSettled([cache.fetchQuery(healthOptions(identity, client)), cache.fetchQuery(mcpOptions(identity, client))]);
  }, [active, cache, client, identity, scopeKey, store]);

  const openProjectFile = useCallback(async (path: string) => {
    path = projectPath(path, client.__opencode.directory || '');
    const request = ++projectFileRequestRef.current;
    const key = projectQueryKey(identity, client, 'preview', path);
    store.getState().setWorkspaceUi(scopeKey, { preview: { owner, path } });
    await cache.fetchQuery({ queryKey: key, gcTime: 0, staleTime: 0, queryFn: ({ signal }) => readProjectFile(withReadSignal(client, signal), path) });
    if (!isCurrentClient(client) || request !== projectFileRequestRef.current) throw new Error('File selection was superseded.');
  }, [cache, client, identity, isCurrentClient, owner, projectFileRequestRef, scopeKey, store]);

  const closeProjectFile = useCallback(() => {
    // Invalidate an in-flight open so closing cannot be undone when its read
    // resolves after the preview has already gone away.
    projectFileRequestRef.current += 1;
    if (store.getState().workspaceUi[scopeKey]?.preview?.owner === owner) {
      store.getState().setWorkspaceUi(scopeKey, { preview: undefined });
    }
    void cache.cancelQueries({ queryKey: projectQueryKey(identity, client, 'preview') });
    cache.removeQueries({ queryKey: projectQueryKey(identity, client, 'preview') });
  }, [cache, client, identity, owner, projectFileRequestRef, scopeKey, store]);

  const downloadProjectFile = useCallback(async (path: string, signal?: AbortSignal) => {
    path = projectPath(path, client.__opencode.directory || '');
    const source = await getProjectFileDownloadSource(client, path);
    if (signal?.aborted) throw new Error('Download canceled.');
    if (!isCurrentClient(client)) throw new Error('The project changed before downloading.');
    if (source.kind === 'content') {
      if (source.content.type !== 'text' || source.content.encoding === 'base64') {
        throw new Error('Binary files cannot be downloaded from this server.');
      }
      await saveOrShareProjectFile({
        filename: path.split('/').pop() || path,
        mime: projectFileMime(path),
        bytes: new TextEncoder().encode(source.content.content),
        signal,
      });
      return;
    }
    const settings = settingsRef.current;
    const base = getServerBase(settings.serverUrl);
    await saveOrShareProjectFile({
      url: projectFileDownloadUrl({ origin: base.origin, pathPrefix: base.pathPrefix, directory: client.__opencode.directory || '', path }),
      headers: getRequestHeaders(settings),
      oidcConnection: settings.oidc ? settings : undefined,
      filename: path.split('/').pop() || path,
      mime: projectFileMime(path),
      signal,
    });
  }, [client, isCurrentClient, settingsRef]);

  const saveProjectFile = useCallback(async (path: string, expectedContent: string, content: string) => {
    path = projectPath(path, client.__opencode.directory || '');
    const request = projectFileRequestRef.current;
    const latest = await readFile(client, path);
    if (!isCurrentClient(client)) throw new Error('The project changed before saving.');
    if (latest.type !== 'text' || latest.encoding === 'base64') throw new Error('Only text files can be edited.');
    if (latest.content !== expectedContent) throw new Error('The file changed on the server. Reopen it before saving.');
    const patch = createFullFilePatch({ path, expectedContent, content });
    if (!patch) return;
    try {
      await saveFile(client, path, content, patch);
    } catch (error) {
      // A write timeout may still have committed. Read back before reporting
      // failure so a retry cannot overwrite a save that already landed.
      const recovered = await readFile(client, path).catch(() => undefined);
      if (!recovered || recovered.type !== 'text' || recovered.encoding === 'base64' || recovered.content !== content) {
        throw error;
      }
      if (!isCurrentClient(client)) throw error;
      setSelectedProjectFile(projectFileFromText(path, recovered));
      await refreshServerFeatures();
      return;
    }
    const saved = await readFile(client, path);
    if (!isCurrentClient(client)) throw new Error('The project changed before saving completed.');
    if (saved.type !== 'text' || saved.encoding === 'base64' || saved.content !== content) throw new Error('The saved file did not match your changes. Reopen it before retrying.');
    if (isCurrentClient(client) && request === projectFileRequestRef.current) {
      setSelectedProjectFile(projectFileFromText(path, saved));
      await refreshServerFeatures();
      const activeSessionId = currentSessionIdRef.current;
      const scope = activeSessionId ? readDiffScope(activeSessionId) : undefined;
      if (scope === 'uncommitted' || scope === 'branch') {
        void refreshVcsDiff(scope, true);
      }
    }
  }, [client, currentSessionIdRef, readDiffScope, isCurrentClient, projectFileRequestRef, refreshServerFeatures, refreshVcsDiff, setSelectedProjectFile]);

  return { selectedProjectFile: preview?.data, diagnostics, refreshServerFeatures, refreshDiagnostics, searchProjectFiles, browser, openProjectFile, saveProjectFile, closeProjectFile, downloadProjectFile };
}
