import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hookRuntime, deferred } from '../../../tests/helpers/runtime.mjs';
import { getSessionActivities, selectDisplayedActivity, type ActivitySnapshot } from '@/features/notifications/model/activity-notification-state';
import { useActivityNotifications } from '@/features/notifications/state/use-activity-notifications';
import { readActivitySnapshot } from '@/features/notifications/services/activity-service';

const h = vi.hoisted(() => ({
  runtime: undefined as any, listener: undefined as any, appState: 'active', platform: 'android',
  snapshot: undefined as any, granted: true, updates: [] as any[], dismissed: undefined as string | undefined,
  scope: undefined as string | undefined, tracked: [] as any[], cleared: [] as any[],
  attention: [] as any[], resolved: [] as string[],
  read: vi.fn(), stop: vi.fn(), build: vi.fn(), permissions: vi.fn(),
  register: vi.fn(), ready: vi.fn(), release: vi.fn(),
}));
vi.mock('react', () => Object.fromEntries(['useRef', 'useLayoutEffect', 'useEffect', 'useCallback'].map((key) => [key, (...args: any[]) => h.runtime.react[key](...args)])));
vi.mock('react-native', () => ({ Platform: { get OS() { return h.platform; } }, AppState: {
  get currentState() { return h.appState; },
  addEventListener: (_: string, listener: any) => { h.listener = listener; return { remove() { h.listener = undefined; } }; },
} }));
vi.mock('expo-notifications', () => ({ getPermissionsAsync: () => h.permissions() }));
vi.mock('@/shared/platform/activity-notifications', () => ({
  activityNotifications: { stop: () => h.stop() },
  registerActivityNotificationScope: (scope: string) => { h.register(scope); return h.release; },
  markActivityNotificationScopeReady: (...args: any[]) => h.ready(...args),
  stopActivityNotification: () => { h.scope = undefined; return h.stop(); },
  updateActivityNotification: async (input: any) => { h.updates.push(input); return input.key !== h.dismissed; },
}));
vi.mock('@/shared/i18n/index', () => ({ i18n: { t: (key: string) => key } }));
vi.mock('@/features/notifications/services/notifications', () => ({
  trackPendingTaskFinishedNotification: async (input: any) => { h.tracked.push(input); return input; },
  clearPendingTaskFinishedNotification: async (...args: any[]) => { h.cleared.push(args); },
  raisePendingAttention: async (_scope: string, sessionId: string, key: string) => { h.attention.push({ sessionId, key }); return true; },
  clearPendingAttention: async (_scope: string, sessionId: string) => { h.resolved.push(sessionId); return true; },
}));
vi.mock('@/shared/protocol/opencode/client', () => ({ buildClient: (...args: any[]) => h.build(...args) }));
vi.mock('@/shared/protocol/services/session-service', () => ({
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
  h.runtime = hookRuntime(); h.appState = 'active'; h.platform = 'android'; h.granted = true; h.dismissed = undefined;
  h.permissions.mockReset().mockImplementation(async () => ({ granted: h.granted }));
  h.updates = []; h.tracked = []; h.cleared = []; h.attention = []; h.resolved = []; h.stop.mockReset().mockResolvedValue(undefined); h.build.mockReset();
  h.snapshot = snapshot(); h.read.mockReset();
  h.register.mockReset(); h.ready.mockReset(); h.release.mockReset().mockResolvedValue(undefined);
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

  it('anchors a root run to its latest user or assistant parent, never a child or assistant step id', () => {
    const state = snapshot(['one', 'child']); state.sessions[1].parentID = 'one';
    state.messages.one = [{ info: { id: 'prompt-1', role: 'user', time: { created: 1 } }, parts: [] }] as any;
    state.messages.child = [{ info: { id: 'child-prompt', role: 'user', time: { created: 100 } }, parts: [] }] as any;
    expect(getSessionActivities(state)[0].runId).toBe('prompt-1');
    state.messages.one!.push({ info: { id: 'step-1', role: 'assistant', parentID: 'prompt-1', time: { created: 2 } }, parts: [] } as any);
    expect(getSessionActivities(state)[0].runId).toBe('prompt-1');
    state.messages.one = [{ info: { id: 'step-2', role: 'assistant', parentID: 'prompt-1', time: { created: 3 } }, parts: [] }] as any;
    expect(getSessionActivities(state)[0].runId).toBe('prompt-1');
    state.messages.one!.push({ info: { id: 'prompt-2', role: 'user', time: { created: 4 } }, parts: [] } as any);
    expect(getSessionActivities(state)[0].runId).toBe('prompt-2');
    state.messages.one = [assistant()];
    expect(getSessionActivities(state)[0].runId).toBeUndefined();
  });
});

describe('provider observer', () => {
  async function mount(overrides: Record<string, unknown> = {}) {
    // Exercise the actual service too, with deterministic SDK clients.
    h.read.mockImplementation(async () => ({ sessions: h.snapshot.sessions, statuses: h.snapshot.statuses }));
    h.build.mockImplementation(() => ({
      __opencode: { contract: 'v2', directory: '/repo' },
      api: { permission: { request: { list: async () => ({ data: [...h.snapshot.blocked].map((sessionID) => ({ id: `permission-${sessionID}`, sessionID, action: 'edit', resources: [], save: [] })) }) } }, form: { list: async () => ({ data: [] }) } },
      messages: async (id: string) => h.snapshot.messages[id] ?? [],
      promptInbox: { list: async (id: string) => h.snapshot.queued.has(id) ? [{ id: 'queued' }] : [] },
    }));
    h.runtime.mount(useActivityNotifications, { ...props(), ...overrides });
    await h.runtime.settle();
  }
  async function poll() { h.runtime.fire(5000); await h.runtime.settle(); }

  it('uses the iOS capability without alert permission and leaves completion records to their owner', async () => {
    h.platform = 'ios'; h.granted = false;
    await mount();
    expect(h.permissions).not.toHaveBeenCalled();
    expect(h.updates.at(-1)).toMatchObject({ phase: 'thinking', action: '', count: 1 });
    h.snapshot.statuses.one = { type: 'idle' }; await poll();
    expect(h.updates.at(-1)).toMatchObject({ phase: 'finished', active: false });
    expect(h.cleared).toHaveLength(0);
  });

  it('publishes factual iOS metrics across roots, omits partial plans, and retains final progress', async () => {
    h.platform = 'ios'; h.snapshot = snapshot(['one', 'new']);
    const records = (completed: number, total: number) => [
      { info: { id: 'prompt', role: 'user', time: { created: 1 } }, parts: [] },
      { info: { id: 'step', role: 'assistant', parentID: 'prompt', time: { created: 2 } }, parts: [
        { id: 'plan', callID: 'plan', type: 'tool', tool: 'todowrite', state: { status: 'completed', input: {
          todos: Array.from({ length: total }, (_, index) => ({ content: 'PRIVATE', status: index < completed ? 'completed' : 'pending' })),
        } } },
        { id: 'read', callID: 'read', type: 'tool', tool: 'read_file', state: { status: 'running', input: { path: '/PRIVATE' }, title: 'PRIVATE' } },
      ] },
    ];
    h.snapshot.messages.one = records(1, 2); h.snapshot.messages.new = records(2, 3);
    await mount();
    expect(h.updates.at(-1)).toMatchObject({ phase: 'reading', action: '', agentCount: 2, toolCount: 2, progress: { completed: 3, total: 5 } });
    h.snapshot.messages.new = []; await poll();
    expect(h.updates.at(-1).progress).toBeUndefined(); expect(h.updates.at(-1).toolCount).toBeUndefined();
    h.snapshot.statuses.new = { type: 'idle' }; await poll();
    expect(h.updates.at(-1)).toMatchObject({ progress: { completed: 1, total: 2 } });
    h.snapshot.blocked.add('one'); await poll();
    expect(h.updates.at(-1).phase).toBe('needsInput');
    h.snapshot.blocked.clear(); h.snapshot.statuses.one = { type: 'idle' }; await poll();
    expect(h.updates.at(-1)).toMatchObject({ active: false, phase: 'finished', progress: { completed: 1, total: 2 }, agentCount: 0, toolCount: 0 });
    expect(h.cleared).toHaveLength(0);
    const slow = deferred(); h.read.mockImplementationOnce(() => slow.promise);
    h.runtime.update({ sendingState: { active: true, sessionId: 'one' } }); await h.runtime.settle();
    expect(h.updates.at(-1)).toMatchObject({ active: true, phase: 'thinking' });
    expect(h.updates.at(-1).progress).toBeUndefined(); expect(h.updates.at(-1).agentCount).toBeUndefined();
    slow.resolve({ sessions: h.snapshot.sessions, statuses: h.snapshot.statuses }); await h.runtime.settle();
  });

  it('does not reuse previous-turn insights for a local submission or alter Android rendering', async () => {
    h.platform = 'ios';
    h.snapshot.messages.one = [{ info: { id: 'step', role: 'assistant', parentID: 'old', time: { created: 1 } }, parts: [
      { type: 'tool', tool: 'read', state: { status: 'running', input: {}, title: 'Reading private.txt' } },
    ] }];
    await mount(); expect(h.updates.at(-1).phase).toBe('reading');
    h.runtime.update({ sendingState: { active: true, sessionId: 'one' } }); await h.runtime.settle();
    expect(h.updates.at(-1)).toMatchObject({ phase: 'thinking' });
    expect(h.updates.at(-1).toolCount).toBeUndefined();
    h.runtime.unmount(); h.runtime = hookRuntime();
    for (const [key, value] of Object.entries(h.runtime.globals)) vi.stubGlobal(key, value);
    h.platform = 'android'; await mount();
    expect(h.updates.at(-1)).toMatchObject({ phase: 'thinking', action: 'Reading private.txt' });
    expect(h.updates.at(-1)).not.toHaveProperty('progress');
  });

  it('registers before the first iOS read and reconciles verified idle startup without clearing completion data', async () => {
    h.platform = 'ios'; h.snapshot.statuses.one = { type: 'idle' };
    await mount();
    expect(h.register).toHaveBeenCalledWith('scope');
    expect(h.register.mock.invocationCallOrder[0]).toBeLessThan(h.read.mock.invocationCallOrder[0]);
    expect(h.ready).toHaveBeenCalledWith('scope', expect.any(Function));
    expect(h.stop).toHaveBeenCalledOnce(); expect(h.updates).toHaveLength(0);
    expect(h.cleared).toHaveLength(0);
    h.runtime.unmount(); expect(h.release).toHaveBeenCalledOnce();
  });

  it('does not claim readiness or idle when the initial iOS snapshot fails', async () => {
    h.platform = 'ios'; await mount();
    h.runtime.unmount(); h.runtime = hookRuntime();
    for (const [key, value] of Object.entries(h.runtime.globals)) vi.stubGlobal(key, value);
    h.ready.mockClear(); h.stop.mockClear(); h.updates = [];
    h.read.mockRejectedValueOnce(new Error('offline'));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    h.runtime.mount(useActivityNotifications, props()); await h.runtime.settle();
    expect(h.ready).toHaveBeenCalledWith('scope');
    expect(h.ready.mock.calls.every((call) => call[1] === undefined)).toBe(true);
    expect(h.stop).not.toHaveBeenCalled(); expect(h.updates).toHaveLength(0);
  });

  it('publishes all active root anchors with a predicate invalidated by lifecycle and owner replacement', async () => {
    h.platform = 'ios'; h.snapshot = snapshot(['one', 'new']);
    h.snapshot.messages.one = [{ info: { id: 'prompt-1', role: 'user', time: { created: 1 } }, parts: [] }] as any;
    h.snapshot.messages.new = [{ info: { id: 'step-1', role: 'assistant', parentID: 'prompt-2', time: { created: 2 } }, parts: [] }] as any;
    await mount();
    const first = h.updates.at(-1);
    expect(first.work).toEqual([{ sessionId: 'one', runId: 'prompt-1' }, { sessionId: 'new', runId: 'prompt-2' }]);
    expect(first.isCurrent()).toBe(true);
    h.appState = 'background'; h.listener('background');
    h.appState = 'active'; h.listener('active');
    expect(first.isCurrent()).toBe(false);
    await h.runtime.settle();
    const resumed = h.updates.at(-1); expect(resumed.isCurrent()).toBe(true);
    h.runtime.update({ catalogClient: {}, connectionScope: 'other' });
    expect(resumed.isCurrent()).toBe(false); await h.runtime.settle();
    expect(h.release).toHaveBeenCalledOnce();
  });

  it('does not observe V1 or unknown contracts on iOS', async () => {
    h.platform = 'ios'; await mount({ contract: 'v1' });
    expect(h.read).not.toHaveBeenCalled(); expect(h.permissions).not.toHaveBeenCalled();
    h.appState = 'background';
    h.runtime.value({ type: 'permission.asked', data: { sessionID: 'one' } });
    await h.runtime.settle();
    expect(h.attention).toHaveLength(0); expect(h.updates).toHaveLength(0);
    h.runtime.update({ contract: undefined }); await h.runtime.settle();
    expect(h.read).not.toHaveBeenCalled();
  });

  it('retains iOS completion tracking when native declines a surface and never discovers work in background', async () => {
    h.platform = 'ios'; h.appState = 'background'; await mount();
    expect(h.read).not.toHaveBeenCalled(); expect(h.updates).toHaveLength(0);
    h.appState = 'active'; h.listener('active'); await h.runtime.settle();
    h.dismissed = h.updates.at(-1).key;
    await poll();
    expect(h.tracked).toHaveLength(1); expect(h.cleared).toHaveLength(0);
    h.appState = 'background'; h.listener('background');
    expect(h.runtime.countTimers(20000)).toBe(0);
    h.appState = 'active'; h.listener('active'); await h.runtime.settle();
    expect(h.tracked).toHaveLength(1); expect(h.cleared).toHaveLength(0);
  });

  it('pauses iOS timers and ignores late foreground reads until a fresh resume snapshot', async () => {
    h.platform = 'ios'; await mount();
    const slow = deferred(); h.read.mockImplementationOnce(() => slow.promise);
    h.runtime.fire(5000);
    h.runtime.value({ type: 'question.asked' });
    h.appState = 'background'; h.listener('background');
    const updates = h.updates.length;
    slow.resolve({ sessions: [], statuses: {} }); await h.runtime.settle();
    expect(h.updates).toHaveLength(updates); expect(h.cleared).toHaveLength(0);
    expect(h.runtime.countTimers(5000)).toBe(0); expect(h.runtime.countTimers(20000)).toBe(0);
    expect(h.runtime.countTimers(250)).toBe(0);
    const reads = h.read.mock.calls.length;
    h.runtime.value({ type: 'question.asked' }); h.runtime.fire(250); await h.runtime.settle();
    expect(h.read).toHaveBeenCalledTimes(reads);
    h.appState = 'active'; h.listener('active'); await h.runtime.settle();
    expect(h.updates.at(-1)).toMatchObject({ phase: 'thinking', active: true });
    expect(h.runtime.countTimers(5000)).toBe(1);
  });

  it('does not reuse a snapshot spanning an iOS background/foreground transition', async () => {
    h.platform = 'ios'; await mount();
    const slow = deferred(); h.read.mockImplementationOnce(() => slow.promise);
    h.runtime.fire(5000);
    h.appState = 'background'; h.listener('background');
    h.appState = 'active'; h.listener('active');
    slow.resolve({ sessions: [], statuses: {} }); await h.runtime.settle();
    expect(h.updates.every((update) => update.active)).toBe(true);
    expect(h.updates.at(-1).phase).toBe('thinking');
    expect(h.runtime.countTimers(5000)).toBe(1);
  });

  it('drops late iOS snapshots after a scope/auth owner replacement', async () => {
    h.platform = 'ios'; await mount();
    const slow = deferred(); h.read.mockImplementationOnce(() => slow.promise);
    h.runtime.fire(5000);
    h.runtime.update({ catalogClient: {}, connectionScope: 'other' }); await h.runtime.settle();
    const updates = h.updates.length;
    slow.resolve({ sessions: [], statuses: {} }); await h.runtime.settle();
    expect(h.updates).toHaveLength(updates); expect(h.cleared).toHaveLength(0);
    expect(h.updates.at(-1).connectionScope).toBe('other');
  });

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

vi.mock('@/features/sessions/runtime', () => import('@/features/sessions/model/session-utils'));
