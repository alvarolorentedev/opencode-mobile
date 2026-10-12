import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { activateConnectProfile } from '@/providers/connect/activation';
import type { AccessDeps } from '@/providers/connect/access';
import type { ConnectionProfile } from '@/lib/connection-profiles';
import type { ConnectionState } from '@/providers/opencode-provider-types';
import { isRetryableCloudLinkStartupError } from '@/lib/opencode/client/errors';

const platform = vi.hoisted(() => ({ state: 'active', listeners: new Set<(state: string) => void>() }));
vi.mock('react-native', () => ({ AppState: {
  get currentState() { return platform.state; },
  addEventListener: (_: string, listener: (state: string) => void) => { platform.listeners.add(listener); return { remove: () => platform.listeners.delete(listener) }; },
} }));
vi.mock('@/lib/connection-profiles', () => ({ getProfilePassword: vi.fn(async () => 'saved-secret') }));
vi.mock('@/lib/opencode/client/types', () => ({ defaultConnectionSettings: { serverUrl: 'http://127.0.0.1:4096' } }));

const profile = { id: 'saved', serverUrl: 'https://machine.test', username: 'device', connect: { machineId: 'machine' } } as ConnectionProfile;
const transient: ConnectionState = { status: 'error', message: '1033', retryableStartup: true };
function fixture() {
  const phases: string[] = [];
  const deps = {
    activation: { current: undefined }, isActiveProfile: vi.fn(() => true),
    setSavedProfile: vi.fn(), setPhase: (phase: string) => phases.push(phase),
    switchConnection: vi.fn<AccessDeps['switchConnection']>(async () => transient),
  };
  return { deps: deps as unknown as AccessDeps, phases, switchConnection: deps.switchConnection, isActiveProfile: deps.isActiveProfile };
}
function appState(state: string) { platform.state = state; platform.listeners.forEach((listener) => listener(state)); }
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0); platform.state = 'active'; platform.listeners.clear(); });
afterEach(() => vi.useRealTimers());

