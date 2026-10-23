import { useCallback } from 'react';

import { useProjectBrowser } from '@/providers/use-project-browser';
import { projectPath } from '@/lib/opencode/project';
import { createFullFilePatch } from '@/lib/opencode/project-patch';
import { listCommands as svcListCommands } from '@/providers/services/session-service';
import { loadDiagnostics } from '@/providers/services/diagnostics-service';
import {
  saveFile,
  getFileStatus,
  getVcsInfo,
  readFile,
} from '@/providers/services/project-service';
import type { ProjectActionsInput } from '@/providers/opencode-provider-action-inputs';

type ProjectFileActionsInput = ProjectActionsInput & {
  refreshVcsDiff: (scope: 'uncommitted' | 'branch', silent?: boolean) => Promise<unknown>;
};

export function useProjectFileActions({
  client,
  isCurrentClient,
  activeProjectPath,
  setCommands,
  setProjectFileStatuses,
  setVcsInfo,
  setDiagnostics,
  setSelectedProjectFile,
  projectFileRequestRef,
  currentSessionIdRef,
  diffScopeBySessionRef,
  refreshVcsDiff,
}: ProjectFileActionsInput) {
  const browser = useProjectBrowser({ client, isCurrentClient });

  const refreshServerFeatures = useCallback(async () => {
    if (!activeProjectPath) {
      setCommands([]);
      setProjectFileStatuses([]);
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
    setProjectFileStatuses(nextStatuses || []);
    setVcsInfo(nextVcs);
  }, [activeProjectPath, client, isCurrentClient]);

  const refreshDiagnostics = useCallback(async () => {
    const nextDiagnostics = await loadDiagnostics(client);
    if (isCurrentClient(client)) {
      setDiagnostics(nextDiagnostics);
    }
  }, [client, isCurrentClient]);

  const openProjectFile = useCallback(async (path: string) => {
    path = projectPath(path, client.__opencode.directory || '');
    const request = ++projectFileRequestRef.current;
    const content = await readFile(client, path);
    if (!content) {
      throw new Error('OpenCode did not return file content.');
    }
    if (content.type !== 'text' || content.encoding === 'base64') {
      throw new Error('Binary files cannot be previewed as text.');
    }
    if (!isCurrentClient(client) || request !== projectFileRequestRef.current) throw new Error('File selection was superseded.');
    setSelectedProjectFile({ path, content });
  }, [client, isCurrentClient]);

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
      setSelectedProjectFile({ path, content: recovered });
      await refreshServerFeatures();
      return;
    }
    const saved = await readFile(client, path);
    if (!isCurrentClient(client)) throw new Error('The project changed before saving completed.');
    if (saved.type !== 'text' || saved.encoding === 'base64' || saved.content !== content) throw new Error('The saved file did not match your changes. Reopen it before retrying.');
    if (isCurrentClient(client) && request === projectFileRequestRef.current) {
      setSelectedProjectFile({ path, content: saved });
      await refreshServerFeatures();
      const activeSessionId = currentSessionIdRef.current;
      const scope = activeSessionId ? diffScopeBySessionRef.current[activeSessionId] : undefined;
      if (scope === 'uncommitted' || scope === 'branch') {
        void refreshVcsDiff(scope, true);
      }
    }
  }, [client, isCurrentClient, refreshServerFeatures, refreshVcsDiff]);

  return { refreshServerFeatures, refreshDiagnostics, browser, openProjectFile, saveProjectFile };
}
