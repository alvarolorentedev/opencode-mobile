// @vitest-environment happy-dom

import '../../tests/helpers/native-view-hosts';
import '../../tests/helpers/native-animation';
import { cloudLinkPlatform } from '../../tests/helpers/cloud-link-platform';
import { act, createElement, type PropsWithChildren } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { sessionRefreshCommands } from '@/features/sessions/services/session-refresh';
import type { ScopedOpencodeClient } from '@/shared/protocol/opencode/client';
import { projectQueryKey } from '@/shared/server-data/keys';
import { listPendingInteractions } from '@/shared/protocol/opencode/client/interactions';
import { getConnectionScope, getConnectionUiScope } from '@/shared/contracts/connection-scope';
import { createAppStore } from '@/runtime/core/store';
import { AppCoreProvider, type AppCore } from '@/runtime/core';
import { useChatDraft } from '@/features/chat/ui/use-chat-draft';
import * as notificationRuntime from '@/features/notifications/runtime';
import { PENDING_NOTIFICATION_SESSIONS_STORAGE_KEY } from '@/shared/storage/keys';
import { deferred, settleReact } from '../../tests/helpers/controlled-clock';
import { renderHook } from '../../tests/helpers/render-hook';
import { promptFixture } from './real-prompt-fixture';

vi.mock('expo-router', () => ({ usePathname: () => '/' }));
vi.mock('expo-clipboard', () => ({}));
vi.mock('expo-image-picker', () => ({}));
vi.mock('expo-document-picker', () => ({}));
vi.mock('expo-sharing', () => ({}));

beforeEach(() => { cloudLinkPlatform.preferences.clear(); });
afterEach(() => {
  cloudLinkPlatform.beforePreferenceRead = undefined;
  cloudLinkPlatform.afterPreferenceWrite = undefined;
  vi.restoreAllMocks();
});

function mountDraft(sessionId = 's') {
  const store = createAppStore({
    settings: { serverUrl: 'http://server', username: '', password: '', directory: '' },
    chatPreferences: {} as never, controlPlaneUrl: '',
  });
  function Core({ children }: PropsWithChildren) {
    return createElement(AppCoreProvider, { core: { store } as AppCore }, children);
  }
  let input: { owner: string; sessionId?: string } = { owner: 'server:/repo', sessionId };
  const driver = renderHook(({ owner, sessionId }: typeof input) => useChatDraft(owner, sessionId), input, Core);
  return {
    get value() { return driver.result.current; },
    update(patch: Partial<typeof input>) { input = { ...input, ...patch }; driver.rerender(input); },
    unmount: driver.unmount, presentation: store.getState().presentation,
  };
}

describe('composer admission races', () => {
  it('preserves newer text and files, then explicitly merges a failed input once', async () => {
    const runtime = mountDraft();
    const a = { uri: 'file:///a', filename: 'a.txt' }, b = { uri: 'file:///b', filename: 'b.txt' };
    act(() => { runtime.value.setDraft('A'); runtime.value.setAttachments([a]); });
    const pending = runtime.value.capture(); act(() => { pending.clear('s'); });
    act(() => { runtime.value.setDraft('B'); runtime.value.setAttachments([b]); pending.restore('s'); });
    expect(runtime.value.draft).toBe('B'); expect(runtime.value.attachments).toEqual([b]);
    expect(runtime.value.hasFailedInput).toBe(true);
    act(() => { runtime.value.recoverFailedInput(); });
    expect(runtime.value.draft).toBe('B\n\nA'); expect(runtime.value.attachments).toEqual([b, a]);
    act(() => { runtime.value.recoverFailedInput(); });
    expect(runtime.value.draft).toBe('B\n\nA'); runtime.unmount();
  });
  it('guards pre-bootstrap edits, restores untouched failures and respects session/connection changes', async () => {
    const runtime = mountDraft();
    act(() => { runtime.value.setDraft('A'); }); const pending = runtime.value.capture();
    act(() => { runtime.value.setDraft('B'); pending.clear('s'); });
    expect(runtime.value.draft).toBe('B');
    const unchanged = runtime.value.capture(); act(() => { unchanged.clear('s'); unchanged.restore('s'); });
    expect(runtime.value.draft).toBe('B'); expect(runtime.value.hasFailedInput).toBe(false);
    runtime.update({ sessionId: 'other' });
    expect(pending.restore('s')).toBe(false);
    runtime.update({ sessionId: 's', owner: 'another-server:/repo' });
    expect(pending.restore('s')).toBe(false); runtime.unmount();
  });
  it('allows bootstrap to choose a new session and retains a command override on failure', async () => {
    const runtime = mountDraft();
    runtime.update({ sessionId: undefined });
    const pending = runtime.value.capture('/command');
    runtime.update({ sessionId: 'new' }); act(() => { pending.clear('new'); pending.restore('new'); });
    expect(runtime.value.draft).toBe('/command'); runtime.unmount();
  });
  it('adopts pre-bootstrap edits without leaving a hidden stale draft', async () => {
    const runtime = mountDraft();
    runtime.update({ sessionId: undefined });
    act(() => { runtime.value.setDraft('A'); }); const pending = runtime.value.capture();
    act(() => { runtime.value.setDraft('B'); });
    runtime.update({ sessionId: 'new' });
    expect(runtime.value.draft).toBe('B');
    act(() => { pending.clear('new'); pending.restore('new'); });
    expect(runtime.value.draft).toBe('B');
    act(() => { runtime.value.recoverFailedInput(); });
    expect(runtime.value.draft).toBe('B\n\nA');
    act(() => { runtime.value.capture().clear('new'); });
    expect([...runtime.presentation.values()].some((value) => (value as { draft?: string } | undefined)?.draft)).toBe(false);
    runtime.unmount();
  });
  it('keeps failed-input ownership across credential rotation on the same Cloud Link machine', async () => {
    const machine = { serverUrl: 'https://machine.test', username: 'device-a', connect: { controlPlaneUrl: 'https://api.opencodecloud.link', machineId: 'machine' } };
    const runtime = mountDraft();
    runtime.update({ owner: getConnectionUiScope(machine) });
    act(() => { runtime.value.setDraft('Keep this'); }); const pending = runtime.value.capture(); act(() => { pending.clear('s'); });
    runtime.update({ owner: getConnectionUiScope({ ...machine, username: 'device-b' }) });
    act(() => { expect(pending.restore('s')).toBe(true); }); expect(runtime.value.draft).toBe('Keep this'); runtime.unmount();
  });
});

