// @vitest-environment happy-dom

import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getSessionActivities, selectDisplayedActivity, type ActivitySnapshot } from '@/features/notifications/model/activity-notification-state';
import { parsePendingNotificationSessions } from '@/features/notifications/model/notification-pending';
import { useActivityNotifications } from '@/features/notifications/state/use-activity-notifications';
import { readActivitySnapshot } from '@/features/notifications/services/activity-service';
import { i18n } from '@/shared/i18n/index';
import type { ScopedOpencodeClient } from '@/shared/protocol/opencode/client';
import type { OpencodeEvent } from '@/shared/protocol/opencode/events';
import { PENDING_NOTIFICATION_SESSIONS_STORAGE_KEY } from '@/shared/storage/keys';
import { controlledClock, deferred, settleReact } from '../../../tests/helpers/controlled-clock';
import { renderHook } from '../../../tests/helpers/render-hook';

const h = vi.hoisted(() => ({
  listener: undefined as ((state: string) => void) | undefined, appState: 'active',
  snapshot: undefined as unknown as ActivitySnapshot, granted: true, updates: [] as any[], dismissed: undefined as string | undefined,
  scope: undefined as string | undefined, tracked: [] as unknown[], cleared: [] as unknown[],
  attention: [] as { sessionId: string; key: string }[], resolved: [] as string[], storage: new Map<string, string>(),
  read: vi.fn<() => Promise<{ sessions: ActivitySnapshot['sessions']; statuses: ActivitySnapshot['statuses'] }>>(), stop: vi.fn(),
}));

vi.mock('react-native', () => ({ Platform: { OS: 'android' }, AppState: {
  get currentState() { return h.appState; },
  addEventListener: (_: string, listener: (state: string) => void) => { h.listener = listener; return { remove() { h.listener = undefined; } }; },
} }));
vi.mock('expo-notifications', () => ({
  getPermissionsAsync: async () => ({ granted: h.granted }), AndroidImportance: { DEFAULT: 1 },
  setNotificationChannelAsync: async () => {}, scheduleNotificationAsync: async () => 'id',
  dismissNotificationAsync: async () => {},
}));
vi.mock('expo-router', () => ({ usePathname: () => '/' }));
vi.mock('expo-constants', () => ({ default: {} }));
vi.mock('expo-localization', () => ({ getLocales: () => [{ languageTag: 'en-US' }] }));
vi.mock('expo/fetch', () => ({ fetch: (...args: Parameters<typeof fetch>) => globalThis.fetch(...args) }));
vi.mock('expo-background-task', () => ({}));
vi.mock('expo-task-manager', () => ({ isTaskDefined: () => true }));
vi.mock('expo-crypto', () => ({}));
vi.mock('expo-secure-store', () => ({}));
vi.mock('expo-file-system', () => ({}));
vi.mock('@/shared/platform/activity-notifications', () => ({
  activityNotifications: { stop: () => h.stop() },
  stopActivityNotification: () => { h.scope = undefined; return h.stop(); },
  updateActivityNotification: async (input: any) => { h.scope = input.connectionScope; h.updates.push(input); return input.key !== h.dismissed; },
  isActivityCompletionManaged: () => Boolean(h.scope),
}));
vi.mock('@react-native-async-storage/async-storage', () => ({ default: {
  getItem: async (key: string) => h.storage.get(key) ?? null,
  setItem: async (key: string, value: string) => { write(key, value); },
  removeItem: async (key: string) => { write(key, null); },
} }));

function write(key: string, value: string | null) {
  if (key === PENDING_NOTIFICATION_SESSIONS_STORAGE_KEY) {
    const prev = parsePendingNotificationSessions(h.storage.get(key) ?? '{}');
    const next = parsePendingNotificationSessions(value ?? '{}');
    for (const [id, record] of Object.entries(next)) {
      if (!prev[id]) h.tracked.push(record);
      if (record.attentionKey && record.attentionKey !== prev[id]?.attentionKey) h.attention.push({ sessionId: record.sessionId, key: record.attentionKey });
      if (!record.attentionKey && prev[id]?.attentionKey) h.resolved.push(record.sessionId);
    }
    for (const id of Object.keys(prev)) if (!next[id]) h.cleared.push(prev[id]);
  }
  if (value === null) h.storage.delete(key); else h.storage.set(key, value);
}

