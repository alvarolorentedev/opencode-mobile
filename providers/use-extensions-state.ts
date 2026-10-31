import { useCallback, useMemo, useRef, useState } from 'react';

import { getErrorMessage } from '@/lib/error-message';
import type { ScopedOpencodeClient } from '@/lib/opencode/client';
import type { ExtensionCommandDraft, ExtensionScope, ExtensionSkillDraft, ExtensionSkillRow, ExtensionSnapshot } from '@/lib/opencode/extensions/types';
import type { McpLocalConfig, McpRemoteConfig } from '@/lib/opencode/types';
import { commandsOptions, configurationOptions, skillsOptions } from '@/providers/queries/catalogs';
import { useQueryActivity, useQueryIdentity } from '@/providers/queries/client';
import { extensionInspectionOptions, pluginsOptions } from '@/providers/queries/extensions';
import { mcpOptions } from '@/providers/queries/mcp';
import {
  addMcpServer,
  addPlugin,
  createSkill,
  extensionSnapshot,
  removeCommand,
  removeMcpServer,
  removePlugin,
  removeSkill,
  restoreConfig,
  saveCommand,
  updateMcpServer,
  updateSkill,
} from '@/providers/services/extensions-service';
import { useQueries, useQueryClient } from '@tanstack/react-query';

type ExtensionsInput = {
  client: ScopedOpencodeClient;
  isCurrentClient: (candidate: object) => boolean;
};

export function useExtensionsState({
  client,
  isCurrentClient,
}: ExtensionsInput) {
  const cache = useQueryClient();
  const identity = useQueryIdentity();
  const active = useQueryActivity();
  const [requested, setRequested] = useState(false);
  const subscribed = active && requested;
  const [configuration] = useQueries({ queries: [configurationOptions(identity, client)].filter(() => subscribed) });
  const [commands] = useQueries({ queries: [commandsOptions(identity, client)].filter(() => subscribed) });
  const [skills] = useQueries({ queries: [skillsOptions(identity, client)].filter(() => subscribed) });
  const [plugins] = useQueries({ queries: [pluginsOptions(identity, client)].filter(() => subscribed) });
  const [mcp] = useQueries({ queries: [mcpOptions(identity, client)].filter(() => subscribed) });
  const [inspection] = useQueries({ queries: [extensionInspectionOptions(identity, client)].filter(() => subscribed) });
  const snapshot = useMemo(() => configuration?.data?.entries && skills?.data?.details && inspection?.data
    ? extensionSnapshot({ entries: configuration?.data.entries, skills: skills?.data.details, commands: commands?.data ?? [], plugins: plugins?.data ?? [], mcpStatuses: mcp?.data ?? {} }, inspection?.data)
    : undefined, [configuration?.data, skills?.data, commands?.data, plugins?.data, mcp?.data, inspection?.data]);
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const busyRef = useRef<string | undefined>(undefined);
  const refresh = useCallback(async () => {
    if (client.__opencode.contract !== 'v2' || !isCurrentClient(client) || !active) return;
    setRequested(true);
    await Promise.all([
      cache.fetchQuery({ ...configurationOptions(identity, client), staleTime: 0 }),
      cache.fetchQuery({ ...skillsOptions(identity, client), staleTime: 0 }),
      cache.fetchQuery({ ...commandsOptions(identity, client), staleTime: 0 }),
      cache.fetchQuery({ ...pluginsOptions(identity, client), staleTime: 0 }),
      cache.fetchQuery(mcpOptions(identity, client)),
    ]);
    await cache.fetchQuery(extensionInspectionOptions(identity, client));
  }, [active, cache, client, identity, isCurrentClient]);
  const run = useCallback(async (key: string, action: (current: ExtensionSnapshot) => Promise<void>) => {
    if (busyRef.current) throw new Error('Another extension change is already in progress.');
    const current = snapshot;
    if (!current) throw new Error('Refresh extensions before making a change.');
    busyRef.current = key;
    setBusy(key);
    setError(undefined);
    try {
      await cache.cancelQueries({ queryKey: ['opencode', identity.connectionId] });
      await action(current);
      if (!isCurrentClient(client)) return;
      await cache.invalidateQueries({ predicate: (query) => query.queryKey[0] === 'opencode' && query.queryKey[1] === identity.connectionId
        && ['capabilities', 'configuration', 'agents', 'skills', 'references', 'commands', 'plugins', 'mcp', 'extension-inspection'].includes(String(query.queryKey[7])) });
    } catch (failure) {
      if (isCurrentClient(client)) setError(getErrorMessage(failure));
      throw failure;
    } finally {
      busyRef.current = undefined;
      setBusy(undefined);
    }
  }, [cache, client, identity, isCurrentClient, snapshot]);

  const extensions = useMemo(() => ({
    snapshot,
    isRefreshing: Boolean(inspection?.isFetching || configuration?.isFetching || skills?.isFetching || plugins?.isFetching),
    busy,
    error: error ?? inspection?.error?.message ?? configuration?.error?.message,
    refresh,
    addMcp: (scope: ExtensionScope, name: string, config: McpLocalConfig | McpRemoteConfig) =>
      // eslint-disable-next-line react-hooks/refs -- These are deferred user actions; the memo only constructs callbacks.
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
  }), [busy, client, error, inspection?.isFetching, inspection?.error, configuration?.isFetching, configuration?.error, skills?.isFetching, plugins?.isFetching, refresh, run, snapshot]);

  return { extensions };
}
