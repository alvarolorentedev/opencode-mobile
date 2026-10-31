import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryObserver } from '@tanstack/react-query';
import { AppState, Platform } from 'react-native';
import { createServerQueryClient, isServerQueryForeground } from '@/providers/queries/client';
import { connectionQueryKey, projectQueryKey, replaceQueryPartition } from '@/providers/queries/keys';
import { createWorkspaceWaiters } from '@/providers/workspace-lifecycle';
import { connectionTransition, type ConnectionLifecycle } from '@/providers/connection-lifecycle';
import { connectTransition, initialConnectLifecycle } from '@/providers/connect/lifecycle';
import { isServerConnectedEvent, serverDataResources } from '@/lib/opencode/server-data-events';

vi.mock('react-native', () => ({ AppState: { currentState: 'active' }, Platform: { OS: 'web' } }));
afterEach(() => vi.useRealTimers());
const identity = { connectionId: 'machine-a', connectionScope: 'server-user-a', authRevision: 0 };
const client = { __opencode: { contract: 'v2' as const, directory: '/repo' } };

describe('server query ownership', () => {
  it('gates a native background launch before AppState effects subscribe', () => {
    try {
      Object.assign(Platform, { OS: 'android' });
      Object.assign(AppState, { currentState: 'background' });
      expect(isServerQueryForeground()).toBe(false);
      Object.assign(AppState, { currentState: 'active' });
      expect(isServerQueryForeground()).toBe(true);
    } finally { Object.assign(Platform, { OS: 'web' }); Object.assign(AppState, { currentState: 'active' }); }
  });
  it('partitions colliding paths by connection, credential generation and protocol without keying credentials', () => {
    const a = projectQueryKey(identity, client, 'directory', 'src');
    const b = projectQueryKey({ ...identity, connectionId: 'machine-b' }, client, 'directory', 'src');
    const rotated = projectQueryKey({ ...identity, authRevision: 1 }, client, 'directory', 'src');
    expect(new Set([a, b, rotated].map((key) => JSON.stringify(key))).size).toBe(3);
    expect(connectionQueryKey(identity, 'v1')).not.toEqual(connectionQueryKey(identity, 'v2'));
  });
  it('renews only the owning partition and preserves timestamps without stale data winning', () => {
    const cache = createServerQueryClient();
    const next = { ...identity, connectionScope: 'renewed-user', authRevision: 1 };
    const other = { ...identity, connectionId: 'machine-b' };
    const key = projectQueryKey(identity, client, 'capabilities');
    cache.setQueryData(key, ['old'], { updatedAt: 123 });
    cache.setQueryData(projectQueryKey(identity, client, 'configuration'), { model: 'old' }, { updatedAt: 123 });
    cache.setQueryData(projectQueryKey(other, client, 'capabilities'), ['other']);
    cache.setQueryData(projectQueryKey(next, client, 'configuration'), { model: 'fresh' }, { updatedAt: 456 });
    replaceQueryPartition(cache, identity, next, true);
    expect(cache.getQueryState(projectQueryKey(next, client, 'capabilities'))?.dataUpdatedAt).toBe(123);
    expect(cache.getQueryData(projectQueryKey(next, client, 'configuration'))).toEqual({ model: 'fresh' });
    expect(cache.getQueryData(projectQueryKey(other, client, 'capabilities'))).toEqual(['other']);
    expect(cache.getQueryData(key)).toBeUndefined();
    replaceQueryPartition(cache, next, { ...next, authRevision: 2 }, false);
    expect(cache.getQueryData(projectQueryKey({ ...next, authRevision: 2 }, client, 'capabilities'))).toBeUndefined();
    cache.clear();
  });
  it('deduplicates simultaneous readers and leaves retry/polling to the transport and workflow', async () => {
    const cache = createServerQueryClient();
    let finish!: (value: string[]) => void;
    const read = vi.fn(() => new Promise<string[]>((resolve) => { finish = resolve; }));
    const options = { queryKey: projectQueryKey(identity, client, 'directory', 'src'), queryFn: read };
    const first = cache.fetchQuery(options), second = cache.fetchQuery(options);
    expect(read).toHaveBeenCalledOnce(); finish(['a.ts']);
    expect(await first).toEqual(await second);
    expect(cache.getDefaultOptions().queries).toMatchObject({ retry: false, refetchInterval: false, refetchOnReconnect: false, refetchOnWindowFocus: false, gcTime: 300_000 });
    cache.clear();
  });
  it('retains no observer for a background workspace and garbage-collects unused results', async () => {
    vi.useFakeTimers();
    const cache = createServerQueryClient();
    const options = { queryKey: projectQueryKey(identity, client, 'directory', 'src'), queryFn: vi.fn(async () => ['a.ts']) };
    const observer = new QueryObserver(cache, { ...options, enabled: false });
    const detach = observer.subscribe(() => {});
    expect(options.queryFn).not.toHaveBeenCalled();
    await cache.fetchQuery(options); detach();
    expect(cache.getQueryCache().find({ queryKey: options.queryKey })!.getObserversCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(300_001);
    expect(cache.getQueryData(options.queryKey)).toBeUndefined(); cache.clear();
  });
  it('aborts obsolete authentication reads and cannot populate the replacement partition', async () => {
    const cache = createServerQueryClient();
    const oldKey = projectQueryKey(identity, client, 'capabilities');
    let signal!: AbortSignal;
    const pending = cache.fetchQuery({ queryKey: oldKey, queryFn: (context) => { signal = context.signal; return new Promise(() => {}); } });
    const cancelled = pending.catch(() => undefined);
    await cache.cancelQueries({ queryKey: connectionQueryKey(identity, 'v2') });
    cache.removeQueries({ queryKey: connectionQueryKey(identity, 'v2') });
    await cancelled;
    expect(signal.aborted).toBe(true);
    expect(cache.getQueryData(projectQueryKey({ ...identity, authRevision: 1 }, client, 'capabilities'))).toBeUndefined(); cache.clear();
  });
});

describe('workspace publication waits', () => {
  it('resolves from a publication with one deadline and no readiness polling', async () => {
    vi.useFakeTimers(); const waiters = createWorkspaceWaiters(); let snapshot: number | undefined;
    const pending = waiters.wait(() => snapshot);
    expect(vi.getTimerCount()).toBe(1);
    snapshot = 1; waiters.notify(); expect(await pending).toBe(1); expect(vi.getTimerCount()).toBe(0);
  });
  it('handles an already committed publication, concurrent waiters, cancellation and teardown', async () => {
    const waiters = createWorkspaceWaiters(); expect(await waiters.wait(() => 1)).toBe(1);
    const controller = new AbortController();
    const cancelled = expect(waiters.wait(() => undefined, controller.signal)).rejects.toThrow('cancelled');
    controller.abort(); await cancelled;
    const first = expect(waiters.wait(() => undefined)).rejects.toThrow('cancelled');
    const second = expect(waiters.wait(() => undefined)).rejects.toThrow('cancelled');
    waiters.dispose(); await Promise.all([first, second]);
  });
  it('rejects a deadline and removes its pending notification', async () => {
    vi.useFakeTimers(); const waiters = createWorkspaceWaiters();
    const result = expect(waiters.wait(() => undefined)).rejects.toThrow('Could not open');
    await vi.advanceTimersByTimeAsync(20_000); await result; waiters.notify(); expect(vi.getTimerCount()).toBe(0);
  });
});

it('rejects late connection settlement and preserves Cloud Link purchase recovery checkpoints', () => {
  const disabled: ConnectionLifecycle = { phase: 'disabled', operation: 2, connection: { status: 'idle', message: 'Disconnected' }, contract: 'v2' };
  expect(connectionTransition(disabled, { type: 'settle', operation: 1, connection: { status: 'connected', message: 'Old request' } })).toBe(disabled);
  const verified = connectTransition(initialConnectLifecycle, { type: 'recovery', checkpoint: 'verified' });
  expect(connectTransition(verified, { type: 'environmentChanged' }).purchaseRecovery).toBe('verified');
  expect(connectTransition(verified, { type: 'failed', message: 'Save failed' })).toMatchObject({ retryable: true, purchaseRecovery: 'verified', phase: 'idle' });
});
it('maps routine events independently from transcript/prompt/terminal reconciliation', () => {
  expect(isServerConnectedEvent({ type: 'compatibility', payload: { type: 'server.connected' } } as never)).toBe(true);
  expect(serverDataResources({ type: 'server.connected' } as never)).toEqual(expect.arrayContaining(['projects', 'location', 'mcp', 'file-status', 'preview']));
  expect(serverDataResources({ type: 'filesystem.changed' } as never)).toContain('directory');
  expect(serverDataResources({ type: 'session.status', data: { sessionID: 's', status: { type: 'idle' } } } as never)).toContain('file-status');
  expect(serverDataResources({ type: 'session.execution.succeeded', data: { sessionID: 's' } } as never)).toContain('file-status');
  expect(serverDataResources({ type: 'credential.updated' } as never)).toContain('capabilities');
  expect(serverDataResources({ type: 'session.text.delta' } as never)).toEqual([]);
  expect(serverDataResources({ type: 'pty.updated' } as never)).toEqual([]);
});
