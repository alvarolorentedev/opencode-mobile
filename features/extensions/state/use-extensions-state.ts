import { useCallback, useMemo, useRef, useState } from 'react';

import { getErrorMessage } from '@/shared/utilities/error-message';
import type { OpencodeConnectionSettings, ScopedOpencodeClient } from '@/shared/protocol/opencode/client';
import type { ExtensionAgentDraft, ExtensionAgentRow, ExtensionCommandDraft, ExtensionCommandRow, ExtensionScope, ExtensionSkillDraft, ExtensionSkillRow, ExtensionSnapshot } from '@/shared/protocol/opencode/extensions/types';
import type { McpLocalConfig, McpRemoteConfig } from '@/shared/protocol/opencode/types';
import { configurationOptions, skillsOptions } from '@/shared/server-data/catalogs';
import { useQueryActivity, useQueryIdentity } from '@/shared/server-data/client';
import { extensionInspectionOptions, pluginsOptions } from '@/features/extensions/services/queries/extensions';
import { readPluginGui } from '@/features/extensions/services/plugin-gui-service';
import { isPluginGui, pluginGuiLabel } from '@/features/extensions/model/plugin-gui';
import { mcpOptions } from '@/shared/server-data/diagnostics';
import { addMcpServer, addPlugin, createSkill, extensionSnapshot, removeMcpServer, removePlugin, removeSkill, restoreConfig, updateMcpServer, updateSkill } from '@/features/extensions/services/extensions-service';
import { removeAgent, removeCommand, saveAgent, saveCommand } from '@/features/extensions/services/definitions-service';
import { useQueries, useQueryClient } from '@tanstack/react-query';

type ExtensionsInput = {
  client: ScopedOpencodeClient;
  isCurrentClient: (candidate: object) => boolean;
  settings: OpencodeConnectionSettings;
};

