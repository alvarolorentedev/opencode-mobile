import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deferred, hookRuntime, loadTs } from '../helpers/runtime.mjs';
import { recentWidgetSessions, widgetAttention, widgetPlan, widgetReply } from '@/providers/widget-content';
import { hideWidgetPreviews, parseWidgetSnapshot } from '@/providers/widget-snapshot';
import { deriveTodosFromMessages } from '@/lib/opencode/format';
import { mergeSessionStatuses } from '@/providers/opencode-provider-utils';
import { defaultChatPreferences } from '@/providers/opencode-preferences';
import { parseChatPreferences } from '@/providers/persisted-preferences';
import { readWidgetData } from '@/providers/services/widget-service';

const h = vi.hoisted(() => ({ list: vi.fn(), messages: vi.fn(), permissions: vi.fn(), questions: vi.fn(), clients: vi.fn() }));
vi.mock('@/lib/i18n', () => ({ i18n: { t: (key: string) => key }, getFormatLocale: () => 'en' }));
vi.mock('@/lib/opencode/client', () => ({ buildClient: (...args: any[]) => h.clients(...args) }));
vi.mock('@/lib/opencode/client/interactions', () => ({ listPendingPermissions: (...args: any[]) => h.permissions(...args), listPendingQuestions: (...args: any[]) => h.questions(...args) }));
vi.mock('@/providers/services/session-service', () => ({ listActiveSessions: (...args: any[]) => h.list(...args), getSessionMessages: (...args: any[]) => h.messages(...args) }));
vi.mock('react-native', () => ({ Platform: { OS: 'android' } }));
vi.mock('@/lib/connect', () => ({ parseConnectMetadata: () => undefined }));

const session = (id: string, updated = 1, parentID?: string, directory = '/repo') => ({ id, title: id, directory, parentID, time: { created: 1, updated } }) as any;
const assistant = (text: string, created = 1, parts?: any[]) => ({ info: { id: `m${created}`, role: 'assistant', time: { created } }, parts: parts ?? [{ type: 'text', text }] }) as any;
const permission = (sessionID: string, id = sessionID) => ({ id, sessionID, permission: 'edit', patterns: ['src/main.ts'], always: [], metadata: { private: 'do not expose' } });
const question = (sessionID: string, id = sessionID) => ({ id, sessionID, questions: [{ question: 'Which design?', header: 'Design', options: [] }] });
const dataset = () => ({ sessions: [session('one', 2), session('two', 3, undefined, '/other')], statuses: { one: { type: 'idle' }, two: { type: 'busy' } },
  messages: { one: [assistant('hello')], two: [assistant('latest reply', 2)] }, interactions: { permissions: [permission('two')], questions: [] } });

beforeEach(() => { vi.clearAllMocks(); });

