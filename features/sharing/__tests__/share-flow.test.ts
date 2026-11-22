// @vitest-environment happy-dom

import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deferred, controlledClock, settleReact } from '../../../tests/helpers/controlled-clock';
import { renderHook } from '../../../tests/helpers/render-hook';
import { i18n } from '@/shared/i18n/index';
import { useShareState } from '@/features/sharing/state/use-share-state';
import { redirectSystemPath } from '@/features/sharing/model/native-intent';
import { mergeSharedDraft, parseIncomingShare, type IncomingShareItem } from '@/features/sharing/model/parse';

vi.mock('expo/fetch', () => ({ fetch: (...args: any[]) => (globalThis.fetch as any)(...args) }));
const native = vi.hoisted(() => ({
  getSharedPayloads: vi.fn(),
  getResolvedSharedPayloadsAsync: vi.fn(),
  clearSharedPayloads: vi.fn(),
  listener: undefined as ((state: string) => void) | undefined,
}));
vi.mock('react-native', () => ({
  Platform: { OS: 'android' },
  AppState: { addEventListener: (_: string, callback: NonNullable<typeof native.listener>) => {
    native.listener = callback;
    return { remove() { native.listener = undefined; } };
  } },
}));
vi.mock('expo-sharing', () => native);
vi.mock('expo-localization', () => ({ getLocales: () => [{ languageTag: 'en-US' }] }));

const item: IncomingShareItem = { value: 'content://1', shareType: 'image', contentUri: 'file:/cache/one%20photo.png', contentType: 'image', originalName: 'photo.png', contentSize: 100 };
type Input = Parameters<typeof useShareState>[0];
let runtime: ReturnType<typeof renderHook<Input, ReturnType<typeof useShareState>>>;
let input: Input;
let clock: ReturnType<typeof controlledClock>;

function update(patch: Partial<Input>) {
  input = { ...input, ...patch };
  runtime.rerender(input);
}

function add() {
  let pending!: Promise<boolean>;
  act(() => { pending = runtime.result.current.addToChat(); });
  return pending;
}

async function addAndSettle() {
  let result = false;
  await act(async () => { result = await runtime.result.current.addToChat(); });
  return result;
}

async function mount(patch: Partial<Input> = {}) {
  clock = controlledClock(1000);
  const sessions = [
    { id: 'current', directory: '/repo', title: 'Current', time: { created: 0, updated: 0 } },
    { id: 'other', directory: '/other', title: 'Other', time: { created: 0, updated: 0 } },
  ] as Input['sessions'];
  input = {
    hydrated: true, connectionScope: 'server', projectPath: '/repo', currentSessionId: 'current',
    sessions, hideSubagentChats: false, refreshTargets: vi.fn(async () => {}),
    createSession: vi.fn(async () => ({ ...sessions[0], id: 'created' })),
    openSession: vi.fn(async () => ({ ok: true })), ...patch,
  };
  runtime = renderHook(useShareState, input);
  await settleReact();
}
beforeEach(() => {
  native.getSharedPayloads.mockReset().mockReturnValue([item]);
  native.getResolvedSharedPayloadsAsync.mockReset().mockResolvedValue([item]);
  native.clearSharedPayloads.mockReset().mockImplementation(() => native.getSharedPayloads.mockReturnValue([]));
});

