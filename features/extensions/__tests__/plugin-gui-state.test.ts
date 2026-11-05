import { describe, expect, it, vi } from 'vitest';

import { hookRuntime, loadTs } from '../../../tests/helpers/runtime.mjs';

const identity = { connectionId: 'test', connectionScope: 'scope', authRevision: 0 };
const client = { __opencode: { contract: 'v2', directory: '/repo' } };
const settings = { serverUrl: 'http://server', username: '', password: '', directory: '/repo' };

function queryOptions(key: string, queryFn: () => Promise<unknown>) {
  return { queryKey: ['opencode', 'test', key], queryFn };
}

async function load(active: () => boolean) {
  const driver = hookRuntime();
  const plugins = vi.fn(async () => [{
    id: 'flowgraph',
    source: { type: 'package', target: 'flowgraph' },
    features: { gui: true },
    state: { status: 'active' },
  }]);
  const unchanged = vi.fn(async () => undefined);
  const { useExtensionsState } = await loadTs('features/extensions/state/use-extensions-state.ts', {
    react: driver.react,
    '@/shared/server-data/client': {
      useQueryIdentity: () => identity,
      useQueryActivity: active,
      useQueryForeground: () => true,
    },
    '@/shared/server-data/catalogs': {
      configurationOptions: () => queryOptions('configuration', vi.fn(async () => ({ entries: [], config: {} }))),
      skillsOptions: () => queryOptions('skills', vi.fn(async () => ({ details: [] }))),
    },
    '@/features/extensions/services/queries/extensions': {
      pluginsOptions: () => queryOptions('plugins', plugins),
      extensionInspectionOptions: () => queryOptions('inspection', vi.fn(async () => ({}))),
    },
    '@/shared/server-data/diagnostics': { mcpOptions: () => queryOptions('mcp', vi.fn(async () => ({}))) },
    '@/features/extensions/services/extensions-service': {
      addMcpServer: unchanged, addPlugin: unchanged, createSkill: unchanged, extensionSnapshot: () => ({}),
      removeMcpServer: unchanged, removePlugin: unchanged, removeSkill: unchanged, restoreConfig: unchanged,
      updateMcpServer: unchanged, updateSkill: unchanged,
    },
    '@/features/extensions/services/definitions-service': { removeAgent: unchanged, removeCommand: unchanged, saveAgent: unchanged, saveCommand: unchanged },
    '@/features/extensions/services/plugin-gui-service': { readPluginGui: vi.fn() },
    '@/features/extensions/model/plugin-gui': {
      isPluginGui: (plugin: { features?: { gui?: boolean } }) => Boolean(plugin.features?.gui),
      pluginGuiLabel: (plugin: { id: string }) => plugin.id,
    },
    '@/shared/utilities/error-message': { getErrorMessage: (error: unknown) => String(error) },
  });
  driver.mount(() => useExtensionsState({ client, isCurrentClient: () => true, settings }), {});
  return { driver, plugins };
}

describe('plugin GUI state', () => {
  it('observes the plugin list when the workspace activates, before the launcher loads', async () => {
    let active = true;
    const { driver, plugins } = await load(() => active);
    await driver.settle();
    expect(plugins).toHaveBeenCalled();
    active = false;
    driver.unmount();
  });

  it('starts the plugin list read when a retained workspace becomes demanded', async () => {
    let active = false;
    const { driver, plugins } = await load(() => active);
    await driver.settle();
    expect(plugins).not.toHaveBeenCalled();
    active = true;
    driver.flush();
    await driver.settle();
    expect(plugins).toHaveBeenCalled();
    driver.unmount();
  });
});
