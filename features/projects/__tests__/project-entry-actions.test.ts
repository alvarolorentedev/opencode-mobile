import { describe, expect, it, vi } from 'vitest';
import { hookRuntime, loadTs, deferred } from '../../../tests/helpers/runtime.mjs';
import { projectPath } from '@/shared/protocol/opencode/project';
import { EntryOperationError } from '@/shared/protocol/opencode/project-entry-operations';
import { createAppStore, type AppState } from '@/runtime/core/store';
import { createFileClipboard } from '@/features/projects/services/file-clipboard';

const identity = { connectionId: 'test', connectionScope: 'scope', authRevision: 0 };

const t = (key: string) => key;
const file = { path: 'src/demo.ts', name: 'demo.ts', type: 'file' as const };
const connection = (id = 'server', enabled = true, password = '') => ({
  id, name: id, enabled, settings: { serverUrl: 'http://fixture', username: '', password, directory: '' }, projects: [''], preferences: {},
});

function clipboardFixture() {
  const store = createAppStore({ settings: { serverUrl: '', username: '', password: '', directory: '' }, chatPreferences: {} as never, controlPlaneUrl: '' });
  const refreshDetached = vi.fn(async () => {});
  return { store, clipboard: createFileClipboard(store, refreshDetached), refreshDetached };
}

function coreImports(runtime: ReturnType<typeof hookRuntime>) {
  const { store, clipboard } = clipboardFixture();
  return { store, clipboard, imports: {
    react: runtime.react,
    '@/runtime/core': {
      useAppCore: () => ({ store, clipboard }),
      useAppStore<T>(select: (state: AppState) => T) {
        const [, refresh] = runtime.react.useState(0);
        runtime.react.useEffect(() => store.subscribe(() => refresh((version: number) => version + 1)), []);
        return select(store.getState());
      },
    },
  } };
}

async function mount() {
  const runtime = hookRuntime(), inspect = vi.fn(async () => 'missing'), mutate = vi.fn(async () => {});
  const copy = vi.fn(async () => {}), copyHaptic = vi.fn(), selectionAsync = vi.fn(async () => {}), refreshA = vi.fn(async () => {}), refreshB = vi.fn(async () => {});
  const { store, clipboard, imports } = coreImports(runtime);
  const { useFileClipboard } = await loadTs('features/projects/state/use-file-clipboard.ts', imports);
  const { useProjectEntryActions } = await loadTs('features/projects/state/use-project-entry-actions.ts', {
    ...imports,
    '@/shared/platform/clipboard': { setStringAsync: copy },
    '@/shared/platform/haptics': { copyHaptic, selectionAsync },
    'react-i18next': { useTranslation: () => ({ t }) },
    "@/shared/protocol/opencode/project": { projectPath },
    "@/shared/protocol/opencode/project-entry-operations": { EntryOperationError },
    "@/features/projects/services/project-service": { projectEntryOperations: () => ({ probe: async () => true, inspect, mutate }) }
  });
  const clientA = { __opencode: { directory: '/repo' } }, clientB = { __opencode: { directory: '/worktrees/feature' } };
  let current = true;
  const isCurrentClient = () => current;
  store.getState().setRegistry({ connections: [connection()] });
  const stop = clipboard.start();
  runtime.mount(() => {
    runtime.react.useEffect(() => stop, []);
    const clipboard = useFileClipboard();
    const useActions = (client: any, refresh: any) => useProjectEntryActions({ identity, scopeKey: client.__opencode.directory, client, refresh, clipboard, connectionId: 'server', enabled: true, isCurrentClient });
    return { clipboard, a: useActions(clientA, refreshA), b: useActions(clientB, refreshB) };
  }, {});
  await runtime.value.a.probe(); await runtime.value.b.probe(); runtime.flush();
  return { runtime, inspect, mutate, copy, copyHaptic, selectionAsync, refreshA, refreshB, stale: () => { current = false; } };
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
    const first = runtime.value.a.rename(file, 'renamed.ts');
    const second = runtime.value.b.rename(file, 'other.ts');
    expect(await second).toBe(false);
    gate.resolve(undefined); expect(await first).toBe(true); expect(mutate).toHaveBeenCalledTimes(1);
    runtime.unmount();
  });
  it('pastes across worktrees, refreshes both roots, and clears Cut only after success', async () => {
    const { runtime, mutate, refreshA, refreshB } = await mount();
    runtime.value.a.select(file, 'cut'); runtime.flush();
    expect(runtime.value.b.clipboard.root).toBe('/repo');
    expect(await runtime.value.b.paste('src', 'missing')).toBe(true); runtime.flush();
    expect(mutate).toHaveBeenCalledWith(expect.objectContaining({ kind: 'move', source: expect.objectContaining({ root: '/repo' }), destination: { root: '/worktrees/feature', path: 'src/demo.ts' } }), 'missing');
    expect(runtime.value.b.clipboard).toBeUndefined();
    expect(refreshA).toHaveBeenCalledOnce(); expect(refreshB).toHaveBeenCalledOnce();
    runtime.unmount();
  });
  it('retains copied entries for repeated pastes and retains Cut after failure', async () => {
    const { runtime, mutate } = await mount();
    runtime.value.a.select(file, 'copy'); runtime.flush();
    await runtime.value.b.paste('src', 'missing'); runtime.flush();
    expect(runtime.value.b.clipboard.mode).toBe('copy');
    runtime.value.a.select(file, 'cut'); runtime.flush();
    mutate.mockRejectedValue(new EntryOperationError('uncertain'));
    expect(await runtime.value.b.paste('src', 'missing')).toBe(false); runtime.flush();
    expect(runtime.value.b.clipboard.mode).toBe('cut'); expect(runtime.value.b.error).toContain('uncertain');
    runtime.unmount();
  });
  it('rejects invalid rename names and stale overwrite tokens before mutation', async () => {
    const { runtime, inspect, mutate } = await mount();
    expect(await runtime.value.a.rename(file, '../outside')).toBe(false);
    runtime.value.a.select(file, 'copy'); runtime.flush(); inspect.mockResolvedValue('file:new');
    expect(await runtime.value.b.paste('src', 'file:old')).toBe(false); expect(mutate).not.toHaveBeenCalled();
    runtime.unmount();
  });
  it('ignores preflight results after the client is invalidated', async () => {
    const { runtime, inspect, mutate, stale } = await mount();
    const gate = deferred(); inspect.mockImplementation(async () => String(await gate.promise));
    const result = runtime.value.a.rename(file, 'renamed.ts');
    stale(); gate.resolve('missing');
    expect(await result).toBe(false); expect(mutate).not.toHaveBeenCalled(); runtime.unmount();
  });
  it('reports refresh failure as a completed mutation and copies absolute paths to the device', async () => {
    const { runtime, refreshA, copy, copyHaptic } = await mount();
    refreshA.mockRejectedValue(new Error('offline'));
    expect(await runtime.value.a.rename(file, 'renamed.ts')).toBe(true); runtime.flush();
    expect(runtime.value.a.error).toContain('refreshFailed');
    await runtime.value.a.copyPath(file);
    expect(copy).toHaveBeenCalledWith('/repo/src/demo.ts');
    expect(copyHaptic).toHaveBeenCalledOnce();
    runtime.unmount();
  });
  it('acknowledges staged Copy and Cut with haptics', async () => {
    const { runtime, selectionAsync } = await mount();
    runtime.value.a.select(file, 'copy'); runtime.flush();
    expect(selectionAsync).toHaveBeenCalledOnce();
    runtime.unmount();
  });
});
