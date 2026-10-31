import { useCallback, useMemo, useState } from 'react';

import { getRequestHeaders, getServerBase, withReadSignal } from '@/lib/opencode/client';
import { projectPath } from '@/lib/opencode/project';
import { projectFileDownloadUrl, projectFileFromText, projectFileMime } from '@/lib/opencode/project-file';
import { createFullFilePatch } from '@/lib/opencode/project-patch';
import { saveOrShareProjectFile } from '@/lib/project-file-download';
import type { ProjectFileInput } from '@/providers/opencode-provider-action-inputs';
import { fileStatusOptions, vcsInfoOptions } from '@/providers/queries/catalogs';
import { useQueryActivity, useQueryIdentity } from '@/providers/queries/client';
import { searchOptions } from '@/providers/queries/files';
import { projectQueryKey } from '@/providers/queries/keys';
import { healthOptions, mcpOptions } from '@/providers/queries/mcp';
import type { Diagnostics } from '@/providers/services/diagnostics-service';
import {
  getProjectFileDownloadSource,
  readFile,
  readProjectFile,
  saveFile,
} from '@/providers/services/project-service';
import { useProjectBrowser } from '@/providers/use-project-browser';
import { useProjectEntryActions } from '@/providers/use-project-entry-actions';
import { useQueries, useQueryClient } from '@tanstack/react-query';

export function useProjectFileActions({
  fileClipboard, connectionId, connected,
  client,
  isCurrentClient,
  projectFileRequestRef,
  currentSessionIdRef,
  diffScopeBySessionRef,
  settingsRef,
  refreshVcsDiff,
  refreshServerFeatures,
}: ProjectFileInput) {
  const cache = useQueryClient();
  const identity = useQueryIdentity();
  const active = useQueryActivity();
  const [selectedPath, setSelectedPath] = useState<{ client: object; path: string }>();
  const path = selectedPath?.client === client ? selectedPath.path : undefined;
  const previewKey = projectQueryKey(identity, client, 'preview', path);
  const [diagnosticsRequested, setDiagnosticsRequested] = useState(false);
  const [preview] = useQueries({ queries: [{ queryKey: previewKey, enabled: false, gcTime: 0,
    queryFn: ({ signal }: { signal: AbortSignal }) => readProjectFile(withReadSignal(client, signal), path!) }].filter(() => active) });
  const [health] = useQueries({ queries: [{ ...healthOptions(identity, client), enabled: diagnosticsRequested }].filter(() => active) });
  const [diagnosticMcp] = useQueries({ queries: [{ ...mcpOptions(identity, client), enabled: diagnosticsRequested }].filter(() => active) });
  const diagnostics = useMemo<Diagnostics | undefined>(() => health?.data ? { health: health?.data, mcp: diagnosticMcp?.error
    ? { available: false, error: diagnosticMcp?.error.message } : { available: true, data: diagnosticMcp?.data ?? {} } } : undefined, [health?.data, diagnosticMcp?.data, diagnosticMcp?.error]);
  const directoryBrowser = useProjectBrowser({ client, isCurrentClient });
  const setSelectedProjectFile = useCallback((file: import('@/lib/opencode/project-file').ProjectFile) => {
    cache.setQueryData(projectQueryKey(identity, client, 'preview', file.path), file);
  }, [cache, client, identity]);
  const refreshEntries = useCallback(async () => {
    if (!isCurrentClient(client)) return;
    await Promise.all([cache.fetchQuery(fileStatusOptions(identity, client)), cache.fetchQuery(vcsInfoOptions(identity, client))]);
    if (!isCurrentClient(client)) return;
    await directoryBrowser.refresh();
    const scope = diffScopeBySessionRef.current[currentSessionIdRef.current || ''];
    if (scope === 'uncommitted' || scope === 'branch') await refreshVcsDiff(scope, true);
  }, [client, currentSessionIdRef, diffScopeBySessionRef, directoryBrowser, isCurrentClient, refreshVcsDiff, cache, identity]);
  const actions = useProjectEntryActions({ client, isCurrentClient, connectionId, clipboard: fileClipboard, refresh: refreshEntries, enabled: connected });
  const browser = useMemo(() => ({ ...directoryBrowser, actions }), [directoryBrowser, actions]);

  const searchProjectFiles = useCallback(async (query: string) => {
    const trimmed = query.trim();
    if (!trimmed) return [];
    return cache.fetchQuery(searchOptions(identity, client, trimmed));
  }, [cache, client, identity]);

  const refreshDiagnostics = useCallback(async () => {
    if (!active) return;
    setDiagnosticsRequested(true);
    await Promise.allSettled([cache.fetchQuery(healthOptions(identity, client)), cache.fetchQuery(mcpOptions(identity, client))]);
  }, [active, cache, client, identity]);

  const openProjectFile = useCallback(async (path: string) => {
    path = projectPath(path, client.__opencode.directory || '');
    const request = ++projectFileRequestRef.current;
    const key = projectQueryKey(identity, client, 'preview', path);
    setSelectedPath({ client, path });
    await cache.fetchQuery({ queryKey: key, gcTime: 0, staleTime: 0, queryFn: ({ signal }) => readProjectFile(withReadSignal(client, signal), path) });
    if (!isCurrentClient(client) || request !== projectFileRequestRef.current) throw new Error('File selection was superseded.');
  }, [cache, client, identity, isCurrentClient, projectFileRequestRef]);

  const closeProjectFile = useCallback(() => {
    // Invalidate an in-flight open so closing cannot be undone when its read
    // resolves after the preview has already gone away.
    projectFileRequestRef.current += 1;
    setSelectedPath(undefined);
    void cache.cancelQueries({ queryKey: projectQueryKey(identity, client, 'preview') });
    cache.removeQueries({ queryKey: projectQueryKey(identity, client, 'preview') });
  }, [cache, client, identity, projectFileRequestRef]);

  const downloadProjectFile = useCallback(async (path: string, signal?: AbortSignal) => {
    path = projectPath(path, client.__opencode.directory || '');
    const source = await getProjectFileDownloadSource(client, path);
    if (source.kind === 'content') {
      if (signal?.aborted) throw new Error('Download canceled.');
      if (!isCurrentClient(client)) throw new Error('The project changed before downloading.');
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
      const scope = activeSessionId ? diffScopeBySessionRef.current[activeSessionId] : undefined;
      if (scope === 'uncommitted' || scope === 'branch') {
        void refreshVcsDiff(scope, true);
      }
    }
  }, [client, currentSessionIdRef, diffScopeBySessionRef, isCurrentClient, projectFileRequestRef, refreshServerFeatures, refreshVcsDiff, setSelectedProjectFile]);

  return { selectedProjectFile: preview?.data, diagnostics, refreshServerFeatures, refreshDiagnostics, searchProjectFiles, browser, openProjectFile, saveProjectFile, closeProjectFile, downloadProjectFile };
}