function catalogClient() {
  return {
    __opencode: { contract: 'v2', directory: '' },
    api: { session: {
      list: async () => ({ data: (await h.read()).sessions.map((session) => ({ ...session, location: { directory: session.directory } })) }),
      active: async () => Object.fromEntries(Object.entries(h.snapshot.statuses).filter(([, status]) => status.type !== 'idle')),
    } },
  } as unknown as ScopedOpencodeClient;
}
function address(input: RequestInfo | URL) {
  return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
}
async function fetchDataPlane(input: RequestInfo | URL) {
  const path = new URL(address(input)).pathname;
  if (path === '/api/permission/request') return Response.json({ data: [...h.snapshot.blocked].map((sessionID) => ({ id: 'permission-' + sessionID, sessionID, action: 'edit', resources: [], save: [] })) });
  if (path === '/api/form') return Response.json({ data: [] });
  const session = /^\/api\/session\/([^/]+)\/(message|inbox)$/.exec(path);
  if (session?.[2] === 'message') return Response.json({ data: (h.snapshot.messages[session[1]] ?? []).map(({ info, parts }) => ({ ...info, type: info.role, parts })), cursor: {} });
  if (session?.[2] === 'inbox') return Response.json({ data: h.snapshot.queued.has(session[1]) ? [{ id: 'queued' }] : [] });
  return new Response(null, { status: 404 });
}

function session(id: string, parentID?: string, directory = '/repo') {
  return { id, parentID, directory, title: id, time: { created: 1, updated: id === 'new' ? 10 : 2 } } as any;
}
function snapshot(ids = ['one']): ActivitySnapshot {
  return { sessions: ids.map((id) => session(id)), statuses: Object.fromEntries(ids.map((id) => [id, { type: 'busy' }])), blocked: new Set(), queued: new Set(), messages: {} };
}
function assistant(error?: string, parts: any[] = []) {
  return { info: { id: 'message', role: 'assistant', time: { created: 2 }, ...(error ? { error: { name: error, data: {} } } : {}) }, parts } as any;
}
function pluginNotice() {
  return { info: { id: 'notice', role: 'assistant', time: { created: 3 }, synthetic: true, noticeKind: 'plugin' }, parts: [] } as any;
}
function props(): Parameters<typeof useActivityNotifications>[0] {
  return { catalogClient: catalogClient(), settings: { serverUrl: 'https://server', username: '', password: '', directory: '' },
    contract: 'v2' as const, connectionScope: 'scope', connected: true, currentSessionId: 'one', sessions: [session('one')], sendingState: { active: false }, autoApprove: false, isStreamConnected: () => true };
}

let driver: ReturnType<typeof renderHook<ReturnType<typeof props>, ReturnType<typeof useActivityNotifications>>>;
let clock: ReturnType<typeof controlledClock>;
let input: ReturnType<typeof props>;
function update(patch: Partial<typeof input>) {
  input = { ...input, ...patch };
  driver.rerender(input);
}
function notify(event: unknown) {
  act(() => { driver.result.current(event as OpencodeEvent); });
}
function foreground(state: string) {
  h.appState = state;
  act(() => { h.listener?.(state); });
}

