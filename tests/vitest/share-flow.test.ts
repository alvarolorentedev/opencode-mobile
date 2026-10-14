import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deferred, hookRuntime, loadTs } from '../helpers/runtime.mjs';
import { mergeSharedDraft, parseIncomingShare } from '@/lib/share/parse';

vi.mock('expo/fetch', () => ({ fetch: (...args: any[]) => (globalThis.fetch as any)(...args) }));
vi.mock('@/lib/opencode/client/types', () => ({ defaultConnectionSettings: { serverUrl: 'http://localhost' } }));
vi.mock('react-native', () => ({ Platform: { OS: 'android' } }));
const item = { value: 'content://1', shareType: 'image', contentUri: 'file:/cache/one%20photo.png', contentType: 'image', originalName: 'photo.png', contentSize: 100 };
let runtime: ReturnType<typeof hookRuntime>;
let native: any;
let input: any;
let listener: (state: string) => void;
async function mount(patch = {}) {
  input = { hydrated: true, connectionScope: 'server', projectPath: '/repo', currentSessionId: 'current',
    sessions: [{ id: 'current', directory: '/repo', title: 'Current', time: {} }, { id: 'other', directory: '/other', title: 'Other', time: {} }],
    hideSubagentChats: false, refreshTargets: vi.fn(async () => {}), createSession: vi.fn(async () => ({ id: 'created' })),
    openSession: vi.fn(async () => ({ ok: true })), ...patch };
  const { useShareState } = await loadTs('providers/use-share-state.ts', {
    react: runtime.react, 'expo-sharing': native,
    'react-native': { Platform: { OS: 'android' }, AppState: { addEventListener: (_: string, callback: typeof listener) => { listener = callback; return { remove() {} }; } } },
    '@/lib/i18n': { i18n: { t: (key: string) => key } }, '@/lib/share/parse': { parseIncomingShare },
  }, { ...runtime.globals, Date: class extends Date { static now() { return 1000; } } });
  runtime.mount(useShareState, input);
  await runtime.settle();
}
beforeEach(() => {
  runtime = hookRuntime();
  native = { getSharedPayloads: vi.fn(() => [item]), getResolvedSharedPayloadsAsync: vi.fn(async () => [item]),
    clearSharedPayloads: vi.fn(() => native.getSharedPayloads.mockReturnValue([])) };
});

describe('confirmed share handoff', () => {
  it('waits for hydration and adopts a delayed current session without creating a chat', async () => {
    await mount({ hydrated: false, currentSessionId: undefined });
    expect(runtime.value.target).toBeUndefined();
    runtime.update({ hydrated: true });
    runtime.update({ currentSessionId: 'restored' });
    expect(runtime.value.target.sessionId).toBe('restored');
    expect(input.createSession).not.toHaveBeenCalled();
    runtime.unmount();
  });
  it('does not consume before Add and consumes the confirmed destination exactly once', async () => {
    await mount();
    const target = runtime.value.target;
    expect(runtime.value.consumeShared(target)).toBeNull();
    expect(await runtime.value.addToChat()).toBe(true);
    const wrong = { ...target, connectionScope: 'another' };
    expect(runtime.value.consumeShared(wrong)).toBeNull();
    expect(runtime.value.consumeShared({ ...target, projectPath: '/wrong' })).toBeNull();
    const payload = runtime.value.consumeShared(target);
    expect(payload.attachments[0].uri).toBe('file:///cache/one%20photo.png');
    expect(runtime.value.consumeShared(target)).toBeNull();
    expect(native.clearSharedPayloads).toHaveBeenCalledOnce();
    expect(input.openSession).toHaveBeenCalledWith(expect.objectContaining(target), expect.any(AbortSignal));
    runtime.unmount();
  });
  it('selects another workspace conversation without changing its destination during bootstrap', async () => {
    await mount();
    const other = runtime.value.targets[1];
    runtime.value.selectTarget(other); runtime.flush();
    runtime.update({ currentSessionId: undefined });
    expect(runtime.value.target).toEqual(other);
    expect(await runtime.value.addToChat()).toBe(true);
    expect(runtime.value.consumeShared({ ...other, sessionId: 'current' })).toBeNull();
    expect(runtime.value.consumeShared(other)).not.toBeNull();
    expect(input.createSession).not.toHaveBeenCalled();
    runtime.unmount();
  });
  it('creates New chat once and retains it for retry if opening fails', async () => {
    await mount();
    input.openSession.mockResolvedValueOnce({ ok: false, error: 'offline' });
    runtime.value.selectTarget({ connectionScope: 'server', projectPath: '/repo' }); runtime.flush();
    expect(await runtime.value.addToChat()).toBe(false); runtime.flush();
    expect(runtime.value.error).toBe('offline');
    expect(runtime.value.pending).not.toBeNull();
    expect(await runtime.value.addToChat()).toBe(true);
    expect(input.createSession).toHaveBeenCalledOnce();
    runtime.unmount();
  });
  it('serializes taps and invalidates navigation when discarded', async () => {
    const waiting = deferred();
    await mount({ openSession: vi.fn(() => waiting.promise) });
    const first = runtime.value.addToChat();
    expect(await runtime.value.addToChat()).toBe(false);
    runtime.value.clearShared(); runtime.flush();
    waiting.resolve({ ok: true });
    expect(await first).toBe(false);
    expect(input.openSession.mock.calls[0][1].aborted).toBe(true);
    expect(runtime.value.pending).toBeNull();
    runtime.unmount();
  });
  it('cannot resurrect a receipt discarded while native resolution was running', async () => {
    const waiting = deferred(); native.getResolvedSharedPayloadsAsync.mockReturnValue(waiting.promise);
    await mount();
    expect(runtime.value.resolving).toBe(true);
    runtime.value.clearShared(); runtime.flush();
    waiting.resolve([item]); await runtime.settle();
    expect(runtime.value.pending).toBeNull();
    runtime.unmount();
  });
  it('keeps the receipt on a connection change and rejects the old operation', async () => {
    const waiting = deferred();
    await mount({ openSession: vi.fn(() => waiting.promise) });
    const operation = runtime.value.addToChat();
    runtime.update({ connectionScope: 'new-server', currentSessionId: 'new-chat' });
    waiting.resolve({ ok: true });
    expect(await operation).toBe(false); runtime.flush();
    expect(runtime.value.pending).not.toBeNull();
    expect(runtime.value.target.connectionScope).toBe('new-server');
    runtime.unmount();
  });
  it('expires staged content and does not reset its lifetime on foreground returns', async () => {
    await mount(); listener('active'); await runtime.settle();
    expect(native.getResolvedSharedPayloadsAsync).toHaveBeenCalledOnce();
    runtime.fire(10 * 60 * 1000);
    expect(runtime.value.pending).toBeNull();
    runtime.unmount();
  });
  it('keeps warnings when every item is rejected and refuses Add', async () => {
    native.getResolvedSharedPayloadsAsync.mockResolvedValue([{ ...item, contentSize: 11 * 1024 * 1024 }]);
    await mount();
    expect(runtime.value.pending.skipped).toEqual(['photo.png']);
    expect(await runtime.value.addToChat()).toBe(false);
    runtime.unmount();
  });
});

