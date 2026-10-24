import { describe, expect, it, vi } from 'vitest';
import { deferred, hookRuntime, loadTs } from '../helpers/runtime.mjs';
import { listPendingInteractions } from '@/lib/opencode/client/interactions';

async function mountDraft(sessionId = 's') {
  const runtime = hookRuntime();
  const sharing = await loadTs('lib/share/parse.ts', { '@/lib/attachment-preview': {} });
  const presentation = new Map();
  const retained = await loadTs('components/ui/use-retained-state.ts', { react: runtime.react, '@/providers/workspace-context': { useWorkspaces: () => ({ presentation }) } });
  const { useChatDraft } = await loadTs('components/chat/use-chat-draft.ts', { react: runtime.react, '@/lib/share/parse': sharing, '@/components/ui/use-retained-state': retained });
  runtime.mount(({ owner, sessionId }: any) => useChatDraft(owner, sessionId), { owner: 'server:/repo', sessionId });
  return Object.assign(runtime, { presentation });
}

describe('composer admission races', () => {
  it('preserves newer text and files, then explicitly merges a failed input once', async () => {
    const runtime = await mountDraft();
    const a = { uri: 'file:///a', filename: 'a.txt' }, b = { uri: 'file:///b', filename: 'b.txt' };
    runtime.value.setDraft('A'); runtime.value.setAttachments([a]); runtime.flush();
    const pending = runtime.value.capture(); pending.clear('s'); runtime.flush();
    runtime.value.setDraft('B'); runtime.value.setAttachments([b]);
    pending.restore('s'); runtime.flush();
    expect(runtime.value.draft).toBe('B'); expect(runtime.value.attachments).toEqual([b]);
    expect(runtime.value.hasFailedInput).toBe(true);
    runtime.value.recoverFailedInput(); runtime.flush();
    expect(runtime.value.draft).toBe('B\n\nA'); expect(runtime.value.attachments).toEqual([b, a]);
    runtime.value.recoverFailedInput(); runtime.flush();
    expect(runtime.value.draft).toBe('B\n\nA'); runtime.unmount();
  });
  it('guards pre-bootstrap edits, restores untouched failures and respects session/connection changes', async () => {
    const runtime = await mountDraft();
    runtime.value.setDraft('A'); const pending = runtime.value.capture();
    runtime.value.setDraft('B'); pending.clear('s'); runtime.flush();
    expect(runtime.value.draft).toBe('B');
    const unchanged = runtime.value.capture(); unchanged.clear('s'); unchanged.restore('s'); runtime.flush();
    expect(runtime.value.draft).toBe('B'); expect(runtime.value.hasFailedInput).toBe(false);
    runtime.update({ sessionId: 'other' });
    expect(pending.restore('s')).toBe(false);
    runtime.update({ sessionId: 's', owner: 'another-server:/repo' });
    expect(pending.restore('s')).toBe(false); runtime.unmount();
  });
  it('allows bootstrap to choose a new session and retains a command override on failure', async () => {
    const runtime = await mountDraft(undefined as any);
    runtime.update({ sessionId: undefined });
    const pending = runtime.value.capture('/command');
    runtime.update({ sessionId: 'new' }); pending.clear('new'); pending.restore('new'); runtime.flush();
    expect(runtime.value.draft).toBe('/command'); runtime.unmount();
  });
  it('adopts pre-bootstrap edits without leaving a hidden stale draft', async () => {
    const runtime = await mountDraft();
    runtime.update({ sessionId: undefined });
    runtime.value.setDraft('A'); const pending = runtime.value.capture();
    runtime.value.setDraft('B'); runtime.flush();
    runtime.update({ sessionId: 'new' });
    expect(runtime.value.draft).toBe('B');
    pending.clear('new'); pending.restore('new'); runtime.flush();
    expect(runtime.value.draft).toBe('B');
    runtime.value.recoverFailedInput(); runtime.flush();
    expect(runtime.value.draft).toBe('B\n\nA');
    runtime.value.capture().clear('new'); runtime.flush();
    expect([...runtime.presentation.values()].some((value) => value?.draft)).toBe(false);
    runtime.unmount();
  });
  it('keeps failed-input ownership across credential rotation on the same Cloud Link machine', async () => {
    const scopes = await loadTs('lib/connection-scope.ts', { 'base-64': { encode: (value: string) => Buffer.from(value, 'binary').toString('base64') } });
    const machine = { serverUrl: 'https://machine.test', username: 'device-a', connect: { controlPlaneUrl: 'https://api.opencodecloud.link', machineId: 'machine' } };
    const runtime = await mountDraft();
    runtime.update({ owner: scopes.getConnectionUiScope(machine) });
    runtime.value.setDraft('Keep this'); const pending = runtime.value.capture(); pending.clear('s');
    runtime.update({ owner: scopes.getConnectionUiScope({ ...machine, username: 'device-b' }) });
    expect(pending.restore('s')).toBe(true); runtime.flush(); expect(runtime.value.draft).toBe('Keep this'); runtime.unmount();
  });
});

