import { describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { loadTs, deferred } from '../../../tests/helpers/runtime.mjs';

function privateReference(scope: string) { return `activity-sha256:${createHash('sha256').update(scope).digest('hex')}`; }
async function platform(os = 'ios', extra: Record<string, unknown> = { iosLiveActivities: true }, environment = 'standalone', scheme: string | string[] = ['opencodemobile-activities', 'opencodemobile']) {
  const native = { update: vi.fn().mockResolvedValue(true), stop: vi.fn().mockResolvedValue(undefined), suppressesCompletion: vi.fn().mockReturnValue(false) };
  const requireNative = vi.fn(() => native);
  const reference = vi.fn(async (scope: string) => privateReference(scope));
  const api = await loadTs('shared/platform/activity-notifications.ts', {
    expo: { requireOptionalNativeModule: requireNative },
    'expo-constants': { __esModule: true, default: { executionEnvironment: environment, expoConfig: { extra, scheme } } },
    'react-native': { Platform: { OS: os } },
    '@/shared/i18n/index': { i18n: { t: (key: string, args?: any) => args?.count ? `${args.count} tasks` : key } },
    '@/shared/platform/private-connection-reference': { privateConnectionReference: reference },
  });
  return { api, native, requireNative, reference };
}
const task = { sessionId: 'session/one', projectPath: '/repo', connectionScope: 'scope', title: 'PRIVATE TITLE', action: 'SECRET TOOL', key: 'PRIVATE KEY', count: 1, active: true, phase: 'thinking' };

describe('iOS Live Activity boundary', () => {
  it('requires explicit iOS opt-in outside Expo Go and E2E, without changing Android gating', async () => {
    for (const [os, extra, environment] of [
      ['ios', {}, 'standalone'], ['ios', { iosLiveActivities: 'true' }, 'standalone'],
      ['ios', { iosLiveActivities: true }, 'storeClient'],
      ['ios', { iosLiveActivities: true, e2eMode: true }, 'standalone'],
      ['web', { iosLiveActivities: true }, 'standalone'],
    ] as const) {
      const { api, requireNative } = await platform(os, extra, environment);
      expect(api.activityNotifications).toBeNull(); expect(requireNative).not.toHaveBeenCalled();
    }
    expect((await platform()).requireNative).toHaveBeenCalledWith('OpencodeActivity');
    expect((await platform('android', {})).requireNative).toHaveBeenCalledWith('OpencodeActivity');
  });

  it('emits only generic localized content, bounded counts, an opaque key and the canonical route', async () => {
    const { api, native, reference } = await platform();
    const serverUrl = 'https://private.example';
    const connectionScope = Buffer.from(`${serverUrl}\nalice`).toString('base64url');
    await api.updateActivityNotification({ ...task, connectionScope, phase: 'PRIVATE PHASE', count: Infinity, agentCount: -3, toolCount: 1e20,
      serverUrl: 'https://SECRET', password: 'SECRET PASSWORD' });
    const content = native.update.mock.calls.at(-1)![0];
    expect(content).toMatchObject({ title: 'OpenCode', body: 'notifications:activity.thinking', phase: 'thinking', count: 1, agentCount: 0, toolCount: 9999 });
    expect(JSON.stringify(content)).not.toMatch(/PRIVATE|SECRET/);
    expect(JSON.stringify(content)).not.toContain(serverUrl);
    expect(JSON.stringify(content)).not.toContain(connectionScope);
    expect(reference).toHaveBeenCalledWith(connectionScope);
    expect(content.link).toMatch(/^opencodemobile-activities:\/\/session\//);
    expect(new URL(content.link).searchParams.get('connectionScope')).toBe(privateReference(connectionScope));
    expect(new URL(content.link).pathname).toBe('/session%2Fone');
    expect(new URL(content.link).searchParams.get('project')).toBe('/repo');
    expect(Object.keys(content).sort()).toEqual(['active', 'agentCount', 'agentsLabel', 'body', 'channelLabel', 'chip', 'count', 'elapsedLabel', 'key', 'link', 'pausedLabel', 'phase', 'stopLabel', 'title', 'toolCount', 'toolsLabel', 'updatedLabel', 'workKeys'].sort());
    expect(api.isActivityCompletionManaged(connectionScope)).toBe(false);
    native.suppressesCompletion.mockReturnValue(true);
    expect(api.isActivityCompletionManaged(connectionScope)).toBe(false);
  });

  it('never falls back to a private identity when hashing fails and keeps later writes usable', async () => {
    const { api, native, reference } = await platform();
    reference.mockRejectedValueOnce(new Error('hash unavailable'));
    await expect(api.updateActivityNotification(task)).rejects.toThrow('hash unavailable');
    expect(native.update).not.toHaveBeenCalled();
    await api.updateActivityNotification(task);
    expect(new URL(native.update.mock.calls.at(-1)![0].link).searchParams.get('connectionScope')).toBe(privateReference(task.connectionScope));
  });

  it('keeps scoped work identities stable across polling, legacy key changes and JS restarts', async () => {
    const first = await platform();
    const serverUrl = 'https://private.example';
    const connectionScope = Buffer.from(`${serverUrl}\nalice`).toString('base64url');
    const input = { ...task, connectionScope, key: `${serverUrl}:${connectionScope}:generation-1`, work: [{ sessionId: task.sessionId, runId: 'private-prompt-1' }] };
    await first.api.updateActivityNotification(input);
    const initialKey = first.native.update.mock.calls.at(-1)![0].key;
    const initialWork = first.native.update.mock.calls.at(-1)![0].workKeys;
    expect(initialKey).toBe('activity-aggregate');
    expect(initialWork).toEqual([expect.stringMatching(/^[a-f0-9]{64}:[a-f0-9]{64}$/)]);
    expect(initialKey).not.toContain(serverUrl);
    expect(initialKey).not.toContain(connectionScope);
    expect(initialKey).not.toContain(input.key);
    await first.api.updateActivityNotification({ ...input, phase: 'needsInput' });
    expect(first.native.update.mock.calls.at(-1)![0].key).toBe(initialKey);
    await first.api.updateActivityNotification({ ...input, key: `${input.key}:generation-2` });
    const nextKey = first.native.update.mock.calls.at(-1)![0].key;
    expect(nextKey).toBe(initialKey);
    expect(first.native.update.mock.calls.at(-1)![0].workKeys).toEqual(initialWork);
    const relaunched = await platform();
    await relaunched.api.updateActivityNotification(input);
    expect(relaunched.native.update.mock.calls.at(-1)![0]).toMatchObject({ key: initialKey, workKeys: initialWork });
    expect(JSON.stringify(relaunched.native.update.mock.calls.at(-1)![0])).not.toContain('private-prompt');
  });

  it('keeps aggregate keys stable as unchanged A/B observers alternate and includes every active root', async () => {
    const { api, native } = await platform();
    const a = { ...task, work: [{ sessionId: 'same', runId: 'run-a' }, { sessionId: 'another' }] };
    const b = { ...task, connectionScope: 'other', work: [{ sessionId: 'same', runId: 'run-b' }] };
    await api.updateActivityNotification(a); await api.updateActivityNotification(b);
    const combined = native.update.mock.calls.at(-1)![0];
    expect(combined.workKeys).toHaveLength(3);
    await api.updateActivityNotification(a); await api.updateActivityNotification(b);
    for (const [content] of native.update.mock.calls.slice(1)) {
      expect(content).toMatchObject({ key: combined.key, workKeys: combined.workKeys });
    }
    await api.stopActivityNotification('other');
    expect(native.update.mock.calls.at(-1)![0].workKeys).toHaveLength(2);
    expect(native.update.mock.calls.at(-1)![0].key).toBe(combined.key);
  });

  it('promotes unknown anchors without changing task hashes and distinguishes new runs and new roots', async () => {
    const { api, native } = await platform();
    await api.updateActivityNotification(task);
    const unknown = native.update.mock.calls.at(-1)![0].workKeys[0];
    await api.updateActivityNotification({ ...task, work: [{ sessionId: task.sessionId, runId: 'prompt-1' }] });
    const known = native.update.mock.calls.at(-1)![0].workKeys[0];
    expect(known.split(':')[0]).toBe(unknown);
    await api.updateActivityNotification({ ...task, work: [{ sessionId: task.sessionId, runId: 'prompt-2' }] });
    const next = native.update.mock.calls.at(-1)![0].workKeys[0];
    expect(next.split(':')[0]).toBe(unknown); expect(next).not.toBe(known);
    await api.updateActivityNotification({ ...task, sessionId: 'new-root' });
    expect(native.update.mock.calls.at(-1)![0].workKeys[0]).not.toBe(unknown);
  });

  it('does not hash or alter the legacy Android route', async () => {
    const { api, native, reference } = await platform('android');
    await api.updateActivityNotification(task);
    expect(reference).not.toHaveBeenCalled();
    expect(new URL(native.update.mock.calls.at(-1)![0].link).protocol).toBe('opencodemobile:');
    expect(new URL(native.update.mock.calls.at(-1)![0].link).searchParams.get('connectionScope')).toBe(task.connectionScope);
  });

  it('uses a configured iOS string scheme or the original default when none is configured', async () => {
    for (const [scheme, expected] of [['opencode-local-test', 'opencode-local-test'], [[], 'opencodemobile']] as const) {
      const { api, native } = await platform('ios', { iosLiveActivities: true }, 'standalone', typeof scheme === 'string' ? scheme : [...scheme]);
      await api.updateActivityNotification(task);
      const link = new URL(native.update.mock.calls.at(-1)![0].link);
      expect(link.protocol).toBe(`${expected}:`);
      expect(link.searchParams.get('connectionScope')).toBe(privateReference(task.connectionScope));
    }
  });

  it('surfaces blockers across scopes, aggregates counts, and cleans up only the released scope', async () => {
    const { api, native } = await platform();
    await api.updateActivityNotification({ ...task, phase: 'needsInput', count: 2.8, agentCount: 2, toolCount: 1 });
    const key = native.update.mock.calls.at(-1)![0].key;
    await api.updateActivityNotification({ ...task, connectionScope: 'other', count: 3, agentCount: 1, toolCount: 2 });
    expect(native.update.mock.calls.at(-1)![0]).toMatchObject({ phase: 'needsInput', count: 5, chip: '5 tasks', agentCount: 3, toolCount: 3, key });
    await api.stopActivityNotification('scope');
    expect(native.stop).not.toHaveBeenCalled();
    expect(native.update.mock.calls.at(-1)![0]).toMatchObject({ phase: 'thinking', count: 3 });
    expect(new URL(native.update.mock.calls.at(-1)![0].link).searchParams.get('connectionScope')).toBe(privateReference('other'));
    await api.stopActivityNotification('other'); expect(native.stop).toHaveBeenCalledTimes(1);
  });

  it('keeps every known terminal or active phase localized and resets terminal counters', async () => {
    const { api, native } = await platform();
    for (const phase of ['thinking', 'reading', 'editing', 'searching', 'executing', 'delegating', 'needsInput', 'retrying', 'queued', 'reconnecting', 'finished', 'failed', 'stopped']) {
      const active = !['finished', 'failed', 'stopped'].includes(phase);
      if (!active) await api.updateActivityNotification(task);
      await api.updateActivityNotification({ ...task, phase, active, count: 2, agentCount: 3, toolCount: 4 });
      expect(native.update.mock.calls.at(-1)![0]).toMatchObject({ body: `notifications:activity.${phase}`, phase,
        count: active ? 2 : 0, agentCount: active ? 3 : 0, toolCount: active ? 4 : 0 });
    }
  });

  it.each(['finished', 'failed', 'stopped'])('uses the localized %s terminal chip instead of Working', async (phase) => {
    const { api, native } = await platform();
    await api.updateActivityNotification(task);
    await api.updateActivityNotification({ ...task, phase, active: false, count: 0 });
    const content = native.update.mock.calls.at(-1)![0];
    expect(content).toMatchObject({ active: false, count: 0, phase, chip: `notifications:activity.${phase}`, body: `notifications:activity.${phase}` });
    expect(JSON.stringify(content)).not.toMatch(/PRIVATE|SECRET/);
  });

  it('emits confirmed numeric progress and localized generic labels, including terminal retention', async () => {
    const { api, native } = await platform();
    await api.updateActivityNotification({ ...task, phase: 'editing', progress: { completed: 1, total: 3, private: 'SECRET' }, filesChanged: 2 });
    expect(native.update.mock.calls.at(-1)![0]).toMatchObject({ phase: 'editing', completedSteps: 1, totalSteps: 3, filesChanged: 2,
      progressLabel: 'notifications:activity.progressLabel', filesLabel: '2 tasks', pausedLabel: 'notifications:activity.updatesPaused',
      updatedLabel: 'notifications:activity.updatedLabel', elapsedLabel: 'notifications:activity.elapsedLabel' });
    expect(JSON.stringify(native.update.mock.calls.at(-1)![0])).not.toMatch(/SECRET|PRIVATE/);
    await api.updateActivityNotification({ ...task, active: false, phase: 'failed', progress: { completed: 1, total: 3 } });
    expect(native.update.mock.calls.at(-1)![0]).toMatchObject({ phase: 'failed', completedSteps: 1, totalSteps: 3 });
  });

  it('aggregates progress and counts only when every active scope knows the metric', async () => {
    const { api, native } = await platform();
    await api.updateActivityNotification({ ...task, progress: { completed: 1, total: 2 }, agentCount: 2, toolCount: 1, filesChanged: 1 });
    await api.updateActivityNotification({ ...task, connectionScope: 'other' });
    for (const key of ['completedSteps', 'totalSteps', 'progressLabel', 'agentCount', 'toolCount', 'filesChanged']) {
      expect(native.update.mock.calls.at(-1)![0]).not.toHaveProperty(key);
    }
    await api.updateActivityNotification({ ...task, connectionScope: 'other', phase: 'needsInput', progress: { completed: 2, total: 3 },
      agentCount: 1, toolCount: 2, filesChanged: 2 });
    expect(native.update.mock.calls.at(-1)![0]).toMatchObject({ phase: 'needsInput', completedSteps: 3, totalSteps: 5, agentCount: 3, toolCount: 3, filesChanged: 3 });
    await api.stopActivityNotification('other');
    expect(native.update.mock.calls.at(-1)![0]).toMatchObject({ completedSteps: 1, totalSteps: 2 });
  });

  it.each([
    undefined, { completed: 0, total: 0 }, { completed: -1, total: 2 }, { completed: 3, total: 2 },
    { completed: NaN, total: 2 }, { completed: 1, total: Infinity }, { completed: 0.5, total: 2 },
    { completed: 1, total: 1.5 }, { completed: 1, total: 10000 },
  ])('omits unknown or invalid progress rather than displaying an invented indicator: %j', async (progress) => {
    const { api, native } = await platform();
    await api.updateActivityNotification({ ...task, progress });
    for (const key of ['completedSteps', 'totalSteps', 'progressLabel']) expect(native.update.mock.calls.at(-1)![0]).not.toHaveProperty(key);
  });

  it('accepts factual zero completed and omits an aggregate plan exceeding the numeric budget', async () => {
    const { api, native } = await platform();
    await api.updateActivityNotification({ ...task, progress: { completed: 0, total: 9999 }, agentCount: 9999, toolCount: 9999 });
    expect(native.update.mock.calls.at(-1)![0]).toMatchObject({ completedSteps: 0, totalSteps: 9999 });
    await api.updateActivityNotification({ ...task, connectionScope: 'other', progress: { completed: 0, total: 1 }, agentCount: 1, toolCount: 1 });
    expect(native.update.mock.calls.at(-1)![0]).toMatchObject({ agentCount: 9999, toolCount: 9999 });
    expect(native.update.mock.calls.at(-1)![0]).not.toHaveProperty('totalSteps');
  });

  it('omits overall metrics while another registered scope is unread, failed, or stale', async () => {
    const { api, native } = await platform();
    api.registerActivityNotificationScope('scope'); api.registerActivityNotificationScope('other');
    api.markActivityNotificationScopeReady('scope', () => true);
    const known = { ...task, progress: { completed: 1, total: 2 }, agentCount: 1, toolCount: 1 };
    await api.updateActivityNotification(known);
    expect(native.update.mock.calls.at(-1)![0]).not.toHaveProperty('totalSteps');
    expect(native.update.mock.calls.at(-1)![0]).not.toHaveProperty('agentCount');
    api.markActivityNotificationScopeReady('other'); await api.updateActivityNotification(known);
    expect(native.update.mock.calls.at(-1)![0]).not.toHaveProperty('totalSteps');
    api.markActivityNotificationScopeReady('other', () => true); await api.updateActivityNotification(known);
    expect(native.update.mock.calls.at(-1)![0]).toMatchObject({ completedSteps: 1, totalSteps: 2, agentCount: 1 });
    api.markActivityNotificationScopeReady('other', () => false); await api.updateActivityNotification(known);
    expect(native.update.mock.calls.at(-1)![0]).not.toHaveProperty('totalSteps');
  });

  it('omits nonfinite optional counts rather than converting unknown values to zero', async () => {
    const { api, native } = await platform();
    await api.updateActivityNotification({ ...task, agentCount: Infinity, toolCount: NaN, filesChanged: Infinity });
    for (const key of ['agentCount', 'toolCount', 'filesChanged', 'agentsLabel', 'toolsLabel', 'filesLabel']) {
      expect(native.update.mock.calls.at(-1)![0]).not.toHaveProperty(key);
    }
  });

  it('serializes updates and cleanup without stopping another active connection', async () => {
    const { api, native } = await platform();
    const gate = deferred(); native.update.mockImplementationOnce(() => gate.promise);
    const first = api.updateActivityNotification(task);
    for (let turn = 0; turn < 30; turn++) await Promise.resolve();
    const second = api.updateActivityNotification({ ...task, connectionScope: 'other' });
    const cleanup = api.stopActivityNotification('scope');
    expect(native.update).toHaveBeenCalledTimes(1);
    gate.resolve(true); await Promise.all([first, second, cleanup]);
    expect(native.stop).not.toHaveBeenCalled();
    expect(new URL(native.update.mock.calls.at(-1)![0].link).searchParams.get('connectionScope')).toBe(privateReference('other'));
  });

  it('waits for all registered scope owners to verify idle before stopping a restored activity', async () => {
    const { api, native } = await platform();
    const releaseA = api.registerActivityNotificationScope('scope');
    const releaseB = api.registerActivityNotificationScope('other');
    api.markActivityNotificationScopeReady('scope', () => true);
    await api.stopActivityNotification('scope'); expect(native.stop).not.toHaveBeenCalled();
    // A failed/unread B remains unknown, even when A verifies idle again.
    api.markActivityNotificationScopeReady('other');
    await api.stopActivityNotification('scope'); expect(native.stop).not.toHaveBeenCalled();
    api.markActivityNotificationScopeReady('other', () => true);
    await api.stopActivityNotification('other'); expect(native.stop).toHaveBeenCalledOnce();
    await api.stopActivityNotification('scope'); expect(native.stop).toHaveBeenCalledOnce();
    await releaseA(); await releaseB();
  });

  it('does not stop another active connection when a registered owner verifies idle or is released', async () => {
    const { api, native } = await platform();
    const releaseA = api.registerActivityNotificationScope('scope');
    const releaseB = api.registerActivityNotificationScope('other');
    api.markActivityNotificationScopeReady('other', () => true);
    await api.updateActivityNotification({ ...task, connectionScope: 'other' });
    api.markActivityNotificationScopeReady('scope', () => true);
    await api.stopActivityNotification('scope'); await releaseA();
    expect(native.stop).not.toHaveBeenCalled();
    expect(new URL(native.update.mock.calls.at(-1)![0].link).searchParams.get('connectionScope')).toBe(privateReference('other'));
    await releaseB(); expect(native.stop).toHaveBeenCalledOnce();
  });

  it('retains a terminal result through subsequent idle polls and waits on stale owner readiness', async () => {
    const { api, native } = await platform();
    api.registerActivityNotificationScope('scope');
    api.markActivityNotificationScopeReady('scope', () => true);
    await api.updateActivityNotification(task);
    api.markActivityNotificationScopeReady('scope', () => false);
    await api.updateActivityNotification({ ...task, active: false, phase: 'finished' });
    expect(native.update).toHaveBeenCalledOnce();
    api.markActivityNotificationScopeReady('scope', () => true);
    await api.updateActivityNotification({ ...task, active: false, phase: 'finished' });
    expect(native.update.mock.calls.at(-1)![0]).toMatchObject({ active: false, phase: 'finished', workKeys: [] });
    await api.stopActivityNotification('scope'); expect(native.stop).not.toHaveBeenCalled();
  });

  it.each([0, 1, 2])('rejects an old observation after a lifecycle epoch changes during digest %i', async (delayedDigest) => {
    const { api, native, reference } = await platform();
    let epoch = 0; const submitted = epoch; const digest = deferred();
    let call = 0;
    reference.mockImplementation((value: string) => call++ === delayedDigest ? digest.promise as Promise<string> : Promise.resolve(privateReference(value)));
    const first = api.updateActivityNotification({ ...task, work: [{ sessionId: task.sessionId, runId: 'run' }], isCurrent: () => epoch === submitted });
    for (let turn = 0; turn < 30; turn++) await Promise.resolve();
    epoch++; epoch++; // background then foreground; the old predicate stays invalid.
    digest.resolve(privateReference('deferred'));
    await expect(first).resolves.toBe(false); expect(native.update).not.toHaveBeenCalled();
    await api.updateActivityNotification({ ...task, isCurrent: () => epoch === 2 });
    expect(native.update).toHaveBeenCalledOnce();
    expect(native.update.mock.calls[0][0]).not.toHaveProperty('isCurrent');
  });

  it('rejects queued stale submissions before hashing and never lets a released owner publish late', async () => {
    const { api, native, reference } = await platform();
    const release = api.registerActivityNotificationScope('scope');
    let current = true;
    const pending = api.updateActivityNotification({ ...task, isCurrent: () => current });
    current = false; await expect(pending).resolves.toBe(false);
    expect(reference).not.toHaveBeenCalled(); expect(native.update).not.toHaveBeenCalled();
    const gate = deferred(); reference.mockImplementationOnce(() => gate.promise as Promise<string>);
    current = true;
    const old = api.updateActivityNotification({ ...task, isCurrent: () => current });
    for (let turn = 0; turn < 10; turn++) await Promise.resolve();
    current = false; const cleanup = release();
    gate.resolve(privateReference('scope'));
    await Promise.all([old, cleanup]);
    expect(native.update).not.toHaveBeenCalled(); expect(native.stop).toHaveBeenCalledOnce();
  });

  it('never registers an iOS headless keepalive, while preserving Android registration', async () => {
    for (const os of ['ios', 'android']) {
      const register = vi.fn(); const waitUntilStopped = vi.fn().mockResolvedValue(undefined);
      await loadTs('features/notifications/background.ts', {
        'react-native': { Platform: { OS: os }, AppRegistry: { registerHeadlessTask: register } },
        '@/shared/platform/activity-notifications': { activityNotifications: { waitUntilStopped } },
      });
      expect(register).toHaveBeenCalledTimes(os === 'android' ? 1 : 0);
      if (os === 'android') { await register.mock.calls[0][1]()(); expect(waitUntilStopped).toHaveBeenCalledOnce(); }
    }
  });
});