describe('Cloud Link first activation', () => {
  it('keeps waiting beyond 15 seconds and connects with saved credentials', async () => {
    const f = fixture();
    f.switchConnection.mockResolvedValueOnce(transient).mockResolvedValueOnce(transient).mockResolvedValueOnce(transient).mockResolvedValueOnce({ status: 'connected', message: 'Connected' });
    const pending = activateConnectProfile(f.deps, profile, true);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(f.phases).toEqual(['waitingForApproval']);
    expect(f.switchConnection).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(6_000);
    expect(await pending).toBe(true);
    expect(f.phases).toEqual(['waitingForApproval', 'paired']);
    expect(f.deps.activation.current).toBeUndefined();
    expect(f.switchConnection.mock.calls.every(([settings]) => settings.password === 'saved-secret')).toBe(true);
  });

  it('counts request time and mixed transient failures in one 120-second budget', async () => {
    const f = fixture(); const starts: number[] = [];
    f.switchConnection.mockImplementation(async () => {
      starts.push(Date.now());
      const duration = starts.length === 1 ? 90_000 : starts.length === 2 ? 20_000 : 0;
      if (duration) await new Promise((resolve) => setTimeout(resolve, duration));
      return { ...transient, message: ['1033', 'ENOTFOUND', 'ECONNRESET'][starts.length - 1] };
    });
    const pending = activateConnectProfile(f.deps, profile, true);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(await pending).toBe(false);
    expect(starts).toEqual([0, 93_000, 119_000]);
    expect(f.phases).toEqual(['waitingForApproval', 'delayed']);
    expect(f.deps.activation.current?.profile).toBe(profile);
    await vi.advanceTimersByTimeAsync(300_000);
    expect(f.switchConnection).toHaveBeenCalledTimes(3);
  });

  it('retries explicitly using the delayed profile and a fresh budget', async () => {
    const f = fixture(); const first = activateConnectProfile(f.deps, profile, true);
    await vi.advanceTimersByTimeAsync(120_000); expect(await first).toBe(false);
    f.switchConnection.mockResolvedValueOnce({ status: 'connected', message: 'Connected' });
    expect(await activateConnectProfile(f.deps, f.deps.activation.current!.profile, true)).toBe(true);
    expect(f.phases.slice(-2)).toEqual(['waitingForApproval', 'paired']);
  });

  it.each([false, true])('fails immediately for general reconnect/manual activation (manual=%s)', async (manual) => {
    const f = fixture();
    await expect(activateConnectProfile(f.deps, manual ? { ...profile, connect: undefined } : profile, manual)).rejects.toThrow('1033');
    expect(f.switchConnection).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('surfaces permanent errors immediately', async () => {
    const f = fixture(); f.switchConnection.mockResolvedValue({ status: 'error', message: 'Cloud Link credentials were rejected.' });
    await expect(activateConnectProfile(f.deps, profile, true)).rejects.toThrow('credentials');
    expect(f.switchConnection).toHaveBeenCalledTimes(1); expect(f.deps.activation.current).toBeUndefined();
  });

  it('pauses in background and becomes delayed on overdue foreground return', async () => {
    const f = fixture(); const pending = activateConnectProfile(f.deps, profile, true);
    await vi.advanceTimersByTimeAsync(0); appState('background');
    await vi.advanceTimersByTimeAsync(180_000);
    expect(f.switchConnection).toHaveBeenCalledTimes(1); expect(f.phases).toEqual(['waitingForApproval']);
    appState('active'); expect(await pending).toBe(false);
    expect(f.phases.at(-1)).toBe('delayed'); expect(platform.listeners.size).toBe(0);
  });

  it('ignores success after selecting another connection', async () => {
    const f = fixture(); let finish!: (value: typeof transient) => void;
    f.switchConnection.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const pending = activateConnectProfile(f.deps, profile, true); await vi.advanceTimersByTimeAsync(0);
    f.isActiveProfile.mockReturnValue(false); finish({ status: 'connected', message: 'Other connection' });
    expect(await pending).toBe(false); expect(f.phases).toEqual(['waitingForApproval', 'idle']);
  });

  it('cleans up waiting timers and background listeners on teardown', async () => {
    const f = fixture(); const pending = activateConnectProfile(f.deps, profile, true);
    await vi.advanceTimersByTimeAsync(0); appState('background'); await vi.advanceTimersByTimeAsync(3_000);
    f.deps.activation.current!.controller.abort(); expect(await pending).toBe(false);
    expect(vi.getTimerCount()).toBe(0); expect(platform.listeners.size).toBe(0);
    expect(f.phases).toEqual(['waitingForApproval']);
  });

  it('does not start a late activation after its claim scope was disposed', async () => {
    const f = fixture();
    expect(await activateConnectProfile(f.deps, profile, true, () => false)).toBe(false);
    expect(f.switchConnection).not.toHaveBeenCalled(); expect(f.phases).toEqual([]);
    expect(f.deps.activation.current).toBeUndefined();
  });
});

describe('startup failure classification', () => {
  it.each(['Cloudflare Error 1033', 'Unable to resolve host machine.test', 'DNS lookup failed', 'Connection timed out', 'Connection reset by peer', 'NSURLErrorDomain Code=-1003'])('retries %s', (message) => {
    expect(isRetryableCloudLinkStartupError(new Error(message))).toBe(true);
  });
  it.each(['ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT', 'ECONNRESET'])('retains native error code %s through a cause', (code) => {
    expect(isRetryableCloudLinkStartupError(new Error('Fetch failed', { cause: { code } }))).toBe(true);
  });
  it.each(['401 credentials rejected', '403 no active subscription', 'Invalid server URL', 'Unsafe server URL', 'TLS connection timed out', 'SSL certificate error', 'CERT_HAS_EXPIRED', 'ERR_SSL_PROTOCOL_ERROR ECONNRESET', 'DEPTH_ZERO_SELF_SIGNED_CERT ETIMEDOUT', 'Failed to fetch', 'Network request failed'])('does not retry %s', (message) => {
    expect(isRetryableCloudLinkStartupError(new Error(message))).toBe(false);
  });
  it('handles V1 HTML strings and gives certificate/auth failures precedence over nested transient errors', () => {
    expect(isRetryableCloudLinkStartupError('<html>Cloudflare Error 1033</html>')).toBe(true);
    expect(isRetryableCloudLinkStartupError({ status: 403, message: '1033' })).toBe(false);
    expect(isRetryableCloudLinkStartupError(new Error('ETIMEDOUT', { cause: new Error('certificate expired') }))).toBe(false);
    expect(isRetryableCloudLinkStartupError({ domain: 'NSURLErrorDomain', code: -1003 })).toBe(true);
    expect(isRetryableCloudLinkStartupError({ domain: 'NSURLErrorDomain', code: -1200, cause: { code: 'ECONNRESET' } })).toBe(false);
    const cyclic = { cause: {} }; cyclic.cause = cyclic;
    expect(isRetryableCloudLinkStartupError(cyclic)).toBe(false);
  });
});