describe('partial interaction reads', () => {
  it('updates only successful provider surfaces and preserves both maps on total failure', async () => {
    const runtime = hookRuntime();
    const utilities = await loadTs('providers/opencode-provider-utils.ts');
    let result: any = { permissions: undefined, questions: [] };
    const { useProjectRefreshActions } = await loadTs('providers/use-project-refresh-actions.ts', {
      react: runtime.react, '@/lib/opencode/client': { listPendingInteractions: async () => { if (result instanceof Error) throw result; return result; } },
      '@/lib/opencode/transcript': { resolveDiffTurn: () => undefined },
      '@/providers/opencode-provider-utils': utilities, '@/providers/session-cache': {}, '@/providers/services/session-service': {}, '@/providers/services/project-service': {},
    });
    const permissions = vi.fn(), questions = vi.fn();
    runtime.mount(useProjectRefreshActions, { client: {}, isCurrentClient: () => true, setPendingPermissionsBySession: permissions, setPendingQuestionsBySession: questions });
    await runtime.value.refreshPendingInteractions();
    expect(permissions).not.toHaveBeenCalled(); expect(questions).toHaveBeenCalledWith({});
    result = { permissions: [], questions: undefined }; await runtime.value.refreshPendingInteractions();
    expect(permissions).toHaveBeenCalledWith({}); expect(questions).toHaveBeenCalledTimes(1);
    result = new Error('both unavailable'); await expect(runtime.value.refreshPendingInteractions()).rejects.toThrow();
    expect(permissions).toHaveBeenCalledTimes(1); expect(questions).toHaveBeenCalledTimes(1); runtime.unmount();
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
  async function mount() {
    const runtime = hookRuntime(), a = deferred(), b = deferred();
    const notifications = { clearPendingTaskFinishedNotification: vi.fn(async () => true),
      listPendingTaskFinishedNotifications: async () => [], notifyTaskFinished: vi.fn(), trackPendingTaskFinishedNotification: vi.fn(async () => {}) };
    const refresh = vi.fn(async () => []);
    const appearance = await loadTs('constants/appearance.ts');
    const preferences = await loadTs('providers/opencode-preferences.ts', { '@/constants/appearance': appearance });
    const models = await loadTs('providers/opencode-model-selection.ts', { '@/providers/opencode-preferences': preferences });
    const scopes = await loadTs('lib/connection-scope.ts', { 'base-64': { encode: (value: string) => Buffer.from(value, 'binary').toString('base64') } });
    const { usePromptLifecycle } = await loadTs('providers/use-prompt-lifecycle.ts', {
      react: runtime.react, '@/providers/services/session-service': { interruptSession: async () => {}, readSessionSettlement: async () => ({ state: 'finished' }) },
      '@/lib/notification-pending': { pendingNotificationKey: (scope: string, id: string) => `${scope}:${id}` },
      '@/lib/notifications': notifications, '@/providers/opencode-preferences': preferences, '@/providers/opencode-model-selection': models,
      '@/lib/connection-scope': scopes,
      '@/lib/opencode/attachment': { prepareAttachment: async (att: unknown) => att },
    });
    const client = {}, currentClient = { current: client }, submission = { current: { active: false } };
    const settings = { serverUrl: 'http://server', username: '' };
    const input = { client, isCurrentClient: (candidate: object) => candidate === currentClient.current, activeProjectPath: '/repo', connectionScope: scopes.getConnectionScope(settings),
      sessions: [{ id: 's', title: 'chat' }], sessionStatuses: {}, availableModels: [], chatPreferences: preferences.defaultChatPreferences,
      settingsRef: { current: settings }, busyNotificationsRef: { current: new Set() }, promptSubmissionRef: submission,
      setSelectedDiffMessageBySession: vi.fn(), refreshSessions: refresh, refreshMessages: refresh,
      refreshSessionDiff: refresh, refreshSessionTodos: refresh, scheduleSessionRefresh: vi.fn(), summarizeSessionTitle: vi.fn(),
      submitPrompt: vi.fn().mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise),
    };
    runtime.mount(usePromptLifecycle, input);
    return { runtime, a, b, notifications, submission, input, currentClient, scopes };
  }
  it.each(['resolve', 'reject'])('keeps B active when aborted A later %ss', async (outcome) => {
    const { runtime, a, b, notifications, submission, input } = await mount();
    const first = runtime.value.sendPrompt('s', 'A'); const handled = first.catch(() => false);
    await runtime.settle(); await runtime.value.abortSession('s'); await runtime.settle();
    const second = runtime.value.sendPrompt('s', 'B'); await runtime.settle();
    const newer = submission.current;
    if (outcome === 'resolve') a.resolve(); else a.reject(new Error('A rejected'));
    await handled; await runtime.settle();
    expect(submission.current).toBe(newer); expect(submission.current.active).toBe(true);
    expect(runtime.value.sendingState.active).toBe(true); expect(runtime.value.promptError).toBeUndefined();
    const stamps = notifications.trackPendingTaskFinishedNotification.mock.calls.map(([record]: any) => record.requestedAt);
    expect(stamps[1]).toBeGreaterThan(stamps[0]);
    if (outcome === 'reject') expect(notifications.clearPendingTaskFinishedNotification).toHaveBeenLastCalledWith(input.connectionScope, 's', stamps[0]);
    b.resolve(); expect(await second).toBe(true); await runtime.settle();
    expect(input.submitPrompt).toHaveBeenCalledTimes(2); expect(runtime.value.sendingState.active).toBe(false); runtime.unmount();
  });
  it('does not show a late failure on a switched connection', async () => {
    const { runtime, a, currentClient, submission, notifications } = await mount();
    const staleSend = runtime.value.sendPrompt;
    const sending = staleSend('s', 'A').catch(() => false); await runtime.settle();
    currentClient.current = {};
    runtime.update({ client: currentClient.current, connectionScope: 'other' });
    a.reject(new Error('old connection failed')); await sending; await runtime.settle();
    expect(runtime.value.promptError).toBeUndefined(); expect(submission.current.active).toBe(false);
    const count = notifications.trackPendingTaskFinishedNotification.mock.calls.length;
    expect(await staleSend('s', 'stale')).toBe(false);
    expect(notifications.trackPendingTaskFinishedNotification).toHaveBeenCalledTimes(count); runtime.unmount();
  });
  it('does not clear B when an abort of admitted A finishes late', async () => {
    const { runtime, a, b, notifications, submission, input } = await mount();
    const first = runtime.value.sendPrompt('s', 'A'); await runtime.settle(); a.resolve(); await first; await runtime.settle();
    const gate = deferred(); notifications.clearPendingTaskFinishedNotification.mockReturnValueOnce(gate.promise);
    const stop = runtime.value.abortSession('s');
    const second = runtime.value.sendPrompt('s', 'B'); await runtime.settle();
    const stamps = notifications.trackPendingTaskFinishedNotification.mock.calls.map(([record]: any) => record.requestedAt);
    expect(notifications.clearPendingTaskFinishedNotification).toHaveBeenCalledWith(input.connectionScope, 's', stamps[0]);
    const newer = submission.current; gate.resolve(); await stop; await runtime.settle();
    expect(submission.current).toBe(newer); expect(runtime.value.sendingState.active).toBe(true);
    b.resolve(); await second; runtime.unmount();
  });
  it('cleans a canceled submission after its notification record moves to a renewed Cloud Link scope', async () => {
    const { runtime, notifications, submission, input, currentClient, scopes } = await mount();
    const settings: any = { serverUrl: 'https://machine.test', username: 'device-a', connect: { controlPlaneUrl: 'https://api.opencodecloud.link', machineId: 'machine' } };
    input.settingsRef.current = settings;
    const oldScope = scopes.getConnectionScope(settings);
    runtime.update({ connectionScope: oldScope });
    const gate = deferred(); notifications.trackPendingTaskFinishedNotification.mockReturnValueOnce(gate.promise);
    const sending = runtime.value.sendPrompt('s', 'A'); await runtime.settle();
    input.settingsRef.current = { ...settings, username: 'device-b' };
    const nextScope = scopes.getConnectionScope(input.settingsRef.current);
    currentClient.current = {}; runtime.update({ client: currentClient.current, connectionScope: nextScope });
    gate.resolve(); expect(await sending).toBe(false); await runtime.settle();
    const stamp = notifications.trackPendingTaskFinishedNotification.mock.calls[0][0].requestedAt;
    expect(notifications.clearPendingTaskFinishedNotification).toHaveBeenCalledWith(oldScope, 's', stamp);
    expect(notifications.clearPendingTaskFinishedNotification).toHaveBeenCalledWith(nextScope, 's', stamp);
    expect(input.submitPrompt).not.toHaveBeenCalled(); expect(submission.current.active).toBe(false); runtime.unmount();
  });
});