describe('shared composer content', () => {
  it('preserves a draft, appends both text and URL and deduplicates attachments', () => {
    const payload = { text: 'new text', url: 'https://example.test', attachments: [{ uri: 'file:///1' }, { uri: 'file:///2' }, { uri: 'file:///2' }], skipped: [] };
    expect(mergeSharedDraft('my draft', [{ uri: 'file:///1' }], payload)).toEqual({
      draft: 'my draft\n\nnew text\n\nhttps://example.test', attachments: [{ uri: 'file:///1' }, { uri: 'file:///2' }],
    });
  });
  it.each(['image/png', 'audio/mpeg', 'video/mp4', 'text/plain', 'application/pdf', 'application/zip'])('retains %s files and encoded paths', (mime) => {
    const payload = parseIncomingShare([{ ...item, contentMimeType: mime }]);
    expect(payload?.attachments[0]).toMatchObject({ uri: 'file:///cache/one%20photo.png', mime });
  });
});

it('keeps text/plain and HTML file streams as attachments, including identical display names', () => {
  const payload = parseIncomingShare([
    { value: 'accompanying text', contentType: 'text' },
    { ...item, contentUri: 'file:/cache/a.txt', contentType: 'text', contentMimeType: 'text/plain', originalName: 'same.txt' },
    { ...item, contentUri: 'file:/cache/b.txt', contentType: 'text', contentMimeType: 'text/plain', originalName: 'same.txt' },
    { ...item, contentUri: 'file:/cache/site.html', contentType: 'website', contentMimeType: 'text/html' },
  ]);
  expect(payload?.text).toBe('accompanying text');
  expect(payload?.attachments.map((item) => item.uri)).toEqual(['file:///cache/a.txt', 'file:///cache/b.txt', 'file:///cache/site.html']);
});

it('re-ingests a new intent received while native resolution is pending', async () => {
  const waiting = deferred();
  native.getResolvedSharedPayloadsAsync.mockReturnValueOnce(waiting.promise).mockResolvedValue([{ ...item, contentUri: 'file:/cache/second.png' }]);
  await mount();
  native.getSharedPayloads.mockReturnValue([{ ...item, value: 'content://second' }]);
  await runtime.value.refreshShared();
  waiting.resolve([item]); await runtime.settle();
  expect(native.getResolvedSharedPayloadsAsync).toHaveBeenCalledTimes(2);
  expect(runtime.value.pending.attachments[0].uri).toBe('file:///cache/second.png');
  runtime.unmount();
});

it('routes repeated warm shares with distinct receipt keys and preserves other links', async () => {
  const { redirectSystemPath } = await loadTs('app/+native-intent.ts');
  const first = await redirectSystemPath({ path: 'opencodemobile://expo-sharing', initial: false });
  const second = await redirectSystemPath({ path: 'opencodemobile://expo-sharing', initial: false });
  expect(first).toMatch(/^\/share\?receipt=/); expect(second).not.toBe(first);
  expect(await redirectSystemPath({ path: 'opencodemobile://session/one', initial: true })).toBe('opencodemobile://session/one');
});