describe('partial interaction reads', () => {
  it('updates only successful provider surfaces and preserves both maps on total failure', async () => {
    const cache = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
    const identity = { connectionId: 'direct', connectionScope: 'scope', authRevision: 0 };
    const permissions = vi.fn(async () => ({ data: [] }));
    const questions = vi.fn(async () => ({ data: [] }));
    const client = { __opencode: { contract: 'v1', directory: '/repo' },
      compatibility: { permission: { list: permissions }, question: { list: questions } } } as unknown as ScopedOpencodeClient;
    const key = projectQueryKey(identity, client, 'pending-interactions');
    const initial = { permissions: { s: [{ id: 'p' }] }, questions: { s: [{ id: 'q' }] } };
    cache.setQueryData(key, initial);
    const commands = sessionRefreshCommands({ cache, identity, client, isCurrent: () => true, clock: Date.now, isPermissionReplyPending: () => false });

    permissions.mockRejectedValueOnce(new Error('permissions unavailable'));
    await commands.refreshPendingInteractions();
    expect(cache.getQueryData(key)).toEqual({ permissions: initial.permissions, questions: {} });
    expect(cache.getQueryState(key)?.dataUpdateCount).toBe(2);

    questions.mockRejectedValueOnce(new Error('questions unavailable'));
    await commands.refreshPendingInteractions();
    expect(cache.getQueryData(key)).toEqual({ permissions: {}, questions: {} });
    expect(cache.getQueryState(key)?.dataUpdateCount).toBe(3);

    permissions.mockRejectedValueOnce(new Error('both unavailable'));
    questions.mockRejectedValueOnce(new Error('both unavailable'));
    await expect(commands.refreshPendingInteractions()).rejects.toThrow('both unavailable');
    expect(cache.getQueryState(key)?.dataUpdateCount).toBe(3);
    cache.clear();
  });
  it.each(['permissions', 'questions'])('leaves unavailable %s undefined while accepting authoritative empty success', async (surface) => {
    const client: any = { compatibility: { permission: { list: async () => ({ data: [] }) }, question: { list: async () => ({ data: [] }) } } };
    client.compatibility[surface === 'permissions' ? 'permission' : 'question'].list = async () => { throw new Error('offline'); };
    const result = await listPendingInteractions(client);
    expect(result[surface as keyof typeof result]).toBeUndefined();
    expect(result[surface === 'permissions' ? 'questions' : 'permissions']).toEqual([]);
    client.compatibility.permission.list = client.compatibility.question.list = async () => { throw new Error('offline'); };
    await expect(listPendingInteractions(client)).rejects.toThrow('offline');
  });
});