describe('widget projections', () => {
  it('selects the three most recently updated roots, independent of running order', () => {
    const archived = { ...session('archived', 100), time: { updated: 100, archived: 1 } };
    expect(recentWidgetSessions([session('a', 1), session('b', 3), session('c', 2), session('d', 4), session('child', 200, 'a'), archived]).map((item) => item.id)).toEqual(['d', 'b', 'c']);
  });
  it('keeps readable assistant text and file-only replies while excluding user text, reasoning and tool output', () => {
    expect(widgetReply([assistant('hello', 1), assistant('', 2, [{ type: 'reasoning', text: 'private reasoning' }]), { info: { role: 'user' }, parts: [] }], 'Attachments')).toEqual({ preview: 'hello', replyAt: 1 });
    expect(widgetReply([assistant('', 3, [{ type: 'file', url: 'data:x', mime: 'image/png' }])], 'Attachments')).toEqual({ preview: 'Attachments', replyAt: 3 });
    expect(widgetReply([assistant('x'.repeat(200))], 'Attachments').preview).toHaveLength(160);
  });
  it('groups descendants, includes globals once, caps rows and strips request metadata', () => {
    const sessions = [session('root'), session('child', 1, 'root'), session('grandchild', 1, 'child'), session('other', 3), session('third', 4), session('fourth', 5)];
    const data = widgetAttention({ sessions, permissions: [permission('grandchild'), permission('other'), permission('third'), permission('fourth')],
      questions: [question('global')], scope: 'scope', untitled: 'Untitled', now: 10, showPreviews: true, currentSessionId: 'root' });
    expect(data.total).toBe(4); expect(data.rows).toHaveLength(3);
    const full = widgetAttention({ sessions: sessions.slice(0, 4), permissions: [permission('grandchild')], questions: [question('global')],
      scope: 'scope', untitled: 'x', now: 11, showPreviews: true, currentSessionId: 'root' });
    expect(full.rows[0]).toMatchObject({ id: 'root', permissions: 1, questions: 1, excerpt: 'edit: src/main.ts' });
    expect(JSON.stringify(full)).not.toContain('do not expose');
    expect(widgetAttention({ ...{ sessions, permissions: [], questions: [] }, scope: 'scope', untitled: 'x', now: 12, showPreviews: true }).rows).toEqual([]);
  });
  it('uses real plan totals and original step indices, updates and completes', () => {
    const todos = [{ content: 'first', status: 'completed' }, { content: 'second', status: 'in_progress' }, { content: 'third', status: 'pending' }].map((entry) => ({ ...entry, priority: 'medium' }));
    const plan = widgetPlan(session('root'), todos, 's', 'x', 1, true);
    expect(plan).toMatchObject({ completed: 1, total: 3, steps: [{ index: 2, status: 'in_progress', content: 'second' }, { index: 3, status: 'pending', content: 'third' }] });
    expect(widgetPlan(session('root'), todos.map((entry) => ({ ...entry, status: 'completed' })), 's', 'x', 2, true).completed).toBe(3);
    expect(widgetPlan(session('root'), [], 's', 'x', 3, true).total).toBe(0);
  });
  it('persists the preview preference and scrubs all three content surfaces on read', () => {
    expect(defaultChatPreferences.showWidgetPreviews).toBe(true);
    expect(parseChatPreferences('{"showWidgetPreviews":false}').showWidgetPreviews).toBe(false);
    expect(parseChatPreferences('{"showWidgetPreviews":"false"}').showWidgetPreviews).toBeUndefined();
    const data = widgetAttention({ sessions: [session('one')], permissions: [permission('one')], questions: [], scope: 's', untitled: 'x', now: 1, showPreviews: true });
    const snapshot = { updatedAt: 1, sessions: [{ ...data.rows[0], preview: 'private reply' }], attention: data,
      plan: widgetPlan(session('one'), [{ content: 'private plan', status: 'pending', priority: 'medium' }], 's', 'x', 1, true), showPreviews: false };
    const parsed = parseWidgetSnapshot(snapshot)!;
    expect(parsed.sessions[0].preview).toBeUndefined(); expect(parsed.attention?.rows[0].excerpt).toBeUndefined(); expect(parsed.plan?.steps[0].content).toBeUndefined();
    expect(hideWidgetPreviews(snapshot).plan?.total).toBe(1);
    expect(parseWidgetSnapshot({ ...snapshot, attention: { ...data, total: -1 }, plan: { ...snapshot.plan, completed: 99 } })?.attention).toBeUndefined();
  });
});

describe('widget service', () => {
  const settings = { serverUrl: 'https://server', username: '', password: '', directory: '' };
  beforeEach(() => {
    h.clients.mockImplementation((settings) => ({ directory: settings.directory }));
    h.list.mockResolvedValue({ sessions: [session('one'), session('two', 2, undefined, '/other')], statuses: {} });
    h.messages.mockResolvedValue({ records: [assistant('reply')] });
    h.permissions.mockResolvedValue([permission('one')]); h.questions.mockResolvedValue([]);
  });
  it('reads recent replies and all workspaces with no notification dependency, and deduplicates globals', async () => {
    const result = await readWidgetData({} as any, settings, 'v2');
    expect(h.messages).toHaveBeenCalledTimes(2); expect(h.permissions).toHaveBeenCalledTimes(2);
    expect(h.clients.mock.calls.map(([setting]) => setting.directory)).toEqual(['/repo', '/other']);
    expect(result.interactions?.permissions).toHaveLength(1); expect(Object.keys(result.messages!)).toHaveLength(2);
  });
  it('retains failed surfaces as unknown, rather than reporting empty results', async () => {
    h.permissions.mockRejectedValueOnce(new Error('offline'));
    h.messages.mockRejectedValueOnce(new Error('offline'));
    const result = await readWidgetData({} as any, settings, 'v1');
    expect(result.interactions).toBeUndefined(); expect(result.messages).toBeUndefined();
  });
});

