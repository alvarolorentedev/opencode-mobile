import { useCallback } from 'react';

import { useWorkspaceBrowser } from '@/providers/use-workspace-browser';
import { workspacePath } from '@/lib/opencode/workspace';
import { createFullFilePatch } from '@/lib/opencode/workspace-patch';
import { listCommands as svcListCommands } from '@/providers/services/session-service';
import { loadDiagnostics } from '@/providers/services/diagnostics-service';
import {
  saveFile,
  getFileStatus,
  getVcsInfo,
  readFile,
} from '@/providers/services/workspace-service';
import type { WorkspaceActionsInput } from '@/providers/opencode-provider-action-inputs';

type WorkspaceFileActionsInput = WorkspaceActionsInput & {
  refreshVcsDiff: (scope: 'uncommitted' | 'branch', silent?: boolean) => Promise<unknown>;
};

export function useWorkspaceFileActions({
  client,
  isCurrentClient,
  activeProjectPath,
  setCommands,
  setWorkspaceFileStatuses,
  setVcsInfo,
  setDiagnostics,
  setSelectedWorkspaceFile,
  workspaceFileRequestRef,
  currentSessionIdRef,
  diffScopeBySessionRef,
  refreshVcsDiff,
}: WorkspaceFileActionsInput) {
  const browser = useWorkspaceBrowser({ client, isCurrentClient });

  const refreshServerFeatures = useCallback(async () => {
    if (!activeProjectPath) {
      setCommands([]);
      setWorkspaceFileStatuses([]);
      setVcsInfo(undefined);
      return;
    }
    const [nextCommands, nextStatuses, nextVcs] = await Promise.all([
      svcListCommands(client).catch(() => []),
      getFileStatus(client).catch(() => []),
      getVcsInfo(client).catch(() => undefined),
    ]);
    if (!isCurrentClient(client)) {
      return;
    }
    setCommands(nextCommands || []);
    setWorkspaceFileStatuses(nextStatuses || []);
    setVcsInfo(nextVcs);
  }, [activeProjectPath, client, isCurrentClient]);

  const refreshDiagnostics = useCallback(async () => {
    const nextDiagnostics = await loadDiagnostics(client);
    if (isCurrentClient(client)) {
      setDiagnostics(nextDiagnostics);
    }
  }, [client, isCurrentClient]);

  const openWorkspaceFile = useCallback(async (path: string) => {
    path = workspacePath(path, client.__opencode.directory || '');
    const request = ++workspaceFileRequestRef.current;
    const content = await readFile(client, path);
    if (!content) {
      throw new Error('OpenCode did not return file content.');
    }
    if (content.type !== 'text' || content.encoding === 'base64') {
      throw new Error('Binary files cannot be previewed as text.');
    }
    if (!isCurrentClient(client) || request !== workspaceFileRequestRef.current) throw new Error('File selection was superseded.');
    setSelectedWorkspaceFile({ path, content });
  }, [client, isCurrentClient]);

  const saveWorkspaceFile = useCallback(async (path: string, expectedContent: string, content: string) => {
    path = workspacePath(path, client.__opencode.directory || '');
    const request = workspaceFileRequestRef.current;
    const latest = await readFile(client, path);
    if (!isCurrentClient(client)) throw new Error('The workspace changed before saving.');
    if (latest.type !== 'text' || latest.encoding === 'base64') throw new Error('Only text files can be edited.');
    if (latest.content !== expectedContent) throw new Error('The file changed on the server. Reopen it before saving.');
    const patch = createFullFilePatch({ path, expectedContent, content });
    if (!patch) return;
    await saveFile(client, path, content, patch);
    const saved = await readFile(client, path);
    if (!isCurrentClient(client)) throw new Error('The workspace changed before saving completed.');
    if (saved.type !== 'text' || saved.encoding === 'base64' || saved.content !== content) throw new Error('The saved file did not match your changes. Reopen it before retrying.');
    if (isCurrentClient(client) && request === workspaceFileRequestRef.current) {
      setSelectedWorkspaceFile({ path, content: saved });
      await refreshServerFeatures();
      const activeSessionId = currentSessionIdRef.current;
      const scope = activeSessionId ? diffScopeBySessionRef.current[activeSessionId] : undefined;
      if (scope === 'uncommitted' || scope === 'branch') {
        void refreshVcsDiff(scope, true);
      }
    }
  }, [client, isCurrentClient, refreshServerFeatures, refreshVcsDiff]);

  return { refreshServerFeatures, refreshDiagnostics, browser, openWorkspaceFile, saveWorkspaceFile };
}