beforeEach(() => {
  clock = controlledClock();
  h.appState = 'active'; h.granted = true; h.dismissed = undefined;
  h.updates = []; h.tracked = []; h.cleared = []; h.attention = []; h.resolved = []; h.stop.mockReset().mockResolvedValue(undefined);
  h.snapshot = snapshot(); h.read.mockReset(); h.storage.clear();
  vi.stubGlobal('fetch', fetchDataPlane);
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

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

  it('does not let a plugin notice hide the last assistant failure', () => {
    const state = snapshot();
    state.statuses.one = { type: 'idle' };
    state.messages.one = [assistant('APIError'), pluginNotice()];
    expect(getSessionActivities(state)[0].state).toBe('failed');
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
    h.read.mockImplementation(async () => ({ sessions: h.snapshot.sessions, statuses: h.snapshot.statuses }));
    input = props();
    driver = renderHook(useActivityNotifications, input);
    await settleReact();
  }
  async function poll() { await clock.advance(5000); await settleReact(); }

  it('tracks all server tasks, continues while locked, and publishes one silent result', async () => {
    h.snapshot = snapshot(['one', 'new']); h.snapshot.sessions[1].directory = '/another-project';
    await mount();
    expect(h.updates.at(-1).count).toBe(2); expect(h.tracked).toHaveLength(2);
    foreground('background');
    await poll(); expect(h.updates.at(-1).active).toBe(true);
    h.snapshot.statuses.one = { type: 'idle' }; await poll();
    expect(h.updates.at(-1).sessionId).toBe('new'); expect(h.updates.at(-1).count).toBe(1);
    h.snapshot.statuses.new = { type: 'idle' }; await poll();
    expect(h.updates.at(-1)).toMatchObject({ active: false, action: i18n.t('notifications:activity.finished'), projectPath: '/another-project' });
    expect(h.cleared).toHaveLength(2); expect(clock.countTimers(5000)).toBe(0);
    expect(clock.countTimers(20000)).toBe(0);
    foreground('active'); await settleReact();
    expect(clock.countTimers(20000)).toBe(1);
    driver.unmount(); expect(h.stop).toHaveBeenCalled(); expect(h.scope).toBeUndefined();
  });

  it('does not process attention events for a non-owning workspace observer', async () => {
    await mount();
    update({ connected: false }); await settleReact();
    h.appState = 'background';
    notify({ type: 'permission.asked', data: { sessionID: 'one' } });
    await settleReact();
    expect(h.attention).toHaveLength(0);
  });

  it('retains work on failed reads and reconciles global events outside the selected project', async () => {
    await mount();
    h.read.mockRejectedValueOnce(new Error('offline'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await poll();
    expect(h.updates.at(-1)).toMatchObject({ active: true, action: i18n.t('notifications:activity.reconnecting') });
    expect(h.cleared).toHaveLength(0);
    h.snapshot.blocked.add('one');
    notify({ type: 'question.asked' }); await clock.advance(250); await settleReact();
    expect(h.updates.at(-1).action).toBe(i18n.t('notifications:activity.needsInput'));
    warn.mockRestore(); driver.unmount();
  });

  it('does not post without permission and resumes when permission changes on foreground', async () => {
    h.granted = false; await mount();
    expect(h.updates).toHaveLength(0); expect(h.read).not.toHaveBeenCalled();
    h.granted = true; foreground('active'); await settleReact();
    expect(h.updates.at(-1).active).toBe(true); driver.unmount();
  });

  it('preserves event-only retries until a terminal event clears them', async () => {
    await mount();
    h.snapshot.statuses.one = { type: 'idle' };
    notify({ type: 'session.retry.scheduled', data: { sessionID: 'one', attempt: 1, error: { message: 'Retry' }, at: Date.now() + 60000 } });
    await clock.advance(250); await settleReact();
    expect(h.updates.at(-1)).toMatchObject({ active: true, action: i18n.t('notifications:activity.retrying') });
    expect(h.cleared).toHaveLength(0);
    notify({ type: 'session.execution.succeeded', data: { sessionID: 'one' } });
    await clock.advance(250); await settleReact();
    expect(h.updates.at(-1).active).toBe(false);
  });

  it('starts local work before a slow catalog read and reports submission failure', async () => {
    await mount();
    h.snapshot.statuses.one = { type: 'idle' }; await poll();
    const slow = deferred<{ sessions: ActivitySnapshot['sessions']; statuses: ActivitySnapshot['statuses'] }>(); h.read.mockImplementationOnce(() => slow.promise);
    update({ sendingState: { active: true, sessionId: 'one' } }); await settleReact();
    expect(h.updates.at(-1).active).toBe(true);
    update({ sendingState: { active: false }, promptError: { sessionId: 'one', occurredAt: Date.now() } });
    await act(async () => { slow.resolve({ sessions: h.snapshot.sessions, statuses: h.snapshot.statuses }); });
    expect(h.updates.at(-1)).toMatchObject({ active: false, action: i18n.t('notifications:activity.failed') });
  });

  it('uses a new monitoring key after a new task starts and never relabels errors as finished', async () => {
    await mount();
    const key = h.updates.at(-1).key; h.dismissed = key;
    await poll();
    h.snapshot.statuses.one = { type: 'idle' }; h.snapshot.messages.one = [assistant('APIError')];
    notify({ type: 'session.execution.succeeded', data: { sessionID: 'one' } }); await clock.advance(250); await settleReact();
    expect(h.updates.at(-1)).toMatchObject({ active: false, action: i18n.t('notifications:activity.failed'), key });
    h.snapshot = snapshot(['new']);
    notify({ type: 'session.execution.started', data: { sessionID: 'new' } }); await clock.advance(250); await settleReact();
    expect(h.updates.at(-1).key).not.toBe(key); expect(h.updates.at(-1).sessionId).toBe('new');
    driver.unmount();
  });

  it('resumes a dismissed notification for a new submission in the same running chat', async () => {
    await mount();
    const key = h.updates.at(-1).key; h.dismissed = key;
    await poll();
    update({ sendingState: { active: true, sessionId: 'one' } }); await settleReact();
    expect(h.updates.at(-1).key).not.toBe(key);
    expect(h.updates.at(-1)).toMatchObject({ active: true, sessionId: 'one' });
  });

  it('ignores late old-server snapshots and keeps pending records on a server switch', async () => {
    await mount(); const slow = deferred<{ sessions: ActivitySnapshot['sessions']; statuses: ActivitySnapshot['statuses'] }>(); h.read.mockImplementationOnce(() => slow.promise);
    await clock.advance(5000);
    update({ connected: false });
    await act(async () => { slow.resolve({ sessions: [], statuses: {} }); });
    expect(h.updates.every((update) => update.active)).toBe(true);
    expect(h.cleared).toHaveLength(0); driver.unmount();
  });

  it('raises one needs-input alert while backgrounded and clears it when resolved', async () => {
    await mount();
    foreground('background');
    notify({ type: 'permission.asked', data: { id: 'p1', sessionID: 'one' } });
    await settleReact();
    expect(h.attention).toEqual([{ sessionId: 'one', key: 'blocked' }]);
    notify({ type: 'permission.replied', data: { sessionID: 'one', requestID: 'p1' } });
    await settleReact();
    expect(h.resolved).toContain('one');
    driver.unmount();
  });

  it('does not alert for a blocker while the app is foregrounded', async () => {
    await mount();
    notify({ type: 'form.created', data: { form: { id: 'f1', sessionID: 'one' } } });
    await settleReact();
    expect(h.attention).toHaveLength(0);
    driver.unmount();
  });

  it('does not alert for a request this client will auto-approve', async () => {
    await mount();
    update({ autoApprove: true }); await settleReact();
    foreground('background');
    notify({ type: 'permission.asked', data: { id: 'p1', sessionID: 'one' } });
    await settleReact();
    expect(h.attention).toHaveLength(0);
    driver.unmount();
  });
});

describe('activity service', () => {
  it('rejects partial interaction reads so an idle status cannot hide a blocker', async () => {
    h.read.mockResolvedValue({ sessions: [session('one')], statuses: {} });
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      if (new URL(address(input)).pathname === '/permission') return Response.json({ message: 'unavailable' }, { status: 404 });
      return Response.json([]);
    });
    await expect(readActivitySnapshot(catalogClient(), props().settings, 'v1', new Set())).rejects.toThrow(/unavailable|activity permissions/);
  });
});