describe('widget provider lifecycle', () => {
  let runtime: ReturnType<typeof hookRuntime>;
  let read: ReturnType<typeof vi.fn>;
  let save: ReturnType<typeof vi.fn>;
  let repaint: ReturnType<typeof vi.fn>;
  let stored: any;
  let input: any;
  let resume: (state: string) => void;
  async function mount(patch = {}) {
    const { useWidgetState } = await loadTs('providers/use-widget-state.ts', {
      react: runtime.react,
      'react-native': { AppState: { addEventListener: (_: string, callback: typeof resume) => { resume = callback; return { remove() {} }; } } },
      '@/lib/i18n': { i18n: { t: (key: string) => key } },
      '@/lib/opencode/events': { getEventSessionStatus: (event: any) => event.status },
      '@/lib/opencode/format': { deriveTodosFromMessages }, '@/lib/widgets': { homeWidgetSupported: true, updateHomeWidget: repaint },
      '@/providers/opencode-provider-utils': { mergeSessionStatuses }, '@/providers/services/widget-service': { readWidgetData: read },
      '@/providers/widget-content': { recentWidgetSessions, widgetPlan, widgetAttention, widgetReply,
        widgetSession: (session: any, scope: string, _untitled: string, status = { type: 'idle' }) => ({ id: session.id, title: session.title, status: status.type, link: `opencodemobile://session/${session.id}?connectionScope=${scope}` }) },
      '@/providers/widget-snapshot': { hideWidgetPreviews }, '@/providers/widget-snapshot-storage': { loadWidgetSnapshot: async () => stored, saveWidgetSnapshot: save },
    }, { ...runtime.globals, Date });
    input = { hydrated: true, connected: true, connectionScope: 'scope', catalogClient: {}, settings: {}, contract: 'v1',
      isCurrentCatalogClient: () => true, showPreviews: true, currentSessionId: 'one', sessions: dataset().sessions,
      todosBySession: { one: [{ content: 'plan step', status: 'pending', priority: 'medium' }] }, todoRecordsBySession: {}, ...patch };
    runtime.mount(useWidgetState, input); await runtime.settle();
  }
  beforeEach(() => {
    runtime = hookRuntime(); stored = undefined;
    read = vi.fn(async () => dataset()); save = vi.fn(async () => true); repaint = vi.fn(async () => {});
  });
  it('loads independently of the library and refreshes global events, polling and resume', async () => {
    await mount(); expect(read).toHaveBeenCalledOnce(); expect(runtime.value.busy).toBe(true);
    const count = read.mock.calls.length;
    runtime.value.handleWidgetEvent({ type: 'session.text.delta', location: { directory: '/other' } });
    runtime.fire(1500); await runtime.settle(); expect(read).toHaveBeenCalledTimes(count + 1);
    await runtime.value.refreshWidgets(); await runtime.settle();
    resume('active'); await runtime.settle(); expect(read.mock.calls.length).toBe(count + 3);
    runtime.unmount();
  });
  it('retains data and timestamps after failed surface reads and removes settled requests on success', async () => {
    await mount(); const previous = save.mock.calls.at(-1)![0];
    read.mockResolvedValueOnce({ ...dataset(), messages: undefined, interactions: undefined });
    await runtime.value.refreshWidgets(); await runtime.settle();
    expect(save.mock.calls.at(-1)![0].updatedAt).toBe(previous.updatedAt);
    expect(save.mock.calls.at(-1)![0].attention).toEqual(previous.attention);
    read.mockResolvedValueOnce({ ...dataset(), statuses: {}, interactions: { permissions: [], questions: [] } });
    await runtime.value.refreshWidgets(); await runtime.settle();
    expect(save.mock.calls.at(-1)![0].attention.total).toBe(0); expect(runtime.value.busy).toBe(false);
    runtime.unmount();
  });
  it('keeps the safety poll active after a catalog failure while retaining the last snapshot', async () => {
    read.mockResolvedValue({ ...dataset(), statuses: {}, interactions: { permissions: [], questions: [] } });
    await mount(); expect(runtime.value.busy).toBe(false);
    const last = save.mock.calls.at(-1)![0];
    read.mockRejectedValueOnce(new Error('catalog temporarily unavailable'));
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await runtime.value.refreshWidgets(); await runtime.settle();
      expect(runtime.value.busy).toBe(true);
      expect(save.mock.calls.at(-1)![0]).toEqual(last);
      await runtime.value.refreshWidgets(); await runtime.settle();
      expect(runtime.value.busy).toBe(false);
    } finally { warning.mockRestore(); runtime.unmount(); }
  });
  it('clears old connections and rejects a late response from the old client', async () => {
    await mount(); const slow = deferred(); read.mockReturnValueOnce(slow.promise);
    const old = runtime.value.refreshWidgets();
    runtime.update({ connectionScope: 'new', catalogClient: {}, currentSessionId: undefined, sessions: [] }); await runtime.settle();
    slow.resolve({ ...dataset(), messages: { one: [assistant('old server secret')] } }); await old; await runtime.settle();
    expect(save.mock.calls.at(-1)![0].connectionScope).toBe('new');
    expect(JSON.stringify(save.mock.calls.at(-1)![0])).not.toContain('old server secret');
    runtime.unmount();
  });
  it('removes all persisted excerpts when previews are disabled, including queued publishes', async () => {
    await mount(); const blocked = deferred(); save.mockImplementationOnce(() => blocked.promise);
    const pending = runtime.value.refreshWidgets(); await runtime.settle();
    const before = save.mock.calls.length;
    const repaintsBefore = repaint.mock.calls.length;
    runtime.update({ showPreviews: false });
    blocked.resolve(true); await pending; await runtime.settle();
    for (const [snapshot] of save.mock.calls.slice(before)) {
      expect(snapshot.showPreviews).toBe(false);
      expect(JSON.stringify(snapshot)).not.toMatch(/hello|latest reply|plan step|src\/main/);
    }
    for (const [snapshot] of repaint.mock.calls.slice(repaintsBefore)) {
      expect(JSON.stringify(snapshot)).not.toMatch(/hello|latest reply|plan step|src\/main/);
    }
    runtime.unmount();
  });
  it('serializes writes and updates real plan steps without refetching other workspaces', async () => {
    await mount(); const blocked = deferred(); save.mockImplementationOnce(() => blocked.promise);
    runtime.update({ todosBySession: { one: [{ content: 'updated step', status: 'completed', priority: 'medium' }] } });
    await runtime.settle(); const count = save.mock.calls.length;
    runtime.update({ currentSessionId: 'two' }); await runtime.settle();
    expect(save).toHaveBeenCalledTimes(count);
    blocked.resolve(true); await runtime.settle();
    expect(read).toHaveBeenCalledOnce();
    expect(save.mock.calls.at(-1)![0].plan.session.id).toBe('two');
    runtime.unmount();
  });
});

