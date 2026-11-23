import { afterEach, describe, expect, it, vi } from 'vitest';

import { createConnection, type ConnectionInput } from '@/runtime/connections/create-connection';
import { createConnectionRegistry } from '@/runtime/connections/registry';
import { createAppStore } from '@/runtime/core/store';
import { getConnectionScope } from '@/shared/contracts/connection-scope';
import { createServerQueryClient } from '@/shared/server-data/query-client';

const ports = vi.hoisted(() => ({ probe: vi.fn(), projects: vi.fn(), stream: vi.fn() }));
vi.mock('@/features/connections/runtime', async () => ({
  connectionTransition: (await import('@/features/connections/model/connection-lifecycle')).connectionTransition,
}));
vi.mock('@/features/projects/runtime', () => ({ fetchProjectCatalog: ports.projects }));
vi.mock('@/features/sessions/runtime', () => ({
  sessionCatalogOptions: (identity: ConnectionInput['identity']) => ({
    queryKey: ['opencode', identity.connectionId, identity.connectionScope, identity.authRevision, 'v2', 'sessions', 'catalog'],
    queryFn: async () => ({ sessions: [], statuses: {} }),
  }),
}));
vi.mock('@/shared/observability/client', () => ({ telemetry: { counter: vi.fn(), info: vi.fn(), markStartup: vi.fn(), warn: vi.fn() } }));
vi.mock('@/shared/platform/tls-trust', () => ({}));
vi.mock('@/shared/contracts/cloud-link', () => ({
  getConnectCredentialError: () => undefined,
  getConnectRenewalAt: (expiresAt: string) => new Date(Date.parse(expiresAt) - 5 * 60_000).toISOString(),
}));
vi.mock('@/shared/protocol/opencode/client/types', () => ({ defaultConnectionSettings: { serverUrl: 'http://localhost' } }));
vi.mock('@/shared/protocol/opencode/client', () => ({
  buildClient: (settings: { username: string }) => ({ username: settings.username }),
  detectServerContract: ports.probe,
  classifyConnectionFailure: () => 'unknown',
  getConnectionError: (_url: string, reason: Error) => reason.message,
  isContractMismatchError: () => false,
  isRetryableCloudLinkStartupError: () => false,
}));

vi.mock('@/shared/protocol/opencode/events', () => ({
  async *subscribeEvents(client: unknown, signal: AbortSignal) {
    ports.stream(client, signal);
    if (!signal.aborted) await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }));
  },
}));

afterEach(() => { vi.useRealTimers(); vi.resetAllMocks(); });

