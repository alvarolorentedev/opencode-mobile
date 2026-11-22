import { useCallback, useMemo } from 'react';

import { useAppCore, useAppStore } from '@/runtime/core';
import { getRequestHeaders, withReadSignal } from '@/shared/protocol/opencode/client';
import { getServerBase } from '@/shared/contracts/server-url';
import { projectPath } from '@/shared/protocol/opencode/project';
import { projectFileDownloadUrl, projectFileFromText, projectFileMime } from '@/shared/protocol/opencode/project-file';
import { createFullFilePatch } from '@/shared/protocol/opencode/project-patch';
import { saveOrShareProjectFile } from '@/features/projects/services/project-file-download';
import type { ProjectFileInput } from '@/features/projects/model/action-inputs';
import { projectClientOwner } from '@/features/projects/model/project-client-owner';
import { fileStatusOptions, vcsInfoOptions } from '@/features/projects/services/queries/status';
import { projectQueryKey } from '@/shared/server-data/keys';
import { getProjectFileDownloadSource, readFile, readProjectFile, saveFile } from '@/features/projects/services/project-service';
import { useProjectBrowser } from '@/features/projects/state/use-project-browser';
import { useProjectEntryActions } from '@/features/projects/state/use-project-entry-actions';
import { useQueries, useQueryClient } from '@tanstack/react-query';

export function useProjectFileActions({
  identity,
  queryActive: active,
  scopeKey,
  fileClipboard, connectionId, connected,
  client,
  isCurrentClient,
  settings,
  refreshVcsDiff,
  refreshServerFeatures,
}: ProjectFileInput) {
  const cache = useQueryClient();
  const { store } = useAppCore();
  const owner = projectClientOwner(client);
  const selectedPath = useAppStore((state) => state.workspaceUi[scopeKey]?.preview);
  const path = selectedPath?.owner === owner ? selectedPath.path : undefined;
  const previewKey = projectQueryKey(identity, client, 'preview', path);
  const [preview] = useQueries({ queries: [{ queryKey: previewKey, enabled: false, gcTime: 0,
    queryFn: ({ signal }: { signal: AbortSignal }) => readProjectFile(withReadSignal(client, signal), path!) }].filter(() => active) });
  const directoryBrowser = useProjectBrowser({ scopeKey, client, identity, isCurrentClient, queryActive: active });
  const setSelectedProjectFile = useCallback((file: import('@/shared/protocol/opencode/project-file').ProjectFile) => {
    cache.setQueryData(projectQueryKey(identity, client, 'preview', file.path), file);
  }, [cache, client, identity]);
  const readSelectedDiff = useCallback(() => {
    const state = store.getState();
    const sessionId = state.selection[scopeKey]?.currentSessionId;
    return sessionId ? state.chat[scopeKey]?.diffScopeBySession[sessionId] : undefined;
  }, [scopeKey, store]);
  const refreshEntries = useCallback(async () => {
    if (!isCurrentClient(client)) return;
    await Promise.all([cache.fetchQuery(fileStatusOptions(identity, client)), cache.fetchQuery(vcsInfoOptions(identity, client))]);
    if (!isCurrentClient(client)) return;
    await directoryBrowser.refresh();
    const scope = readSelectedDiff();
    if (scope === 'uncommitted' || scope === 'branch') await refreshVcsDiff(scope, true);
  }, [cache, client, directoryBrowser, identity, isCurrentClient, readSelectedDiff, refreshVcsDiff]);
  const actions = useProjectEntryActions({ scopeKey, client, identity, isCurrentClient, connectionId, clipboard: fileClipboard, refresh: refreshEntries, enabled: connected });
  const browser = useMemo(() => ({ ...directoryBrowser, actions }), [directoryBrowser, actions]);

  const readPreviewRequest = useCallback(() => {
    const preview = store.getState().workspaceUi[scopeKey]?.preview;
    return preview?.owner === owner ? preview.request : undefined;
  }, [owner, scopeKey, store]);

  const openProjectFile = useCallback(async (path: string) => {
    path = projectPath(path, client.__opencode.directory || '');
    if (!isCurrentClient(client)) throw new Error('File selection was superseded.');
    const request = Symbol(path);
    const key = projectQueryKey(identity, client, 'preview', path);
    store.getState().setWorkspaceUi(scopeKey, { preview: { owner, path, request } });
    await cache.fetchQuery({ queryKey: key, gcTime: 0, staleTime: 0, queryFn: ({ signal }) => readProjectFile(withReadSignal(client, signal), path) });
    if (!isCurrentClient(client) || request !== readPreviewRequest()) throw new Error('File selection was superseded.');
  }, [cache, client, identity, isCurrentClient, owner, readPreviewRequest, scopeKey, store]);

  const closeProjectFile = useCallback(() => {
    // Invalidate an in-flight open so closing cannot be undone when its read
    // resolves after the preview has already gone away.
    if (store.getState().workspaceUi[scopeKey]?.preview?.owner !== owner) return;
    store.getState().setWorkspaceUi(scopeKey, { preview: undefined });
    void cache.cancelQueries({ queryKey: projectQueryKey(identity, client, 'preview') });
    cache.removeQueries({ queryKey: projectQueryKey(identity, client, 'preview') });
  }, [cache, client, identity, owner, scopeKey, store]);

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
    const base = getServerBase(settings.serverUrl);
    await saveOrShareProjectFile({
      url: projectFileDownloadUrl({ origin: base.origin, pathPrefix: base.pathPrefix, directory: client.__opencode.directory || '', path }),
      headers: getRequestHeaders(settings),
      oidcConnection: settings.oidc ? settings : undefined,
      filename: path.split('/').pop() || path,
      mime: projectFileMime(path),
      signal,
    });
  }, [client, isCurrentClient, settings]);

  const saveProjectFile = useCallback(async (path: string, expectedContent: string, content: string) => {
    path = projectPath(path, client.__opencode.directory || '');
    const request = readPreviewRequest();
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
      if (request === readPreviewRequest()) setSelectedProjectFile(projectFileFromText(path, recovered));
      await refreshServerFeatures();
      return;
    }
    const saved = await readFile(client, path);
    if (!isCurrentClient(client)) throw new Error('The project changed before saving completed.');
    if (saved.type !== 'text' || saved.encoding === 'base64' || saved.content !== content) throw new Error('The saved file did not match your changes. Reopen it before retrying.');
    if (isCurrentClient(client) && request === readPreviewRequest()) {
      setSelectedProjectFile(projectFileFromText(path, saved));
      await refreshServerFeatures();
      const scope = readSelectedDiff();
      if (scope === 'uncommitted' || scope === 'branch') {
        void refreshVcsDiff(scope, true);
      }
    }
  }, [client, isCurrentClient, readPreviewRequest, readSelectedDiff, refreshServerFeatures, refreshVcsDiff, setSelectedProjectFile]);

  return { selectedProjectFile: preview?.data, browser, openProjectFile, saveProjectFile, closeProjectFile, downloadProjectFile };
}
