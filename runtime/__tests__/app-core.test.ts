import { describe, expect, it, vi } from 'vitest';

import { createAppCore } from '@/runtime/core/create-app-core';
import type { WorkspaceSnapshot } from '@/runtime/workspace/workspace-types';
import type { ChatPreferences } from '@/shared/preferences/opencode-preferences';
import { workspaceKey, type WorkspaceTarget } from '@/shared/contracts/workspace';
import { projectQueryKey } from '@/shared/server-data/keys';
import type { ScopedOpencodeClient } from '@/shared/protocol/opencode/client';

const protocol = vi.hoisted(() => ({
  replyToPendingPermission: vi.fn(),
  replyToPendingQuestion: vi.fn(),
  rejectPendingQuestion: vi.fn(),
  listPendingInteractions: vi.fn(),
}));

vi.mock('@/shared/protocol/opencode/client', () => ({
  ...protocol,
  withReadSignal: (client: ScopedOpencodeClient) => client,
  listSavedPermissionRules: vi.fn(async () => []),
}));
vi.mock('@/features/sessions/runtime', async () => ({
  approvalsAccess: (await import('@/features/sessions/services/approvals')).approvalsAccess,
  createInteractionCommands: (await import('@/features/sessions/services/interaction-commands')).createInteractionCommands,
  ...(await import('@/features/sessions/services/queries')),
}));

const settings = { serverUrl: 'http://127.0.0.1:4096', username: '', password: '', directory: '' };
const newCore = () => createAppCore({ settings, chatPreferences: {} as ChatPreferences, controlPlaneUrl: '' });

function connectedProject(core: ReturnType<typeof newCore>, connectionId: string, projectPath: string) {
  const target: WorkspaceTarget = { connectionId, projectPath };
  const openSession = vi.fn(async (_id: string) => {});
  const created = { id: 'new-session' };
  const createSession = vi.fn(async () => created);
  const openDeepLinkSession = vi.fn(async (_link: unknown, _signal: AbortSignal) => ({ ok: true }));
  const createWorktree = vi.fn(async (_name?: string) => ({ directory: '/checkout' }));
  const snapshot = {
    enabled: true, catalogSessions: [{ id: 'rendered', directory: projectPath }], suspend: vi.fn(),
    values: {
      connectionValue: { connection: { status: 'connected' } },
      projectsValue: { activeProjectPath: projectPath },
      conversationValue: { conversation: { active: false } },
      currentSessionValue: { openSession, openDeepLinkSession, createSession },
      projectFilesValue: { createWorktree },
      sessionLibraryValue: { sessions: [] },
    },
  } as unknown as WorkspaceSnapshot;
  const commands = core.commands.workspace;
  commands.change((current) => {
    const found = current.some(({ id }) => id === connectionId);
    if (found) return current.map((entry) => entry.id === connectionId ? { ...entry, projects: [...entry.projects, projectPath] } : entry);
    return [...current, { id: connectionId, settings, name: connectionId, enabled: true, preferences: {}, projects: [projectPath] }];
  });
  commands.publish(workspaceKey(target), snapshot);
  return { target, openSession, openDeepLinkSession, createSession, createWorktree, created };
}

