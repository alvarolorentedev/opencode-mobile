// @vitest-environment happy-dom

import '../../../tests/helpers/native-primitives';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, createElement } from 'react';
import { describe, expect, it, onTestFinished, vi } from 'vitest';

import { useExtensionsState } from '@/features/extensions/state/use-extensions-state';
import { PluginGuiView } from '@/features/extensions/ui/plugin-gui-view';
import { AppCoreProvider } from '@/runtime/core/context';
import type { AppCore } from '@/runtime/core/create-app-core';
import { createAppStore } from '@/runtime/core/store';
import { defaultChatPreferences } from '@/shared/preferences/opencode-preferences';
import type { ScopedOpencodeClient } from '@/shared/protocol/opencode/client';
import { FieldDescription } from '@/shared/ui/text-field';
import { connectionViewProbe } from '../../../tests/helpers/connection-view-probe';
import { settleReact } from '../../../tests/helpers/controlled-clock';
import { renderHook } from '../../../tests/helpers/render-hook';

const platform = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock('react-native', async () => (await import('../../../tests/helpers/native-view-platform')).nativeViewPlatform({ platform: 'web' }));
vi.mock('expo-router', () => ({ usePathname: () => '/' }));
vi.mock('expo-constants', () => ({ default: {} }));
vi.mock('expo-localization', () => ({ getLocales: () => [] }));
vi.mock('expo/fetch', () => ({ fetch: platform.fetch }));
vi.mock('expo-crypto', () => ({}));
vi.mock('expo-secure-store', () => ({}));
vi.mock('expo-file-system', () => ({}));
vi.mock('@react-native-async-storage/async-storage', () => ({ default: {} }));
vi.mock('react-i18next', async (original) => ({
  ...await original<typeof import('react-i18next')>(),
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));

const identity = { connectionId: 'test', connectionScope: 'scope', authRevision: 0 };
const settings = { serverUrl: 'http://server', username: '', password: '', directory: '/repo' };

function load(queryActive: boolean, isCurrentClient = () => true) {
  const data = async () => ({ data: [] });
  const plugins = vi.fn(async () => ({ data: [{
    id: 'flowgraph', source: { type: 'package', target: 'flowgraph' },
    features: { gui: true }, state: { status: 'active' },
  }] }));
  const mutate = vi.fn();
  const client = {
    __opencode: { contract: 'v2', directory: '/repo' },
    api: {
      config: { get: async () => [] },
      plugin: { list: plugins },
      skill: { list: data }, mcp: { list: data }, agent: { list: data }, command: { list: data },
      file: { list: data, write: mutate }, shell: { create: async () => { throw new Error('No shell'); } },
    },
  } as unknown as ScopedOpencodeClient;
  const store = createAppStore({ settings, chatPreferences: defaultChatPreferences, controlPlaneUrl: '' });
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const core = { store, queryClient: cache } as AppCore;
  onTestFinished(() => cache.clear());
  const driver = renderHook(
    (active: boolean) => useExtensionsState({ identity, queryActive: active, scopeKey: 'extensions-test-workspace', client, isCurrentClient, settings }),
    queryActive,
    ({ children }) => createElement(AppCoreProvider, { core }, createElement(QueryClientProvider, { client: cache }, children)),
  );
  return { driver, cache, plugins, mutate };
}

describe('plugin GUI state', () => {
  it('cancels an extension write when the connection changes while reads are being cancelled', async () => {
    let current = true;
    const { driver, cache, mutate } = load(true, () => current);
    await act(async () => {
      await driver.result.current.extensions.refresh();
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });
    expect(driver.result.current.extensions.snapshot).toBeDefined();
    const cancel = vi.spyOn(cache, 'cancelQueries').mockImplementationOnce(async () => { current = false; });
    await act(async () => {
      await expect(driver.result.current.extensions.addPlugin('project', 'flowgraph')).rejects.toThrow('Refresh extensions before making a change.');
    });
    expect(cancel).toHaveBeenCalledOnce();
    expect(mutate).not.toHaveBeenCalled();
    driver.unmount();
  });

  it('observes the plugin list when the workspace activates, before the launcher loads', async () => {
    const { driver, plugins } = load(true);
    await settleReact();
    expect(plugins).toHaveBeenCalled();
    driver.unmount();
  });

  it('starts the plugin list read when a retained workspace becomes demanded', async () => {
    const { driver, plugins } = load(false);
    await settleReact();
    expect(plugins).not.toHaveBeenCalled();
    driver.rerender(true);
    await settleReact();
    expect(plugins).toHaveBeenCalled();
    driver.unmount();
  });

  it('keeps the selected plugin in the workspace runtime', async () => {
    const { driver } = load(true);
    await settleReact();
    expect(driver.result.current.extensions.pluginGui.selectedPluginId).toBeUndefined();
    act(() => { driver.result.current.extensions.pluginGui.selectPlugin('flowgraph'); });
    expect(driver.result.current.extensions.pluginGui.selectedPluginId).toBe('flowgraph');
    driver.unmount();
  });
});

it('does not load or mount a plugin bundle in the browser app page', async () => {
  const read = vi.fn(async () => Response.json({ code: 'throw new Error("bundle ran")' }));
  platform.fetch.mockImplementation(read);
  vi.stubGlobal('fetch', read);
  onTestFinished(() => { vi.unstubAllGlobals(); });
  const driver = renderHook(PluginGuiView, {
    pluginId: 'flowgraph', session: { id: 's' }, onClose: vi.fn(), onOpenSession: vi.fn(async () => {}),
  }, connectionViewProbe({} as never, false, { initialize: (store) => store.getState().setShellValue('settings', settings) }));
  await settleReact();
  expect(read).not.toHaveBeenCalled();
  expect(driver.result.current).toMatchObject({ type: FieldDescription, props: { children: 'settings:extensions.gui.unavailable' } });
  driver.unmount();
});
