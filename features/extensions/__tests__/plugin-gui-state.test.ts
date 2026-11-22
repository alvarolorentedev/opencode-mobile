import { describe, expect, it, vi } from 'vitest';

import { hookRuntime, loadTs } from '../../../tests/helpers/runtime.mjs';
import { queryRuntime } from '../../../tests/helpers/query-runtime.mjs';

const identity = { connectionId: 'test', connectionScope: 'scope', authRevision: 0 };
const client = { __opencode: { contract: 'v2', directory: '/repo' } };
const settings = { serverUrl: 'http://server', username: '', password: '', directory: '/repo' };

function queryOptions(key: string, queryFn: () => Promise<unknown>) {
  return { queryKey: ['opencode', 'test', key], queryFn };
}

async function load(active: () => boolean, isCurrentClient = () => true) {
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
  driver.mount(() => useExtensionsState({ identity, queryActive: active(), scopeKey: 'extensions-test-workspace', client, isCurrentClient, settings }), {});
  return { driver, plugins, mutate: unchanged };
}

describe('plugin GUI state', () => {
  it('cancels an extension write when the connection changes while reads are being cancelled', async () => {
    let current = true;
    const { driver, mutate } = await load(() => true, () => current);
    try {
      await driver.value.extensions.refresh();
      await driver.settle();
      const cache = queryRuntime(driver.react).useQueryClient();
      vi.spyOn(cache, 'cancelQueries').mockImplementationOnce(async () => { current = false; });
      await expect(driver.value.extensions.addPlugin('project', 'flowgraph')).rejects.toThrow('Refresh extensions before making a change.');
      expect(mutate).not.toHaveBeenCalled();
    } finally {
      driver.unmount();
    }
  });

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

  it('keeps the selected plugin in the workspace runtime', async () => {
    const { driver } = await load(() => true);
    await driver.settle();
    expect(driver.value.extensions.pluginGui.selectedPluginId).toBeUndefined();
    driver.value.extensions.pluginGui.selectPlugin('flowgraph');
    await driver.settle();
    expect(driver.value.extensions.pluginGui.selectedPluginId).toBe('flowgraph');
    driver.unmount();
  });
});

it('does not load or mount a plugin bundle in the browser app page', async () => {
  const driver = hookRuntime();
  const read = vi.fn(async () => ({ code: 'throw new Error("bundle ran")' }));
  const element = (type: unknown, props: unknown) => ({ type, props });
  const { PluginGuiView } = await loadTs('features/extensions/ui/plugin-gui-view.tsx', {
    react: driver.react,
    'react/jsx-runtime': { jsx: element, jsxs: element },
    'react-native': { Platform: { OS: 'web' }, View: 'View' },
    'react-i18next': { useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }) },
    '@/features/extensions/context': { useExtensions: () => ({ extensions: { pluginGui: { plugins: [{ id: 'flowgraph' }], read } } }) },
    '@/features/connections/context': { useConnection: () => ({ settings }) },
    '@/shared/ui/theme/appearance-context': { useAppearance: () => ({ scheme: 'light' }) },
    '@/shared/ui/theme/use-palette': { usePalette: () => ({}) },
    '@/shared/ui/select': {},
    '@/shared/ui/button': {},
    '@/shared/ui/spinner': {},
    '@/shared/ui/text': {},
    '@/shared/ui/text-field': { FieldDescription: 'FieldDescription' },
    '@/features/extensions/ui/plugin-gui-dom': { default: 'PluginGuiDom' },
  });
  driver.mount(PluginGuiView, { pluginId: 'flowgraph', session: { id: 's' } });
  await driver.settle();
  expect(read).not.toHaveBeenCalled();
  expect(driver.value).toMatchObject({ type: 'FieldDescription', props: { children: 'settings:extensions.gui.unavailable' } });
  driver.unmount();
});