describe('app core', () => {
  it('constructs one store and one query cache with injected defaults', async () => {
    const core = newCore();

    core.store.getState().setRegistry({ ready: true });
    core.store.getState().setSelection('["c","/p"]', { currentSessionId: 's' });
    expect(core.store.getState().registry.ready).toBe(true);
    expect(core.store.getState().selection['["c","/p"]'].currentSessionId).toBe('s');

    await core.queryClient.fetchQuery({ queryKey: ['probe'], queryFn: async () => 42 });
    expect(core.queryClient.getQueryData(['probe'])).toBe(42);
    core.commands.workspace.dispose();
    core.queryClient.clear();
  });

  it('keeps terminal and inspection independent and cancels a late external session before committing focus', async () => {
    const core = newCore();
    const commands = core.commands.workspace;
    const a = connectedProject(core, 'a', '/a');
    const b = connectedProject(core, 'b', '/b');
    let finish: (result: { ok: boolean }) => void = () => {};
    const pending = new Promise<{ ok: boolean }>((resolve) => { finish = resolve; });
    let started: () => void = () => {};
    const resolving = new Promise<void>((resolve) => { started = resolve; });
    b.openDeepLinkSession.mockImplementationOnce(() => { started(); return pending; });

    await commands.activate(a.target);
    await commands.inspect(b.target);
    await commands.selectTerminalTarget(b.target);
    expect(core.store.getState().registry).toMatchObject({ focus: a.target, inspectionTarget: b.target, terminalTarget: b.target });
    const staleLink = commands.openExternalSession({ ...b.target, sessionId: 'link' });
    await resolving;
    await commands.navigate({ ...a.target, sessionId: 'rendered' });
    finish({ ok: true });
    await expect(staleLink).rejects.toThrow('This session link was cancelled.');
    expect(a.openSession).toHaveBeenCalledExactlyOnceWith('rendered');
    expect(core.store.getState().registry.focus).toEqual(a.target);
    commands.dispose();
  });

  it('creates and opens worktree chats in the checkout and returns the checkout on session failure', async () => {
    const core = newCore();
    const commands = core.commands.workspace;
    const root = connectedProject(core, 'a', '/root');
    const checkout = connectedProject(core, 'a', '/checkout');
    const target = { connectionId: 'a', projectRoot: '/root', name: 'fix' };
    await expect(commands.createChatInWorktree(target)).resolves.toEqual({ session: checkout.created, checkout: { directory: '/checkout' } });
    expect(root.createWorktree).toHaveBeenCalledExactlyOnceWith('fix');
    expect(root.createSession).not.toHaveBeenCalled();
    expect(checkout.openSession).toHaveBeenCalledExactlyOnceWith(checkout.created.id);
    expect(core.store.getState().registry.focus).toEqual(checkout.target);
    checkout.createSession.mockRejectedValueOnce(new Error('Chat creation failed'));
    await expect(commands.createChatInWorktree(target)).resolves.toEqual({ checkout: { directory: '/checkout' }, error: 'Chat creation failed' });
    commands.dispose();
  });

  it('isolates an in-flight reply by project and rejects writes after credential rotation', async () => {
    const core = newCore();
    const { queryClient, commands: { session } } = core;
    const original = { connectionId: 'server', connectionScope: 'original', authRevision: 0 };
    let identity = original;
    let revision = 0;
    const client = { __opencode: { contract: 'v2', directory: '/a' } } as ScopedOpencodeClient;
    const refreshMessages = vi.fn(async () => undefined);
    const manager = {
      getProjectAccess(projectPath: string) {
        const capturedRevision = revision;
        return { identity, revision, client: { __opencode: { ...client.__opencode, directory: projectPath } },
          isCurrent: () => revision === capturedRevision };
      },
      isDemanded: () => false,
      realtime: { refreshMessages },
    } as unknown as NonNullable<ReturnType<typeof core.connections.get>>;
    vi.spyOn(core.connections, 'get').mockReturnValue(manager);
    const permission = { id: 'p', sessionID: 's' };
    const question = { id: 'q', sessionID: 's' };
    const initial = { permissions: { s: [permission] }, questions: { s: [question] } };
    const key = projectQueryKey(original, client, 'pending-interactions');
    queryClient.setQueryData(key, initial);
    const otherClient = { __opencode: { ...client.__opencode, directory: '/b' } } as ScopedOpencodeClient;
    const otherKey = projectQueryKey(original, otherClient, 'pending-interactions');
    queryClient.setQueryData(otherKey, initial);
    const bound = session.interactions({ connectionId: 'server', projectPath: '/a' }, 0);
    let failReply: (reason: Error) => void = () => {};
    let startReply: () => void = () => {};
    const started = new Promise<void>((resolve) => { startReply = resolve; });
    protocol.replyToPendingPermission.mockImplementationOnce(() => {
      startReply();
      return new Promise<void>((_, reject) => { failReply = reject; });
    });
    const reply = bound.replyToPermission('p', 'once');
    const rejected = expect(reply).rejects.toThrow('revoked');
    await started;
    expect(queryClient.getQueryData(key)).toEqual({ ...initial, permissions: { s: [] } });
    expect(queryClient.getQueryData(otherKey)).toEqual(initial);
    expect(session.isPermissionReplyPending(original, client, 'p')).toBe(true);
    expect(session.isPermissionReplyPending(original, otherClient, 'p')).toBe(false);
    identity = { ...original, connectionScope: 'rotated', authRevision: 1 };
    revision = 1;
    queryClient.removeQueries({ queryKey: key, exact: true });
    failReply(new Error('revoked'));
    await rejected;
    expect(queryClient.getQueryData(key)).toBeUndefined();
    expect(session.isPermissionReplyPending(original, client, 'p')).toBe(false);
    await expect(bound.replyToPermission('p', 'once')).rejects.toThrow('no longer available');
    expect(refreshMessages).not.toHaveBeenCalled();

    const latest = projectQueryKey(identity, client, 'pending-interactions');
    queryClient.setQueryData(latest, initial);
    const current = session.interactions({ connectionId: 'server', projectPath: '/a' }, revision);
    protocol.replyToPendingQuestion.mockResolvedValueOnce(undefined);
    await current.replyToQuestion('q', [['answer']]);
    expect(queryClient.getQueryData(latest)).toEqual({ ...initial, questions: { s: [] } });
    expect(refreshMessages).toHaveBeenCalledExactlyOnceWith('/a', 's', true);
    core.commands.workspace.dispose();
    queryClient.clear();
  });
});