export function useExtensionsState({
  client,
  isCurrentClient,
  settings,
}: ExtensionsInput) {
  const cache = useQueryClient();
  const identity = useQueryIdentity();
  const active = useQueryActivity();
  const [requested, setRequested] = useState(false);
  const subscribed = active && requested;
  const [configuration] = useQueries({ queries: [configurationOptions(identity, client)].filter(() => subscribed) });
  const [skills] = useQueries({ queries: [skillsOptions(identity, client)].filter(() => subscribed) });
  // Keep the GUI plugin list observed while the workspace is active. It decides
  // whether the chat header shows the plugin button; a one-shot fetch that lands
  // before the server finishes booting a location would otherwise stay cached and
  // hide the button until the app restarts. Being observed also lets the existing
  // plugin/config/command event invalidations refresh it.
  const [plugins] = useQueries({ queries: [{ ...pluginsOptions(identity, client), enabled: active }] });
  const [mcp] = useQueries({ queries: [mcpOptions(identity, client)].filter(() => subscribed) });
  const [inspection] = useQueries({ queries: [extensionInspectionOptions(identity, client)].filter(() => subscribed) });
  const inspectionData = inspection?.data;
  const snapshot = useMemo(() => configuration?.data?.entries && skills?.data?.details && inspectionData
    ? extensionSnapshot({ entries: configuration?.data?.entries, skills: skills?.data?.details, plugins: plugins?.data ?? [], mcpStatuses: mcp?.data ?? {} }, inspectionData)
    : undefined, [configuration?.data, skills?.data, plugins?.data, mcp?.data, inspectionData]);
  const guiPlugins = useMemo(() => (plugins?.data ?? []).filter(isPluginGui).map((plugin) => ({
    id: plugin.id,
    label: pluginGuiLabel(plugin),
    version: plugin.source.type === 'package' ? plugin.source.version : undefined,
    source: plugin.source,
  })), [plugins?.data]);
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const busyRef = useRef<string | undefined>(undefined);
  const refresh = useCallback(async () => {
    if (client.__opencode.contract !== 'v2' || !isCurrentClient(client) || !active) return;
    setRequested(true);
    await Promise.all([
      cache.fetchQuery({ ...configurationOptions(identity, client), staleTime: 0 }),
      cache.fetchQuery({ ...skillsOptions(identity, client), staleTime: 0 }),
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
      run('add-mcp', (current) => addMcpServer(client, current, scope, name, config)),
    updateMcp: (scope: ExtensionScope, name: string, config: McpLocalConfig | McpRemoteConfig) =>
      run('update-mcp', (current) => updateMcpServer(client, current, scope, name, config)),
    removeMcp: (scope: ExtensionScope, name: string) =>
      run('remove-mcp', (current) => removeMcpServer(client, current, scope, name)),
    addPlugin: (scope: ExtensionScope, target: string) =>
      run('add-plugin', (current) => addPlugin(client, current, scope, target)),
    removePlugin: (scope: ExtensionScope, target: string) =>
      run('remove-plugin', (current) => removePlugin(client, current, scope, target)),
    pluginGui: {
      plugins: guiPlugins,
      load: async () => {
        if (client.__opencode.contract !== 'v2') return;
        // Subscribe even before the workspace is active: the launcher mounts
        // once, and the query must exist when the connection becomes current.
        setRequested(true);
        if (!isCurrentClient(client) || !active) return;
        // Force a fresh list so a pre-install cached result cannot hide the
        // button for the default stale window after returning from Settings.
        await cache.fetchQuery({ ...pluginsOptions(identity, client), staleTime: 0 });
      },
      read: (id: string) => {
        if (client.__opencode.contract !== 'v2' || !isCurrentClient(client)) {
          return Promise.reject(new Error('Plugin GUIs require OpenCode 2.'));
        }
        return readPluginGui({ ...settings, directory: client.__opencode.directory || settings.directory }, id);
      },
      rpc: async (request: { rpcID: string; method: string; input?: unknown; directory?: string }) => {
        if (client.__opencode.contract !== 'v2' || !isCurrentClient(client) || !client.api?.rpc) {
          throw new Error('Plugin RPC requires OpenCode 2.');
        }
        const result = await client.api.rpc.call({
          rpcID: request.rpcID,
          method: request.method,
          input: request.input as never,
          location: { directory: request.directory ?? client.__opencode.directory },
        });
        return result.output;
      },
      sessionGet: async (request: { sessionID: string }) => {
        if (client.__opencode.contract !== 'v2' || !isCurrentClient(client) || !client.api) {
          throw new Error('Plugin session reads require OpenCode 2.');
        }
        return client.api.session.get({ sessionID: request.sessionID });
      },
    },
    saveCommand: (scope: ExtensionScope, draft: ExtensionCommandDraft, previous?: ExtensionCommandRow) =>
      run('save-command', (current) => saveCommand(client, current, scope, draft, previous)),
    removeCommand: (scope: ExtensionScope, row: ExtensionCommandRow) =>
      run('remove-command', (current) => removeCommand(client, current, scope, row)),
    saveAgent: (scope: ExtensionScope, draft: ExtensionAgentDraft, previous?: ExtensionAgentRow) =>
      run('save-agent', (current) => saveAgent(client, current, scope, draft, previous)),
    removeAgent: (scope: ExtensionScope, row: ExtensionAgentRow) =>
      run('remove-agent', (current) => removeAgent(client, current, scope, row)),
    createSkill: (scope: ExtensionScope, draft: ExtensionSkillDraft) =>
      run('create-skill', (current) => createSkill(client, current, scope, draft)),
    updateSkill: (scope: ExtensionScope, row: ExtensionSkillRow, content: string) =>
      run('update-skill', (current) => updateSkill(client, current, scope, row, content)),
    removeSkill: (scope: ExtensionScope, row: ExtensionSkillRow) =>
      run('remove-skill', (current) => removeSkill(client, current, scope, row)),
    restoreBackup: (scope: ExtensionScope) =>
      run('restore-backup', (current) => restoreConfig(client, current, scope)),
  }), [busy, client, error, guiPlugins, inspection?.isFetching, inspection?.error, configuration?.isFetching, configuration?.error, skills?.isFetching, plugins?.isFetching, active, cache, identity, isCurrentClient, refresh, run, settings, snapshot]);

  return { extensions };
}
