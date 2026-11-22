// @vitest-environment happy-dom

import '../../../tests/helpers/cloud-link-platform';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, createElement, useEffect } from 'react';
import { describe, expect, it, onTestFinished, vi } from 'vitest';

import { useFileClipboard } from '@/features/projects/state/use-file-clipboard';
import { useProjectEntryActions } from '@/features/projects/state/use-project-entry-actions';
import { createFileClipboard } from '@/features/projects/services/file-clipboard';
import { AppCoreProvider } from '@/runtime/core/context';
import type { AppCore } from '@/runtime/core/create-app-core';
import { createAppStore } from '@/runtime/core/store';
import type { ScopedOpencodeClient } from '@/shared/protocol/opencode/client';
import { entryCommand, EntryOperationError } from '@/shared/protocol/opencode/project-entry-operations';
import { deferred } from '../../../tests/helpers/controlled-clock';
import { renderHook } from '../../../tests/helpers/render-hook';

const native = vi.hoisted(() => ({
  copy: vi.fn(async (_text: string) => {}), copyHaptic: vi.fn(async () => {}), selectionAsync: vi.fn(async () => {}),
}));
vi.mock('expo-router', () => ({ usePathname: () => '/' }));
vi.mock('expo-clipboard', () => ({ setStringAsync: native.copy }));
vi.mock('expo-haptics', () => ({
  notificationAsync: native.copyHaptic, selectionAsync: native.selectionAsync, NotificationFeedbackType: { Success: 'success' },
}));
vi.mock('react-i18next', async (original) => ({
  ...await original<typeof import('react-i18next')>(), useTranslation: () => ({ t: (key: string) => key }),
}));

const identity = { connectionId: 'test', connectionScope: 'scope', authRevision: 0 };

const file = { path: 'src/demo.ts', name: 'demo.ts', type: 'file' as const };
const connection = (id = 'server', enabled = true, password = '') => ({
  id, name: id, enabled, settings: { serverUrl: 'http://fixture', username: '', password, directory: '' }, projects: [''], preferences: {},
});

function clipboardFixture() {
  const store = createAppStore({ settings: { serverUrl: '', username: '', password: '', directory: '' }, chatPreferences: {} as never, controlPlaneUrl: '' });
  const refreshDetached = vi.fn(async () => {});
  return { store, clipboard: createFileClipboard(store, refreshDetached), refreshDetached };
}

async function invoke<T>(action: () => T | Promise<T>) {
  let result!: T;
  await act(async () => { result = await action(); });
  return result;
}
function start<T>(action: () => Promise<T>) {
  let pending!: Promise<T>;
  act(() => { pending = action(); });
  return pending;
}

async function mount() {
  const inspect = vi.fn(async () => 'missing');
  const mutate = vi.fn(async (_command: string, _cwd: string) => {});
  const refreshA = vi.fn(async () => {}), refreshB = vi.fn(async () => {});
  const { store, clipboard } = clipboardFixture();
  const cache = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity, retry: false } } });
  const core = { store, clipboard, queryClient: cache } as AppCore;
  const outputs = new Map<string, string>();
  let sequence = 0;
  const shell = {
    async create({ command, cwd }: { command: string; cwd: string }) {
      const id = String(++sequence);
      const args = command.split(' opencode-files ')[1]?.split(' ') ?? [];
      let exit = 0;
      let output = '';
      if (args.length === 6) output = await inspect();
      if (args.length === 7) {
        try { await mutate(command, cwd); output = 'ok'; }
        catch (error) {
          if (!(error instanceof EntryOperationError) || error.code === 'uncertain') throw error;
          exit = 1; output = `OCF:${error.code}`;
        }
      }
      outputs.set(id, output);
      return { data: { id, status: 'exited', exit } };
    },
    output: async ({ id }: { id: string }) => ({ data: { output: outputs.get(id) ?? '' } }),
    remove: async ({ id }: { id: string }) => { outputs.delete(id); },
  };
  const client = (directory: string) => ({ __opencode: { contract: 'v2', directory }, api: { shell } }) as ScopedOpencodeClient;
  const clientA = client('/repo'), clientB = client('/worktrees/feature');
  let current = true;
  const isCurrentClient = () => current;
  store.getState().setRegistry({ connections: [connection()] });
  const stop = clipboard.start();
  const actions = (client: ScopedOpencodeClient, refresh: () => Promise<void>, clipboard: ReturnType<typeof useFileClipboard>) =>
    ({ identity, scopeKey: client.__opencode.directory ?? '', client, refresh, clipboard, connectionId: 'server', enabled: true, isCurrentClient });
  const runtime = renderHook(() => {
    useEffect(() => stop, []);
    const placement = useFileClipboard();
    return { clipboard: placement,
      a: useProjectEntryActions(actions(clientA, refreshA, placement)),
      b: useProjectEntryActions(actions(clientB, refreshB, placement)) };
  }, undefined, ({ children }) => createElement(AppCoreProvider, { core },
    createElement(QueryClientProvider, { client: cache }, children)));
  onTestFinished(() => cache.clear());
  vi.clearAllMocks();
  await act(async () => {
    await Promise.all([runtime.result.current.a.probe(), runtime.result.current.b.probe()]);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });
  return { runtime, inspect, mutate, ...native, refreshA, refreshB, stale: () => { current = false; } };
}

