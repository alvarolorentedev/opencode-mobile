import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { runInNewContext } from 'node:vm';
import { transformSync } from '@babel/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deferred, hookRuntime, loadTs } from '../helpers/runtime.mjs';
import { recentWidgetSessions, widgetAttention, widgetPlan, widgetReply, widgetSession } from '@/providers/widget-content';
import { hideWidgetPreviews, parseWidgetSnapshot } from '@/providers/widget-snapshot';
import { deriveTodosFromMessages, formatTimestamp } from '@/lib/opencode/format';
import { i18n } from '@/lib/i18n';
import * as storageKeys from '@/lib/storage-keys';
import { mergeSessionStatuses } from '@/providers/opencode-provider-utils';
import { defaultChatPreferences } from '@/providers/opencode-preferences';
import { parseChatPreferences } from '@/providers/persisted-preferences';
import { readWidgetData } from '@/providers/services/widget-service';

const h = vi.hoisted(() => ({ list: vi.fn(), messages: vi.fn(), permissions: vi.fn(), questions: vi.fn(), clients: vi.fn() }));
vi.mock('@/lib/opencode/client/types', () => ({ defaultConnectionSettings: { serverUrl: 'http://localhost' } }));
vi.mock('expo-localization', () => ({ getLocales: () => [{ languageTag: 'en' }] }));
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
  it('reads recent replies and all projects with no notification dependency, and deduplicates globals', async () => {
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
  it('probes running, dirty and all known-blocked directories while SSE is healthy, then fully scans on fallback', async () => {
    h.list.mockResolvedValue({ sessions: Array.from({ length: 20 }, (_, i) => session(`s${i}`, i, undefined, `/repo${i}`)), statuses: { s7: { type: 'busy' } } });
    h.permissions.mockResolvedValue([]); h.questions.mockResolvedValue([]);
    const previousInteractions = Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`/repo${i}`, { permissions: [permission(`s${i}`)], questions: [] }]));
    // More blocked projects than the widget's three visible rows must remain watched.
    const result = await readWidgetData({} as any, settings, 'v2', { probeAllDirectories: false, watchedDirectories: new Set(['/repo7', '/repo8', ...Object.keys(previousInteractions)]), previousInteractions });
    expect(h.permissions).toHaveBeenCalledTimes(8); expect(h.questions).toHaveBeenCalledTimes(8);
    expect(h.clients).toHaveBeenCalledTimes(11); expect(h.messages).toHaveBeenCalledTimes(3);
    expect(result.interactions?.permissions).toEqual([]);
    h.permissions.mockClear(); h.questions.mockClear();
    await readWidgetData({} as any, settings, 'v2', { probeAllDirectories: true });
    expect(h.permissions).toHaveBeenCalledTimes(20); expect(h.questions).toHaveBeenCalledTimes(20);
  });
  it('preserves unprobed interaction data and builds only the recent clients in an idle healthy project catalog', async () => {
    h.list.mockResolvedValue({ sessions: Array.from({ length: 20 }, (_, i) => session(`s${i}`, i, undefined, `/repo${i}`)), statuses: {} });
    const previous = { '/repo0': { permissions: [permission('s0')], questions: [] } };
    const result = await readWidgetData({} as any, settings, 'v2', { probeAllDirectories: false, previousInteractions: previous });
    expect(h.permissions).not.toHaveBeenCalled(); expect(h.clients).toHaveBeenCalledTimes(3);
    expect(result.interactions?.permissions).toEqual(previous['/repo0'].permissions);
  });
  it('keeps event-derived retry sessions watched when the native catalog reports idle', async () => {
    h.list.mockResolvedValue({ sessions: [session('retry', 1, undefined, '/retry')], statuses: { retry: { type: 'idle' } } });
    await readWidgetData({} as any, settings, 'v2', { probeAllDirectories: false, watchedSessionIds: new Set(['retry']) });
    expect(h.permissions).toHaveBeenCalledWith(expect.objectContaining({ directory: '/retry' }));
    expect(h.questions).toHaveBeenCalledOnce();
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
  it('serializes writes and updates real plan steps without refetching other projects', async () => {
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

describe('compiled native widgets', () => {
  const require = createRequire(import.meta.url);
  const libraryRoot = 'node_modules/react-native-android-widget/lib/commonjs/';
  const { buildWidgetTree } = require(path.resolve(`${libraryRoot}api/build-widget-tree.js`));
  const primitives = {
    ...require(path.resolve(`${libraryRoot}widgets/FlexWidget.js`)),
    ...require(path.resolve(`${libraryRoot}widgets/TextWidget.js`)),
  };
  const { jsx } = require('react/jsx-runtime');
  const now = Date.UTC(2026, 9, 13, 8);
  const todos = [
    { content: 'Previous step', status: 'completed', priority: 'medium' },
    { content: 'Actual next step', status: 'in_progress', priority: 'medium' },
    { content: 'Following step', status: 'pending', priority: 'medium' },
  ] as any;
  function snapshot() {
    const sessions = [session('one', 3), session('two', 2), session('three', 1)];
    return {
      updatedAt: now, language: 'en', showPreviews: true, connectionScope: 'scope',
      sessions: sessions.map((entry, index) => ({ ...widgetSession(entry, 'scope', 'Untitled', { type: index === 0 ? 'busy' : index === 1 ? 'retry' : 'idle' }), preview: `Reply ${entry.id}` })),
      attention: widgetAttention({ sessions, permissions: sessions.map((entry) => permission(entry.id)), questions: [question('one')], scope: 'scope', untitled: 'Untitled', now, showPreviews: true }),
      plan: widgetPlan(sessions[0], todos, 'scope', 'Untitled', now, true),
    };
  }
  // Run Expo's actual Android compiler and the library's serializer, outside a React renderer.
  function loadModule(relative: string, imports: Record<string, any>, dev = false, platform = 'android') {
    const filename = path.resolve(relative);
    const source = readFileSync(filename, 'utf8');
    const code = relative.endsWith('.js') ? source : transformSync(source, {
      filename, configFile: false, babelrc: false, presets: ['babel-preset-expo'],
      caller: { name: 'metro', platform, isDev: dev, isNodeModule: false, supportsStaticESM: false, supportsReactCompiler: true },
    })!.code!;
    const exports = {};
    const localRequire = createRequire(filename);
    runInNewContext(code, { exports, console, require: (name: string) => name in imports ? imports[name] : localRequire(name) });
    return exports as any;
  }
  function renderer(dev = false) {
    return loadModule('widgets/session-widget.tsx', {
      'react-native-android-widget': primitives, '@/lib/i18n': { i18n }, '@/lib/opencode/format': { formatTimestamp },
    }, dev);
  }
  const flatten = (tree: any): any[] => [tree, ...(tree.children ?? []).flatMap(flatten)];
  const text = (tree: any) => flatten(tree).filter((node) => node.type === 'TextWidget').map((node) => node.props.text);

  it.each([true, false])('serializes visible content, empty states and redaction with dev=%s', (dev) => {
    const { SessionWidget, widgetRowLimit } = renderer(dev);
    expect([140, 200, 300].map(widgetRowLimit)).toEqual([1, 2, 3]);
    const data = snapshot();
    const empty = { ...data, sessions: [], attention: { updatedAt: now, total: 0, rows: [] }, plan: widgetPlan(session('one'), [], 'scope', 'x', now, true) };
    const completed = { ...data, plan: widgetPlan(session('one'), todos.map((step: any) => ({ ...step, status: 'completed' })), 'scope', 'x', now, true) };
    for (const kind of ['replies', 'attention', 'plan']) for (const scheme of ['light', 'dark']) for (const height of [140, 300]) {
      for (const [state, snapshot] of Object.entries({ missing: undefined, empty, populated: data, hidden: hideWidgetPreviews(data), completed })) {
        const tree = buildWidgetTree(jsx(SessionWidget, { snapshot, scheme, kind, height }));
        const texts = text(tree);
        const serialized = JSON.stringify(tree);
        expect(tree.props.backgroundColor).toBe(scheme === 'light' ? '#FCFDFC' : '#16201D');
        expect(tree.props).toMatchObject({ width: 'match_parent', height: 'match_parent', accessibilityLabel: i18n.t(`share:widgets.${kind}`) });
        expect(texts[0]).toBe(i18n.t(`share:widgets.${kind}`));
        expect(texts.length).toBeGreaterThan(1);
        expect(texts.every((value: string) => value.length > 0 && !value.includes('share:widgets.'))).toBe(true);
        const targets = flatten(tree).filter((node) => node.props?.clickAction === 'OPEN_URI');
        if (snapshot) {
          expect(texts).toContain(i18n.t('share:widgets.updated', { time: formatTimestamp(now, 'en') }));
          if (kind === 'plan') expect(targets[0].props.clickActionData.uri).toBe(data.plan.session.link);
          else {
            const rows = kind === 'attention' ? snapshot.attention!.rows : snapshot.sessions;
            expect(targets.map((node) => node.props.clickActionData.uri)).toEqual(rows.slice(0, widgetRowLimit(height)).map((row) => row.link));
            expect(targets.every((node) => node.props.accessibilityLabel.includes(node.children[0].props.text))).toBe(true);
          }
        }
        if (state === 'missing') expect(texts).toContain(i18n.t(`share:widgets.${kind === 'plan' ? 'chooseChat' : kind === 'attention' ? 'openApp' : 'noReply'}`));
        if (state === 'empty') expect(texts).toContain(i18n.t(`share:widgets.${kind === 'plan' ? 'noPlan' : kind === 'attention' ? 'noActions' : 'noReply'}`));
        if (state === 'populated') expect(serialized).toContain(kind === 'plan' ? 'Actual next step' : kind === 'attention' ? 'edit: src/main.ts' : 'Reply one');
        if (state === 'hidden') {
          expect(serialized).not.toMatch(/Reply |Actual next step|Following step|src\/main/);
          expect(serialized).toContain(i18n.t(kind === 'plan' ? 'share:widgets.step' : 'share:widgets.hidden', { index: 2 }));
        }
        if (state === 'completed' && kind === 'plan') expect(texts).toContain(i18n.t('share:widgets.completed'));
      }
    }
    const localized = buildWidgetTree(jsx(SessionWidget, { snapshot: { ...data, language: 'es' }, scheme: 'light' }));
    expect(localized.props.accessibilityLabel).toBe(i18n.getFixedT('es')('share:widgets.replies'));
    expect(text(localized)).toContain(i18n.getFixedT('es')('share:widgets.updated', { time: formatTimestamp(now, 'es') }));
  });

  function nativeRuntime(dev = false) {
    const widget = renderer(dev);
    const placed = widget.WIDGET_NAMES.flatMap((widgetName: string, index: number) => (index ? [300] : [140, 300]).map((height, row) => ({ widgetName, widgetId: index * 10 + row, height, width: 300 })));
    const native = { getWidgetInfo: vi.fn(async (name: string) => placed.filter((info: any) => info.widgetName === name)), drawWidgetById: vi.fn() };
    const boundary = { '../AndroidWidget': { AndroidWidget: native } };
    let task: any;
    const platform = { Platform: { OS: 'android' }, AppRegistry: { registerHeadlessTask: vi.fn((_key, factory) => { task = factory(); }) } };
    const library = {
      ...primitives,
      ...loadModule(`${libraryRoot}api/get-widget-info.js`, boundary),
      ...loadModule(`${libraryRoot}api/request-widget-update-by-id.js`, boundary),
      ...loadModule(`${libraryRoot}api/register-widget-task-handler.js`, { ...boundary, 'react-native': platform }),
    };
    const imports = { 'react-native-android-widget': library, 'react-native': platform, '@/widgets/session-widget': widget };
    const bridge = (os = 'android', ownership = 'standalone', e2eMode = false) => loadModule('lib/widgets.tsx', {
      ...imports, 'react-native': { Platform: { OS: os } }, 'expo-constants': { appOwnership: ownership, expoConfig: { extra: { e2eMode } } },
    }, dev, os);
    const storage = { getItem: vi.fn(async (key: string) => key === storageKeys.WIDGET_SNAPSHOT_STORAGE_KEY ? JSON.stringify(snapshot()) : JSON.stringify({ showWidgetPreviews: false, language: 'en' })) };
    const snapshotStorage = loadModule('providers/widget-snapshot-storage.ts', {
      '@react-native-async-storage/async-storage': storage, '@/lib/storage-keys': storageKeys,
      '@/providers/widget-snapshot': { hideWidgetPreviews, parseWidgetSnapshot },
    }, dev);
    loadModule('widgets/session-widget-task.tsx', { ...imports, '@/providers/widget-snapshot-storage': snapshotStorage }, dev);
    return { native, bridge, placed, storage, task: () => task };
  }

  it.each([true, false])('dispatches foreground and headless updates with native boundaries only, dev=%s', async (dev) => {
    const runtime = nativeRuntime(dev);
    await runtime.bridge().updateHomeWidget(snapshot());
    expect(runtime.native.drawWidgetById).toHaveBeenCalledTimes(runtime.placed.length);
    for (const [config, name, id] of runtime.native.drawWidgetById.mock.calls) {
      expect(runtime.placed).toContainEqual(expect.objectContaining({ widgetName: name, widgetId: id }));
      for (const scheme of ['light', 'dark']) expect(text(config[scheme]).length).toBeGreaterThan(1);
    }
    runtime.native.drawWidgetById.mockClear();
    for (const info of runtime.placed) for (const widgetAction of ['WIDGET_ADDED', 'WIDGET_UPDATE', 'WIDGET_RESIZED']) {
      await runtime.task()({ ...info, widgetAction });
    }
    expect(runtime.native.drawWidgetById).toHaveBeenCalledTimes(runtime.placed.length * 3);
    expect(runtime.storage.getItem).toHaveBeenCalledWith(storageKeys.WIDGET_SNAPSHOT_STORAGE_KEY);
    expect(runtime.storage.getItem).toHaveBeenCalledWith(storageKeys.CHAT_PREFERENCES_STORAGE_KEY);
    for (const [config, name] of runtime.native.drawWidgetById.mock.calls) {
      expect(JSON.stringify(config)).not.toMatch(/Reply |Actual next step|src\/main/);
      expect(text(config.light).length).toBeGreaterThan(1);
      expect(text(config.light)).toContain('one');
      expect(text(config.light).join('\n')).toContain(i18n.t(name === 'PlanWidget' ? 'share:widgets.step' : 'share:widgets.hidden', { index: 2 }));
    }
    runtime.native.drawWidgetById.mockClear();
    await runtime.task()({ ...runtime.placed[0], widgetAction: 'WIDGET_DELETED' });
    await runtime.task()({ ...runtime.placed[0], widgetName: 'UnknownWidget', widgetAction: 'WIDGET_UPDATE' });
    expect(runtime.native.drawWidgetById).not.toHaveBeenCalled();
    runtime.storage.getItem.mockResolvedValue(null);
    await runtime.task()({ ...runtime.placed[0], widgetAction: 'WIDGET_UPDATE' });
    expect(text(runtime.native.drawWidgetById.mock.calls[0][0].light)).toContain(i18n.t('share:widgets.noReply'));
  });

  it('awaits every placed instance and catches individual failures without skipping other widgets', async () => {
    const runtime = nativeRuntime();
    const original = runtime.native.getWidgetInfo.getMockImplementation()!;
    const delayed = deferred();
    let calls = 0;
    runtime.native.getWidgetInfo.mockImplementation((name: string) => name === 'SessionWidget' && ++calls > 1 ? delayed.promise : original(name));
    runtime.native.drawWidgetById.mockImplementation((_config, _name, id) => { if (id === 0) throw new Error('native dispatch failed'); });
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      let finished = false;
      const pending = runtime.bridge().updateHomeWidget(snapshot()).then(() => { finished = true; });
      await vi.waitFor(() => expect(runtime.native.drawWidgetById).toHaveBeenCalledTimes(2));
      expect(finished).toBe(false);
      delayed.resolve(runtime.placed.filter((info: any) => info.widgetName === 'SessionWidget'));
      await pending;
      expect(runtime.native.drawWidgetById).toHaveBeenCalledTimes(4);
      expect(warning).toHaveBeenCalledWith('Could not update the home widget.', 'SessionWidget', 0, expect.any(Error));
      runtime.native.getWidgetInfo.mockImplementation((name: string) => name === 'SessionWidget' ? Promise.reject(new Error('lookup failed')) : original(name));
      runtime.native.drawWidgetById.mockClear();
      await runtime.bridge().updateHomeWidget(snapshot());
      expect(runtime.native.drawWidgetById).toHaveBeenCalledTimes(2);
      expect(warning).toHaveBeenCalledWith('Could not list the home widgets.', 'SessionWidget', expect.any(Error));
      runtime.native.getWidgetInfo.mockImplementation(original);
      runtime.native.drawWidgetById.mockReset();
      const data = snapshot();
      await runtime.bridge().updateHomeWidget({ ...data, plan: { ...data.plan, steps: null } });
      expect(runtime.native.drawWidgetById).toHaveBeenCalledTimes(3);
      expect(runtime.native.drawWidgetById.mock.calls.map(([, name]) => name)).not.toContain('PlanWidget');
      expect(warning).toHaveBeenCalledWith('Could not update the home widget.', 'PlanWidget', 20, expect.objectContaining({ message: expect.stringContaining('slice') }));
    } finally { warning.mockRestore(); }
  });

  it('does not dispatch widgets on web, Expo Go or E2E', async () => {
    const runtime = nativeRuntime();
    for (const args of [['web'], ['android', 'expo'], ['android', 'standalone', true]] as any[]) await runtime.bridge(...args).updateHomeWidget(snapshot());
    expect(runtime.native.getWidgetInfo).not.toHaveBeenCalled();
    expect(runtime.native.drawWidgetById).not.toHaveBeenCalled();
  });
});