describe('confirmed share handoff', () => {
  it('waits for hydration and adopts a delayed current session without creating a chat', async () => {
    await mount({ hydrated: false, currentSessionId: undefined });
    expect(runtime.result.current.target).toBeUndefined();
    update({ hydrated: true });
    update({ currentSessionId: 'restored' });
    expect(runtime.result.current.target?.sessionId).toBe('restored');
    expect(input.createSession).not.toHaveBeenCalled();
    runtime.unmount();
  });
  it('does not consume before Add and consumes the confirmed destination exactly once', async () => {
    await mount();
    const target = runtime.result.current.target!;
    expect(runtime.result.current.consumeShared(target)).toBeNull();
    expect(await addAndSettle()).toBe(true);
    const wrong = { ...target, connectionScope: 'another' };
    expect(runtime.result.current.consumeShared(wrong)).toBeNull();
    expect(runtime.result.current.consumeShared({ ...target, projectPath: '/wrong' })).toBeNull();
    const payload = runtime.result.current.consumeShared(target);
    expect(payload?.attachments[0].uri).toBe('file:///cache/one%20photo.png');
    expect(runtime.result.current.consumeShared(target)).toBeNull();
    expect(native.clearSharedPayloads).toHaveBeenCalledOnce();
    expect(input.openSession).toHaveBeenCalledWith(expect.objectContaining(target), expect.any(AbortSignal));
    runtime.unmount();
  });
  it('selects another project conversation without changing its destination during bootstrap', async () => {
    await mount();
    const other = runtime.result.current.targets[1];
    act(() => runtime.result.current.selectTarget(other));
    update({ currentSessionId: undefined });
    expect(runtime.result.current.target).toEqual(other);
    expect(await addAndSettle()).toBe(true);
    expect(runtime.result.current.consumeShared({ ...other, sessionId: 'current' })).toBeNull();
    expect(runtime.result.current.consumeShared(other)).not.toBeNull();
    expect(input.createSession).not.toHaveBeenCalled();
    runtime.unmount();
  });
  it('creates New chat once and retains it for retry if opening fails', async () => {
    await mount();
    vi.mocked(input.openSession).mockResolvedValueOnce({ ok: false, error: 'offline' });
    act(() => runtime.result.current.selectTarget({ connectionScope: 'server', projectPath: '/repo' }));
    expect(await addAndSettle()).toBe(false);
    expect(runtime.result.current.error).toBe('offline');
    expect(runtime.result.current.pending).not.toBeNull();
    expect(await addAndSettle()).toBe(true);
    expect(input.createSession).toHaveBeenCalledOnce();
    runtime.unmount();
  });
  it('serializes taps and invalidates navigation when discarded', async () => {
    const waiting = deferred<Awaited<ReturnType<Input['openSession']>>>();
    await mount({ openSession: vi.fn(() => waiting.promise) });
    const first = add();
    expect(await addAndSettle()).toBe(false);
    act(() => runtime.result.current.clearShared());
    waiting.resolve({ ok: true });
    expect(await first).toBe(false); await settleReact();
    expect(vi.mocked(input.openSession).mock.calls[0][1]?.aborted).toBe(true);
    expect(runtime.result.current.pending).toBeNull();
    runtime.unmount();
  });
  it('cannot resurrect a receipt discarded while native resolution was running', async () => {
    const waiting = deferred<IncomingShareItem[]>(); native.getResolvedSharedPayloadsAsync.mockReturnValue(waiting.promise);
    await mount();
    expect(runtime.result.current.resolving).toBe(true);
    act(() => runtime.result.current.clearShared());
    waiting.resolve([item]); await settleReact();
    expect(runtime.result.current.pending).toBeNull();
    runtime.unmount();
  });
  it('keeps the receipt on a connection change and rejects the old operation', async () => {
    const waiting = deferred<Awaited<ReturnType<Input['openSession']>>>();
    await mount({ openSession: vi.fn(() => waiting.promise) });
    const operation = add();
    update({ connectionScope: 'new-server', currentSessionId: 'new-chat' });
    waiting.resolve({ ok: true });
    expect(await operation).toBe(false); await settleReact();
    expect(runtime.result.current.pending).not.toBeNull();
    expect(runtime.result.current.target?.connectionScope).toBe('new-server');
    runtime.unmount();
  });
  it('expires staged content and does not reset its lifetime on foreground returns', async () => {
    await mount(); act(() => native.listener?.('active')); await settleReact();
    expect(native.getResolvedSharedPayloadsAsync).toHaveBeenCalledOnce();
    await clock.advance(10 * 60 * 1000);
    expect(runtime.result.current.pending).toBeNull();
    expect(runtime.result.current.emptyReason).toBe('expired');
    runtime.unmount();
  });

  it('records an explicit discard separately from expiry', async () => {
    await mount();
    act(() => runtime.result.current.clearShared());
    expect(runtime.result.current.pending).toBeNull();
    expect(runtime.result.current.emptyReason).toBe('discarded');
    runtime.unmount();
  });

  it('surfaces target loading failures and recovers on retry', async () => {
    const refreshTargets = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
    await mount({ refreshTargets });
    expect(runtime.result.current.targetsLoading).toBe(false);
    expect(runtime.result.current.targetsError).toBe(i18n.t('share:targetsUnavailable'));

    await act(() => runtime.result.current.refreshTargets()); await settleReact();
    expect(runtime.result.current.targetsLoading).toBe(false);
    expect(runtime.result.current.targetsError).toBeUndefined();
    expect(refreshTargets).toHaveBeenCalledTimes(2);
    runtime.unmount();
  });

  it('keeps the picker loading until target refresh settles', async () => {
    const waiting = deferred();
    await mount({ refreshTargets: vi.fn(() => waiting.promise) });
    expect(runtime.result.current.targetsLoading).toBe(true);
    waiting.resolve(undefined); await settleReact();
    expect(runtime.result.current.targetsLoading).toBe(false);
    runtime.unmount();
  });
  it('keeps warnings when every item is rejected and refuses Add', async () => {
    native.getResolvedSharedPayloadsAsync.mockResolvedValue([{ ...item, contentSize: 11 * 1024 * 1024 }]);
    await mount();
    expect(runtime.result.current.pending?.skipped).toEqual(['photo.png']);
    expect(await addAndSettle()).toBe(false);
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
  const waiting = deferred<IncomingShareItem[]>();
  native.getResolvedSharedPayloadsAsync.mockReturnValueOnce(waiting.promise).mockResolvedValue([{ ...item, contentUri: 'file:/cache/second.png' }]);
  await mount();
  native.getSharedPayloads.mockReturnValue([{ ...item, value: 'content://second' }]);
  await act(() => runtime.result.current.refreshShared());
  waiting.resolve([item]); await settleReact();
  expect(native.getResolvedSharedPayloadsAsync).toHaveBeenCalledTimes(2);
  expect(runtime.result.current.pending?.attachments[0].uri).toBe('file:///cache/second.png');
  runtime.unmount();
});

it('routes repeated warm shares with distinct receipt keys and preserves other links', async () => {
  const first = await redirectSystemPath({ path: 'opencodemobile://expo-sharing', initial: false });
  const second = await redirectSystemPath({ path: 'opencodemobile://expo-sharing', initial: false });
  expect(first).toMatch(/^\/share\?receipt=/); expect(second).not.toBe(first);
  expect(await redirectSystemPath({ path: 'opencodemobile://session/one', initial: true })).toBe('opencodemobile://session/one');
});

it('confirms a captured destination on another server even as chat focus changes', async () => {
  const destination = { connectionScope: 'server-b', projectPath: '/repo', sessionId: 'current', title: 'B' };
  const waiting = deferred<Awaited<ReturnType<Input['openSession']>>>();
  await mount({ availableTargets: [destination], openSession: vi.fn(() => waiting.promise) });
  act(() => runtime.result.current.selectTarget(destination));
  const operation = add();
  update({ connectionScope: 'server-b', currentSessionId: 'current' });
  waiting.resolve({ ok: true });
  expect(await operation).toBe(true); await settleReact();
  expect(runtime.result.current.consumeShared({ ...destination, connectionScope: 'server' })).toBeNull();
  expect(runtime.result.current.consumeShared(destination)).not.toBeNull();
  runtime.unmount();
});