describe('connection file clipboard and actions', () => {
  it('keeps one entry per connection and clears only disconnected or reconfigured connections', () => {
    const { store, clipboard } = clipboardFixture();
    const { setRegistry } = store.getState();
    const entries = () => store.getState().fileClipboard.entries;
    setRegistry({ connections: [connection('a'), connection('b')] });
    const stop = clipboard.start();
    const entry = { root: '/repo', ...file, mode: 'copy' as const };
    clipboard.select('a', entry);
    clipboard.select('b', entry);
    setRegistry({ connections: [connection('a'), connection('b')] });
    expect(entries().a).toEqual(entry);
    setRegistry({ connections: [connection('a', false), connection('b')] });
    expect(entries().a).toBeUndefined(); expect(entries().b).toEqual(entry);
    setRegistry({ connections: [connection('b', true, 'changed')] });
    expect(entries().b).toBeUndefined();
    stop();
  });
  it('invalidates a detached source once when a paste refreshes both roots', async () => {
    const { clipboard, refreshDetached } = clipboardFixture();
    const refreshMounted = vi.fn(async () => {});
    const stop = clipboard.register('server', '/destination', refreshMounted);
    await clipboard.refresh('server', ['/destination', '/source', '/source']);
    expect(refreshMounted).toHaveBeenCalledOnce();
    expect(refreshDetached).toHaveBeenCalledExactlyOnceWith('server', '/source');
    stop();
  });
  it('serializes mutations on the same connection and ignores duplicate taps', async () => {
    const { runtime, mutate } = await mount();
    const gate = deferred(); mutate.mockImplementation(async () => { await gate.promise; });
    const first = start(() => runtime.result.current.a.rename(file, 'renamed.ts'));
    const second = start(() => runtime.result.current.b.rename(file, 'other.ts'));
    expect(await second).toBe(false);
    await invoke(() => gate.resolve()); expect(await first).toBe(true); expect(mutate).toHaveBeenCalledTimes(1);
    runtime.unmount();
  });
  it('pastes across worktrees, refreshes both roots, and clears Cut only after success', async () => {
    const { runtime, mutate, refreshA, refreshB } = await mount();
    act(() => { runtime.result.current.a.select(file, 'cut'); });
    expect(runtime.result.current.b.clipboard?.root).toBe('/repo');
    expect(await invoke(() => runtime.result.current.b.paste('src', 'missing'))).toBe(true);
    expect(mutate).toHaveBeenCalledWith(entryCommand({
      kind: 'move', source: { root: '/repo', path: 'src/demo.ts', type: 'file' },
      destination: { root: '/worktrees/feature', path: 'src/demo.ts' },
    }, 'missing'), '/worktrees/feature');
    expect(runtime.result.current.b.clipboard).toBeUndefined();
    expect(refreshA).toHaveBeenCalledOnce(); expect(refreshB).toHaveBeenCalledOnce();
    runtime.unmount();
  });
  it('retains copied entries for repeated pastes and retains Cut after failure', async () => {
    const { runtime, mutate } = await mount();
    act(() => { runtime.result.current.a.select(file, 'copy'); });
    await invoke(() => runtime.result.current.b.paste('src', 'missing'));
    expect(runtime.result.current.b.clipboard?.mode).toBe('copy');
    act(() => { runtime.result.current.a.select(file, 'cut'); });
    mutate.mockRejectedValue(new EntryOperationError('uncertain'));
    expect(await invoke(() => runtime.result.current.b.paste('src', 'missing'))).toBe(false);
    expect(runtime.result.current.b.clipboard?.mode).toBe('cut'); expect(runtime.result.current.b.error).toContain('uncertain');
    runtime.unmount();
  });
  it('rejects invalid rename names and stale overwrite tokens before mutation', async () => {
    const { runtime, inspect, mutate } = await mount();
    expect(await invoke(() => runtime.result.current.a.rename(file, '../outside'))).toBe(false);
    act(() => { runtime.result.current.a.select(file, 'copy'); }); inspect.mockResolvedValue('file:new');
    expect(await invoke(() => runtime.result.current.b.paste('src', 'file:old'))).toBe(false); expect(mutate).not.toHaveBeenCalled();
    runtime.unmount();
  });
  it('ignores preflight results after the client is invalidated', async () => {
    const { runtime, inspect, mutate, stale } = await mount();
    const gate = deferred<string>(); inspect.mockImplementation(async () => String(await gate.promise));
    const result = start(() => runtime.result.current.a.rename(file, 'renamed.ts'));
    stale(); await invoke(() => gate.resolve('missing'));
    expect(await result).toBe(false); expect(mutate).not.toHaveBeenCalled(); runtime.unmount();
  });
  it('reports refresh failure as a completed mutation and copies absolute paths to the device', async () => {
    const { runtime, refreshA, copy, copyHaptic } = await mount();
    refreshA.mockRejectedValue(new Error('offline'));
    expect(await invoke(() => runtime.result.current.a.rename(file, 'renamed.ts'))).toBe(true);
    expect(runtime.result.current.a.error).toContain('refreshFailed');
    await invoke(() => runtime.result.current.a.copyPath(file));
    expect(copy).toHaveBeenCalledWith('/repo/src/demo.ts');
    expect(copyHaptic).toHaveBeenCalledOnce();
    runtime.unmount();
  });
  it('acknowledges staged Copy and Cut with haptics', async () => {
    const { runtime, selectionAsync } = await mount();
    act(() => { runtime.result.current.a.select(file, 'copy'); });
    expect(selectionAsync).toHaveBeenCalledOnce();
    runtime.unmount();
  });
});
