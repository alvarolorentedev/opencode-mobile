import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hookRuntime, deferred } from '../helpers/runtime.mjs';
import { getSessionActivities, selectDisplayedActivity, type ActivitySnapshot } from '@/providers/activity-notification-state';
import { useActivityNotifications } from '@/providers/use-activity-notifications';
import { readActivitySnapshot } from '@/providers/services/activity-service';

const h = vi.hoisted(() => ({
  runtime: undefined as any, listener: undefined as any, appState: 'active',
  snapshot: undefined as any, granted: true, updates: [] as any[], dismissed: undefined as string | undefined,
  scope: undefined as string | undefined, tracked: [] as any[], cleared: [] as any[],
  attention: [] as any[], resolved: [] as string[],
  read: vi.fn(), stop: vi.fn(), build: vi.fn(),
}));
vi.mock('react', () => Object.fromEntries(['useRef', 'useLayoutEffect', 'useEffect', 'useCallback'].map((key) => [key, (...args: any[]) => h.runtime.react[key](...args)])));
vi.mock('react-native', () => ({ AppState: {
  get currentState() { return h.appState; },
  addEventListener: (_: string, listener: any) => { h.listener = listener; return { remove() { h.listener = undefined; } }; },
} }));
vi.mock('expo-notifications', () => ({ getPermissionsAsync: async () => ({ granted: h.granted }) }));
vi.mock('@/lib/activity-notifications', () => ({
  activityNotifications: { stop: () => h.stop() },
  stopActivityNotification: () => { h.scope = undefined; return h.stop(); },
  updateActivityNotification: async (input: any) => { h.updates.push(input); return input.key !== h.dismissed; },
}));
vi.mock('@/lib/i18n', () => ({ i18n: { t: (key: string) => key } }));
vi.mock('@/lib/notifications', () => ({
  trackPendingTaskFinishedNotification: async (input: any) => { h.tracked.push(input); return input; },
  clearPendingTaskFinishedNotification: async (...args: any[]) => { h.cleared.push(args); },
  raisePendingAttention: async (_scope: string, sessionId: string, key: string) => { h.attention.push({ sessionId, key }); return true; },
  clearPendingAttention: async (_scope: string, sessionId: string) => { h.resolved.push(sessionId); return true; },
}));
vi.mock('@/lib/opencode/client', () => ({ buildClient: (...args: any[]) => h.build(...args) }));
vi.mock('@/providers/services/session-service', () => ({
  listActiveSessions: (...args: any[]) => h.read(...args),
  getSessionMessages: async (client: any, id: string) => ({ records: await client.messages(id) }),
}));

function session(id: string, parentID?: string, directory = '/repo') {
  return { id, parentID, directory, title: id, time: { created: 1, updated: id === 'new' ? 10 : 2 } } as any;
}
function snapshot(ids = ['one']): ActivitySnapshot {
  return { sessions: ids.map((id) => session(id)), statuses: Object.fromEntries(ids.map((id) => [id, { type: 'busy' }])), blocked: new Set(), queued: new Set(), messages: {} };
}
function assistant(error?: string, parts: any[] = []) {
  return { info: { id: 'message', role: 'assistant', time: { created: 2 }, ...(error ? { error: { name: error, data: {} } } : {}) }, parts } as any;
}
function props() {
  return { catalogClient: {} as any, settings: { serverUrl: 'https://server', username: '', password: '', directory: '' },
    contract: 'v2' as const, connectionScope: 'scope', connected: true, currentSessionId: 'one', sessions: [session('one')], sendingState: { active: false }, streamConnectedRef: { current: true } };
}

