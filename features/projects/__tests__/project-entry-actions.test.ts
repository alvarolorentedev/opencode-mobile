import { describe, expect, it, vi } from 'vitest';
import { hookRuntime, loadTs, deferred } from '../../../tests/helpers/runtime.mjs';
import { projectPath } from '@/shared/protocol/opencode/project';
import { EntryOperationError } from '@/shared/protocol/opencode/project-entry-operations';

const t = (key: string) => key;
const file = { path: 'src/demo.ts', name: 'demo.ts', type: 'file' as const };
const connection = (id = 'server', enabled = true, password = '') => ({ id, enabled, settings: { password } });

async function mount() {
  const runtime = hookRuntime(), inspect = vi.fn(async () => 'missing'), mutate = vi.fn(async () => {});
  const copy = vi.fn(async () => {}), refreshA = vi.fn(async () => {}), refreshB = vi.fn(async () => {});
  const { useFileClipboard } = await loadTs('features/projects/state/use-file-clipboard.ts', { react: runtime.react });
  const { useProjectEntryActions } = await loadTs('features/projects/state/use-project-entry-actions.ts', {
    react: runtime.react,
    'expo-clipboard': { setStringAsync: copy },
    'react-i18next': { useTranslation: () => ({ t }) },
    "@/shared/protocol/opencode/project": { projectPath },
    "@/shared/protocol/opencode/project-entry-operations": { EntryOperationError },
    "@/features/projects/services/project-service": { projectEntryOperations: () => ({ probe: async () => true, inspect, mutate }) }
  });
  const clientA = { __opencode: { directory: '/repo' } }, clientB = { __opencode: { directory: '/worktrees/feature' } };
  let current = true;
  const isCurrentClient = () => current;
  runtime.mount(({ connections }: any) => {
    const clipboard = useFileClipboard(connections);
    const useActions = (client: any, refresh: any) => useProjectEntryActions({ client, refresh, clipboard, connectionId: 'server', enabled: true, isCurrentClient });
    return { clipboard, a: useActions(clientA, refreshA), b: useActions(clientB, refreshB) };
  }, { connections: [connection()] });
  await runtime.value.a.probe(); await runtime.value.b.probe(); runtime.flush();
  return { runtime, inspect, mutate, copy, refreshA, refreshB, stale: () => { current = false; } };
}

describe('connection file clipboard and actions', () => {
  it('keeps one entry per connection and clears only disconnected or reconfigured connections', async () => {
    const runtime = hookRuntime();
    const { useFileClipboard } = await loadTs('features/projects/state/use-file-clipboard.ts', { react: runtime.react });
    runtime.mount(({ connections }: any) => useFileClipboard(connections), { connections: [connection('a'), connection('b')] });
    const entry = { root: '/repo', ...file, mode: 'copy' };
    runtime.value.select('a', entry); runtime.value.select('b', entry); runtime.flush();
    runtime.update({ connections: [connection('a'), connection('b')] });
    expect(runtime.value.entries.a).toEqual(entry);
    runtime.update({ connections: [connection('a', false), connection('b')] });
    expect(runtime.value.entries.a).toBeUndefined(); expect(runtime.value.entries.b).toEqual(entry);
    runtime.update({ connections: [connection('b', true, 'changed')] });
    expect(runtime.value.entries.b).toBeUndefined();
    runtime.unmount();
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
    const { runtime, refreshA, copy } = await mount();
    refreshA.mockRejectedValue(new Error('offline'));
    expect(await runtime.value.a.rename(file, 'renamed.ts')).toBe(true); runtime.flush();
    expect(runtime.value.a.error).toContain('refreshFailed');
    await runtime.value.a.copyPath(file);
    expect(copy).toHaveBeenCalledWith('/repo/src/demo.ts'); runtime.unmount();
  });
});