describe('connection manager', () => {
  it('defers foreground renewal during pending approval and joins a prepared credential rotation', async () => {
    vi.useFakeTimers();
    const cache = createServerQueryClient();
    const settings = {
      serverUrl: 'http://linked.test', username: 'device-a', password: 'test-a', directory: '',
      connect: { controlPlaneUrl: 'https://control.test', machineId: 'machine', machineName: 'Machine', deviceId: 'device-a', expiresAt: new Date(Date.now() + 301_000).toISOString() },
    };
    const rotated = { ...settings, username: 'device-b', password: 'test-b', connect: { ...settings.connect, deviceId: 'device-b', expiresAt: new Date(Date.now() + 3_600_000).toISOString() } };
    const prepareSettings = vi.fn(async () => rotated);
    ports.probe.mockResolvedValue({ contract: 'v2' });
    ports.projects.mockResolvedValue({});
    const removeForegroundListener = vi.fn();
    const manager = createConnection({ queryClient: cache, foreground: { isActive: () => true, subscribe: () => removeForegroundListener } });
    let stopConnection: (() => void) | undefined;
    let joined: ReturnType<typeof manager.connect> | undefined;
    const input: ConnectionInput = {
      entry: { id: 'machine', enabled: true, revision: 0, name: 'Machine', settings, preferences: {}, projects: [''] },
      identity: { connectionId: 'machine', connectionScope: 'original-scope', authRevision: 0 },
      hydrated: false,
      setup: { phase: 'waitingForApproval', prepareSettings },
      translate: (key) => key,
      updateSettings: vi.fn((_id, preparedSettings) => {
        manager.setInput({ ...input, entry: { ...input.entry, revision: 1, authRevision: 1, settings: preparedSettings } });
        stopConnection?.();
        stopConnection = manager.syncConnection();
        joined = manager.connect();
      }),
    };

    manager.setInput(input);
    stopConnection = manager.syncConnection();
    const stopPausedRenewal = manager.syncRenewal();
    await vi.advanceTimersByTimeAsync(1000);
    expect(prepareSettings).not.toHaveBeenCalled();
    stopPausedRenewal?.();

    input.setup = { phase: 'idle', prepareSettings };
    manager.setInput(input);
    const stopRenewal = manager.syncRenewal();
    await vi.advanceTimersByTimeAsync(1000);
    expect(await joined).toMatchObject({ status: 'connected' });
    expect(prepareSettings).toHaveBeenCalledExactlyOnceWith(settings);
    expect(input.updateSettings).toHaveBeenCalledExactlyOnceWith('machine', rotated);
    expect(ports.probe).toHaveBeenCalledTimes(1);
    expect(ports.projects).toHaveBeenCalledExactlyOnceWith(cache, expect.objectContaining({ authRevision: 1 }), { username: 'device-b' }, true);

    stopRenewal?.();
    stopConnection?.();
    manager.dispose();
    await vi.advanceTimersByTimeAsync(0);
    expect(removeForegroundListener).toHaveBeenCalledTimes(3);
    expect(cache.getQueryData(['opencode', 'machine', getConnectionScope(rotated), 1, 'v2', 'sessions', 'catalog']))
      .toEqual({ sessions: [], statuses: {} });
    cache.clear();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('starts enabled records once, updates the same manager on rotation and disposes disabled and removed records', async () => {
    const settings = { serverUrl: 'http://one.test', username: 'original', password: '', directory: '' };
    const queryClient = createServerQueryClient();
    const store = createAppStore({ settings, chatPreferences: {} as never, controlPlaneUrl: '' });
    const registry = createConnectionRegistry({ store, queryClient });
    const createManager = vi.fn(createConnection);
    ports.probe.mockResolvedValue({ contract: 'v2' });
    ports.projects.mockResolvedValue({});
    const subscribe = vi.fn();
    const detach = registry.subscribe(subscribe);
    registry.configure({
      createManager, setup: { phase: 'idle', prepareSettings: async (input) => input },
      translate: (key) => key, hydrated: true, updateSettings: vi.fn(),
    });
    const a = { id: 'a', name: 'A', enabled: true, settings, projects: [''], preferences: {} };
    const b = { ...a, id: 'b', name: 'B', enabled: false };
    const { setRegistry, setShellValue } = store.getState();
    setRegistry({ connections: [a, b] });
    const first = registry.get('a')!;
    expect(registry.get('b')).toBeUndefined();
    const connecting = registry.getLifecycles();
    expect(connecting.get('a')).toBe(first.getState());
    expect(registry.getLifecycles()).toBe(connecting);
    expect(await first.connect()).toMatchObject({ status: 'connected' });
    expect(registry.getLifecycles()).not.toBe(connecting);
    expect(registry.getLifecycle('a')).toBe(first.getState());
    setShellValue('onboardingActive', true);
    expect(createManager).toHaveBeenCalledTimes(1);
    expect(ports.probe).toHaveBeenCalledTimes(1);
    expect(ports.stream).toHaveBeenCalledTimes(1);
    const initialStream = ports.stream.mock.calls[0][1] as AbortSignal;
    const initialProject = first.getProjectAccess('/repo');
    expect(initialProject?.client).toBe(first.getProjectAccess('/repo')?.client);

    const oldKey = ['opencode', a.id, getConnectionScope(settings), 0, 'v2', 'server', 'projects'];
    queryClient.setQueryData(oldKey, ['old']);
    const rotated = { ...a, revision: 1, authRevision: 1, settings: { ...settings, username: 'rotated' } };
    setRegistry({ connections: [rotated, { ...b, enabled: true }] });
    expect(registry.get('a')).toBe(first);
    expect(registry.get('b')).toBeDefined();
    expect(queryClient.getQueryData(oldKey)).toBeUndefined();
    expect(await first.connect()).toMatchObject({ status: 'connected' });
    expect(createManager).toHaveBeenCalledTimes(2);
    expect(initialStream.aborted).toBe(true);
    expect(initialProject?.isCurrent()).toBe(false);
    expect(first.getProjectAccess('/repo')?.client).not.toBe(initialProject?.client);
    expect(ports.stream.mock.calls.filter(([client]) => client.username === 'rotated')).toHaveLength(1);

    const second = registry.get('b')!;
    setRegistry({ connections: [{ ...rotated, enabled: false }] });
    expect(registry.get('a')).toBeUndefined();
    expect(registry.get('b')).toBeUndefined();
    expect(registry.getLifecycles().size).toBe(0);
    expect(registry.getLifecycle('a').connection.status).toBe('idle');
    expect(first.getState().phase).toBe('disabled');
    expect(second.getState().phase).toBe('disabled');
    expect(subscribe).toHaveBeenCalledTimes(3);
    detach();
    registry.dispose();
    queryClient.clear();
  });
});
