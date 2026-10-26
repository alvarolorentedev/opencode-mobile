import { useCallback, useMemo, useRef, useState } from 'react';

import type { ScopedOpencodeClient } from '@/lib/opencode/client';
import { getErrorMessage } from '@/lib/error-message';
import type { ExtensionCommandDraft, ExtensionScope, ExtensionSkillDraft, ExtensionSkillRow, ExtensionSnapshot } from '@/lib/opencode/extensions/types';
import type { McpLocalConfig, McpRemoteConfig } from '@/lib/opencode/types';
import {
  addMcpServer,
  addPlugin,
  createSkill,
  loadExtensionSnapshot,
  removeCommand,
  removeMcpServer,
  removePlugin,
  removeSkill,
  restoreConfig,
  saveCommand,
  updateMcpServer,
  updateSkill,
} from '@/providers/services/extensions-service';

type ExtensionsInput = {
  client: ScopedOpencodeClient;
  isCurrentClient: (candidate: object) => boolean;
  refreshChatCapabilities: () => Promise<unknown>;
  refreshServerFeatures: () => Promise<unknown>;
  refreshMcpServers: () => Promise<unknown>;
};

export function useExtensionsState({
  client,
  isCurrentClient,
  refreshChatCapabilities,
  refreshServerFeatures,
  refreshMcpServers,
}: ExtensionsInput) {
  type Loaded = { client: ScopedOpencodeClient; snapshot: ExtensionSnapshot };
  const [loaded, setLoaded] = useState<Loaded>();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const busyRef = useRef<string | undefined>(undefined);
  const loadedRef = useRef<Loaded | undefined>(undefined);
  const snapshot = loaded?.client === client ? loaded.snapshot : undefined;

  const resetExtensions = useCallback(() => {
    loadedRef.current = undefined;
    setLoaded(undefined);
    setError(undefined);
    setBusy(undefined);
  }, []);

  const refresh = useCallback(async () => {
    if (client.__opencode.contract !== 'v2') {
      loadedRef.current = undefined;
      setLoaded(undefined);
      return;
    }
    setIsRefreshing(true);
    try {
      const next = await loadExtensionSnapshot(client);
      if (isCurrentClient(client)) {
        const value = { client, snapshot: next };
        loadedRef.current = value;
        setLoaded(value);
        setError(undefined);
      }
    } catch (failure) {
      if (isCurrentClient(client)) setError(getErrorMessage(failure));
      throw failure;
    } finally {
      setIsRefreshing(false);
    }
  }, [client, isCurrentClient]);

  const run = useCallback(async (key: string, action: (current: ExtensionSnapshot) => Promise<void>) => {
    if (busyRef.current) throw new Error('Another extension change is already in progress.');
    const current = loadedRef.current?.client === client ? loadedRef.current.snapshot : undefined;
    if (!current) throw new Error('Refresh extensions before making a change.');
    busyRef.current = key;
    setBusy(key);
    setError(undefined);
    try {
      await action(current);
      if (!isCurrentClient(client)) return;
      await refresh();
      if (!isCurrentClient(client)) return;
      await Promise.all([
        refreshChatCapabilities().catch(() => undefined),
        refreshServerFeatures().catch(() => undefined),
        refreshMcpServers().catch(() => undefined),
      ]);
    } catch (failure) {
      if (isCurrentClient(client)) setError(getErrorMessage(failure));
      throw failure;
    } finally {
      busyRef.current = undefined;
      setBusy(undefined);
    }
  }, [client, isCurrentClient, refresh, refreshChatCapabilities, refreshMcpServers, refreshServerFeatures]);

  const extensions = useMemo(() => ({
    snapshot,
    isRefreshing,
    busy,
    error,
    refresh,
    addMcp: (scope: ExtensionScope, name: string, config: McpLocalConfig | McpRemoteConfig) =>
      run('add-mcp', (current) => addMcpServer(client, current, scope, name, config)),
    updateMcp: (scope: ExtensionScope, name: string, config: McpLocalConfig | McpRemoteConfig) =>
      run('update-mcp', (current) => updateMcpServer(client, current, scope, name, config)),
    removeMcp: (scope: ExtensionScope, name: string) =>
      run('remove-mcp', (current) => removeMcpServer(client, current, scope, name)),
    addPlugin: (scope: ExtensionScope, target: string) =>
      run('add-plugin', (current) => addPlugin(client, current, scope, target)),
    removePlugin: (scope: ExtensionScope, target: string) =>
      run('remove-plugin', (current) => removePlugin(client, current, scope, target)),
    saveCommand: (scope: ExtensionScope, draft: ExtensionCommandDraft, previousName?: string) =>
      run('save-command', (current) => saveCommand(client, current, scope, draft, previousName)),
    removeCommand: (scope: ExtensionScope, name: string) =>
      run('remove-command', (current) => removeCommand(client, current, scope, name)),
    createSkill: (scope: ExtensionScope, draft: ExtensionSkillDraft) =>
      run('create-skill', (current) => createSkill(client, current, scope, draft)),
    updateSkill: (scope: ExtensionScope, row: ExtensionSkillRow, content: string) =>
      run('update-skill', (current) => updateSkill(client, current, scope, row, content)),
    removeSkill: (scope: ExtensionScope, row: ExtensionSkillRow) =>
      run('remove-skill', (current) => removeSkill(client, current, scope, row)),
    restoreBackup: (scope: ExtensionScope) =>
      run('restore-backup', (current) => restoreConfig(client, current, scope)),
  }), [busy, client, error, isRefreshing, refresh, run, snapshot]);

  return { extensions, resetExtensions };
}