describe('prompt submission ownership', () => {
  function mount() {
    const a = deferred<undefined>(), b = deferred<undefined>();
    const notifications = {
      clear: vi.spyOn(notificationRuntime, 'clearPendingTaskFinishedNotification'),
      track: vi.spyOn(notificationRuntime, 'trackPendingTaskFinishedNotification'),
    };
    const submitPrompt = vi.fn().mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
    const fixture = promptFixture({ submitPrompt, activeProjectPath: '/repo' });
    return { ...fixture, a, b, notifications, settle: settleReact };
  }
  it.each(['resolve', 'reject'])('keeps B active when aborted A later %ss', async (outcome) => {
    const { runtime, a, b, notifications, submission, input } = mount();
    const first = runtime.value.sendPrompt('s', 'A'); const handled = first.catch(() => false);
    await runtime.settle(); await runtime.value.abortSession('s'); await runtime.settle();
    const second = runtime.value.sendPrompt('s', 'B'); await runtime.settle();
    const newer = submission.current;
    if (outcome === 'resolve') a.resolve(undefined); else a.reject(new Error('A rejected'));
    await handled; await runtime.settle();
    expect(submission.current).toBe(newer); expect(submission.current.active).toBe(true);
    expect(runtime.value.sendingState.active).toBe(true); expect(runtime.value.promptError).toBeUndefined();
    const stamps = notifications.track.mock.calls.map(([record]: any) => record.requestedAt);
    expect(stamps[1]).toBeGreaterThan(stamps[0]);
    if (outcome === 'reject') expect(notifications.clear).toHaveBeenLastCalledWith(input.connectionScope, 's', stamps[0]);
    b.resolve(undefined); expect(await second).toBe(true); await runtime.settle();
    expect(input.submitPrompt).toHaveBeenCalledTimes(2); expect(runtime.value.sendingState.active).toBe(false); runtime.unmount();
  });
  it('does not show a late failure on a switched connection', async () => {
    const { runtime, a, currentClient, submission, notifications } = mount();
    const staleSend = runtime.value.sendPrompt;
    const sending = staleSend('s', 'A').catch(() => false); await runtime.settle();
    currentClient.current = { ...currentClient.current };
    runtime.update({ client: currentClient.current, connectionScope: 'other' });
    a.reject(new Error('old connection failed')); await sending; await runtime.settle();
    expect(runtime.value.promptError).toBeUndefined(); expect(submission.current.active).toBe(false);
    const count = notifications.track.mock.calls.length;
    expect(await staleSend('s', 'stale')).toBe(false);
    expect(notifications.track).toHaveBeenCalledTimes(count); runtime.unmount();
  });
  it('does not clear B when an abort of admitted A finishes late', async () => {
    const { runtime, a, b, notifications, submission, input } = mount();
    const first = runtime.value.sendPrompt('s', 'A'); await runtime.settle(); a.resolve(undefined); await first; await runtime.settle();
    const gate = deferred<void>();
    cloudLinkPlatform.beforePreferenceRead = async (key) => {
      if (key !== PENDING_NOTIFICATION_SESSIONS_STORAGE_KEY) return;
      cloudLinkPlatform.beforePreferenceRead = undefined;
      await gate.promise;
    };
    const stop = runtime.value.abortSession('s');
    const second = runtime.value.sendPrompt('s', 'B'); await runtime.settle();
    const stamps = notifications.track.mock.calls.map(([record]: any) => record.requestedAt);
    expect(notifications.clear).toHaveBeenCalledWith(input.connectionScope, 's', stamps[0]);
    const newer = submission.current; gate.resolve(); await stop; await runtime.settle();
    expect(submission.current).toBe(newer); expect(runtime.value.sendingState.active).toBe(true);
    b.resolve(undefined); await second; runtime.unmount();
  });
  it('cleans a canceled submission after its notification record moves to a renewed Cloud Link scope', async () => {
    const { runtime, notifications, submission, input, currentClient, settingsRef } = mount();
    const settings: any = { serverUrl: 'https://machine.test', username: 'device-a', connect: { controlPlaneUrl: 'https://api.opencodecloud.link', machineId: 'machine' } };
    settingsRef.current = settings;
    const oldScope = getConnectionScope(settings);
    runtime.update({ connectionScope: oldScope });
    const gate = deferred<void>();
    cloudLinkPlatform.afterPreferenceWrite = async (key, value) => {
      if (key !== PENDING_NOTIFICATION_SESSIONS_STORAGE_KEY) return;
      cloudLinkPlatform.afterPreferenceWrite = undefined;
      await gate.promise;
      const records = notificationRuntime.parsePendingNotificationSessions(value);
      const record = Object.values(records)[0]!;
      const rotated = { ...record, connectionScope: getConnectionScope(settingsRef.current) };
      cloudLinkPlatform.preferences.set(key, notificationRuntime.serializePendingNotificationSessions({
        ...records, [notificationRuntime.pendingNotificationKey(rotated.connectionScope, record.sessionId)]: rotated,
      }));
    };
    const sending = runtime.value.sendPrompt('s', 'A'); await runtime.settle();
    settingsRef.current = { ...settings, username: 'device-b' };
    const nextScope = getConnectionScope(settingsRef.current);
    currentClient.current = { ...currentClient.current }; runtime.update({ client: currentClient.current, connectionScope: nextScope });
    gate.resolve(); expect(await sending).toBe(false); await runtime.settle();
    const stamp = notifications.track.mock.calls[0][0].requestedAt;
    expect(notifications.clear).toHaveBeenCalledWith(oldScope, 's', stamp);
    expect(notifications.clear).toHaveBeenCalledWith(nextScope, 's', stamp);
    expect(input.submitPrompt).not.toHaveBeenCalled(); expect(submission.current.active).toBe(false); runtime.unmount();
  });
});