it('renders all widget sizes with bounded rows, absolute timestamps and accessible route targets', async () => {
  const element = (type: any, props: any) => ({ type, props });
  const { SessionWidget, widgetRowLimit } = await loadTs('widgets/session-widget.tsx', {
    'react/jsx-runtime': { jsx: element, jsxs: element, Fragment: 'Fragment' },
    'react-native-android-widget': { FlexWidget: 'Flex', TextWidget: 'Text' },
    '@/lib/i18n': { i18n: { t: (key: string, values: any) => values ? `${key} ${JSON.stringify(values)}` : key, getFixedT: (language: string) => (key: string) => `${language}:${key}` } },
    '@/lib/opencode/format': { formatTimestamp: () => 'Oct 13, 10:00' },
  });
  expect([110, 200, 300].map(widgetRowLimit)).toEqual([1, 2, 3]);
  const data = dataset(); const attention = widgetAttention({ ...data.interactions, sessions: data.sessions, scope: 's', untitled: 'x', now: 1, showPreviews: true });
  const snapshot = { updatedAt: 1, sessions: attention.rows, attention, plan: widgetPlan(data.sessions[0], [], 's', 'x', 1, true) };
  expect(SessionWidget({ snapshot: { ...snapshot, language: 'es' }, scheme: 'light' }).props.accessibilityLabel).toBe('es:share:widgets.replies');
  for (const kind of ['replies', 'attention', 'plan']) {
    const rendered = SessionWidget({ snapshot, scheme: 'dark', kind, height: 200 });
    expect(rendered.props.accessibilityLabel).toBe(`share:widgets.${kind}`);
    expect(JSON.stringify(rendered)).toContain('Oct 13, 10:00');
    expect(rendered.props.clickAction).toBe(kind === 'plan' ? 'OPEN_URI' : 'OPEN_APP');
  }
});
