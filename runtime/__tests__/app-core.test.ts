import { describe, expect, it, vi } from 'vitest';

import { createAppCore } from '@/runtime/core/create-app-core';
import type { WorkspaceSnapshot } from '@/runtime/workspace/workspace-types';
import type { ChatPreferences } from '@/shared/preferences/opencode-preferences';
import { workspaceKey, type WorkspaceTarget } from '@/shared/contracts/workspace';

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
});