beforeEach(() => {
  h.runtime = hookRuntime(); h.appState = 'active'; h.granted = true; h.dismissed = undefined;
  h.updates = []; h.tracked = []; h.cleared = []; h.attention = []; h.resolved = []; h.stop.mockReset().mockResolvedValue(undefined); h.build.mockReset();
  h.snapshot = snapshot(); h.read.mockReset();
  for (const [key, value] of Object.entries(h.runtime.globals)) vi.stubGlobal(key, value);
});
afterEach(() => { h.runtime.unmount(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('activity selection', () => {
  it('combines descendant activity into roots and prioritizes blockers over the current chat', () => {
    const state = snapshot(['one', 'new', 'child', 'grandchild', 'archived']);
    state.sessions[2].parentID = 'new'; state.sessions[3].parentID = 'child'; state.sessions[4].time.archived = 1;
    state.statuses.new = { type: 'idle' }; state.blocked.add('grandchild');
    const activities = getSessionActivities(state);
    expect(activities.filter((activity) => activity.active)).toHaveLength(2);
    expect(selectDisplayedActivity(activities, 'one')?.session.id).toBe('new');
    expect(selectDisplayedActivity(activities, 'one')?.state).toBe('needsInput');
  });

  it('keeps retries and queued prompts active and distinguishes aborts from failures', () => {
    const state = snapshot(['one', 'new']);
    state.statuses.one = { type: 'retry', attempt: 1, message: 'Retry', next: 5 };
    state.statuses.new = { type: 'idle' }; state.queued.add('new');
    expect(getSessionActivities(state).map((activity) => activity.state)).toEqual(['retrying', 'queued']);
    state.statuses.one = { type: 'idle' }; state.queued.clear();
    state.messages.one = [assistant('MessageAbortedError')]; state.messages.new = [assistant('APIError')];
    expect(getSessionActivities(state).map((activity) => activity.state)).toEqual(['stopped', 'failed']);
  });

  it('uses running tools and never exposes tool output', () => {
    const state = snapshot();
    state.messages.one = [assistant(undefined, [{ type: 'tool', tool: 'read', state: { status: 'running', title: 'Reading files', output: 'private output' } }])];
    expect(getSessionActivities(state)[0].tool).toBe('Reading files');
    expect(JSON.stringify(getSessionActivities(state))).not.toContain('private output');
  });
});

describe('provider observer', () => {
  async function mount() {
    // Exercise the actual service too, with deterministic SDK clients.
    h.read.mockImplementation(async () => ({ sessions: h.snapshot.sessions, statuses: h.snapshot.statuses }));
    h.build.mockImplementation(() => ({
      __opencode: { contract: 'v2', directory: '/repo' },
      api: { permission: { request: { list: async () => ({ data: [...h.snapshot.blocked].map((sessionID) => ({ id: `permission-${sessionID}`, sessionID, action: 'edit', resources: [], save: [] })) }) } }, form: { list: async () => ({ data: [] }) } },
      messages: async (id: string) => h.snapshot.messages[id] ?? [],
      promptInbox: { list: async (id: string) => h.snapshot.queued.has(id) ? [{ id: 'queued' }] : [] },
    }));
    h.runtime.mount(useActivityNotifications, props());
    await h.runtime.settle();
  }
  async function poll() { h.runtime.fire(5000); await h.runtime.settle(); }

  it('tracks all server tasks, continues while locked, and publishes one silent result', async () => {
    h.snapshot = snapshot(['one', 'new']); h.snapshot.sessions[1].directory = '/another-project';
    await mount();
    expect(h.updates.at(-1).count).toBe(2); expect(h.tracked).toHaveLength(2);
    h.appState = 'background'; h.listener('background');
    await poll(); expect(h.updates.at(-1).active).toBe(true);
    h.snapshot.statuses.one = { type: 'idle' }; await poll();
    expect(h.updates.at(-1).sessionId).toBe('new'); expect(h.updates.at(-1).count).toBe(1);
    h.snapshot.statuses.new = { type: 'idle' }; await poll();
    expect(h.updates.at(-1)).toMatchObject({ active: false, action: 'notifications:activity.finished', projectPath: '/another-project' });
    expect(h.cleared).toHaveLength(2); expect(h.runtime.countTimers(5000)).toBe(0);
    expect(h.runtime.countTimers(20000)).toBe(0);
    h.appState = 'active'; h.listener('active'); await h.runtime.settle();
    expect(h.runtime.countTimers(20000)).toBe(1);
    h.runtime.unmount(); expect(h.stop).toHaveBeenCalled(); expect(h.scope).toBeUndefined();
  });

  it('does not process attention events for a non-owning workspace observer', async () => {
    await mount();
    h.runtime.update({ connected: false }); await h.runtime.settle();
    h.appState = 'background';
    h.runtime.value({ type: 'permission.asked', data: { sessionID: 'one' } });
    await h.runtime.settle();
    expect(h.attention).toHaveLength(0);
  });

  it('retains work on failed reads and reconciles global events outside the selected project', async () => {
    await mount();
    h.read.mockRejectedValueOnce(new Error('offline'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await poll();
    expect(h.updates.at(-1)).toMatchObject({ active: true, action: 'notifications:activity.reconnecting' });
    expect(h.cleared).toHaveLength(0);
    h.snapshot.blocked.add('one');
    h.runtime.value({ type: 'question.asked' }); h.runtime.fire(250); await h.runtime.settle();
    expect(h.updates.at(-1).action).toBe('notifications:activity.needsInput');
    warn.mockRestore(); h.runtime.unmount();
  });

  it('does not post without permission and resumes when permission changes on foreground', async () => {
    h.granted = false; await mount();
    expect(h.updates).toHaveLength(0); expect(h.read).not.toHaveBeenCalled();
    h.granted = true; h.listener('active'); await h.runtime.settle();
    expect(h.updates.at(-1).active).toBe(true); h.runtime.unmount();
  });

  it('preserves event-only retries until a terminal event clears them', async () => {
    await mount();
    h.snapshot.statuses.one = { type: 'idle' };
    h.runtime.value({ type: 'session.retry.scheduled', data: { sessionID: 'one', attempt: 1, error: { message: 'Retry' }, at: Date.now() + 60000 } });
    h.runtime.fire(250); await h.runtime.settle();
    expect(h.updates.at(-1)).toMatchObject({ active: true, action: 'notifications:activity.retrying' });
    expect(h.cleared).toHaveLength(0);
    h.runtime.value({ type: 'session.execution.succeeded', data: { sessionID: 'one' } });
    h.runtime.fire(250); await h.runtime.settle();
    expect(h.updates.at(-1).active).toBe(false);
  });

  it('starts local work before a slow catalog read and reports submission failure', async () => {
    await mount();
    h.snapshot.statuses.one = { type: 'idle' }; await poll();
    const slow = deferred(); h.read.mockImplementationOnce(() => slow.promise);
    h.runtime.update({ sendingState: { active: true, sessionId: 'one' } }); await h.runtime.settle();
    expect(h.updates.at(-1).active).toBe(true);
    h.runtime.update({ sendingState: { active: false }, promptError: { sessionId: 'one', occurredAt: Date.now() } });
    slow.resolve({ sessions: h.snapshot.sessions, statuses: h.snapshot.statuses }); await h.runtime.settle();
    expect(h.updates.at(-1)).toMatchObject({ active: false, action: 'notifications:activity.failed' });
  });

  it('uses a new monitoring key after a new task starts and never relabels errors as finished', async () => {
    await mount();
    const key = h.updates.at(-1).key; h.dismissed = key;
    await poll();
    h.snapshot.statuses.one = { type: 'idle' }; h.snapshot.messages.one = [assistant('APIError')];
    h.runtime.value({ type: 'session.execution.succeeded', data: { sessionID: 'one' } }); h.runtime.fire(250); await h.runtime.settle();
    expect(h.updates.at(-1)).toMatchObject({ active: false, action: 'notifications:activity.failed', key });
    h.snapshot = snapshot(['new']);
    h.runtime.value({ type: 'session.execution.started', data: { sessionID: 'new' } }); h.runtime.fire(250); await h.runtime.settle();
    expect(h.updates.at(-1).key).not.toBe(key); expect(h.updates.at(-1).sessionId).toBe('new');
    h.runtime.unmount();
  });

  it('resumes a dismissed notification for a new submission in the same running chat', async () => {
    await mount();
    const key = h.updates.at(-1).key; h.dismissed = key;
    await poll();
    h.runtime.update({ sendingState: { active: true, sessionId: 'one' } }); await h.runtime.settle();
    expect(h.updates.at(-1).key).not.toBe(key);
    expect(h.updates.at(-1)).toMatchObject({ active: true, sessionId: 'one' });
  });

  it('ignores late old-server snapshots and keeps pending records on a server switch', async () => {
    await mount(); const slow = deferred(); h.read.mockImplementationOnce(() => slow.promise);
    h.runtime.fire(5000);
    h.runtime.update({ connected: false });
    slow.resolve({ sessions: [], statuses: {} }); await h.runtime.settle();
    expect(h.updates.every((update) => update.active)).toBe(true);
    expect(h.cleared).toHaveLength(0); h.runtime.unmount();
  });

  it('raises one needs-input alert while backgrounded and clears it when resolved', async () => {
    await mount();
    h.appState = 'background'; h.listener('background');
    h.runtime.value({ type: 'permission.asked', data: { id: 'p1', sessionID: 'one' } });
    await h.runtime.settle();
    expect(h.attention).toEqual([{ sessionId: 'one', key: 'blocked' }]);
    h.runtime.value({ type: 'permission.replied', data: { sessionID: 'one', requestID: 'p1' } });
    await h.runtime.settle();
    expect(h.resolved).toContain('one');
    h.runtime.unmount();
  });

  it('does not alert for a blocker while the app is foregrounded', async () => {
    await mount();
    h.runtime.value({ type: 'form.created', data: { form: { id: 'f1', sessionID: 'one' } } });
    await h.runtime.settle();
    expect(h.attention).toHaveLength(0);
    h.runtime.unmount();
  });
});

describe('activity service', () => {
  it('rejects partial interaction reads so an idle status cannot hide a blocker', async () => {
    h.read.mockResolvedValue({ sessions: [session('one')], statuses: {} });
    h.build.mockReturnValue({ __opencode: { directory: '/repo' }, api: { permission: { request: { list: async () => { throw new Error('unavailable'); } } }, form: { list: async () => ({ data: [] }) } } });
    await expect(readActivitySnapshot({} as any, props().settings, 'v1', new Set())).rejects.toThrow('unavailable');
  });
});
