// @vitest-environment happy-dom

import '../helpers/native-view-hosts';
import '../helpers/native-animation';
import { cloudLinkPlatform } from '../helpers/cloud-link-platform';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer, type AddressInfo } from 'node:net';
import { resolve } from 'node:path';
import { act, useLayoutEffect, type PropsWithChildren } from 'react';
import { focusManager, QueryClientProvider } from '@tanstack/react-query';
import { expect, it, onTestFinished, vi } from 'vitest';

import { useChat } from '@/features/chat/context';
import { useProjects } from '@/features/projects/context';
import { useCurrentSession } from '@/features/sessions/context';
import { AppCoreProvider, useAppStore, useConnectionLifecycle, useProjectScope } from '@/runtime/core';
import { useWorkspaceServerData } from '@/runtime/composition/use-workspace-server-data';
import { createConnection } from '@/runtime/connections/create-connection';
import { createAppCore } from '@/runtime/core/create-app-core';
import { getConnectionUiScope } from '@/shared/contracts/connection-scope';
import type { ConnectionRecord } from '@/shared/contracts/workspace';
import { defaultChatPreferences } from '@/shared/preferences/opencode-preferences';
import { settleReact } from '../helpers/controlled-clock';
import { renderHook } from '../helpers/render-hook';

vi.mock('expo-router', () => ({ usePathname: () => '/' }));
vi.mock('expo-clipboard', () => ({}));

async function startServer(scenario: string) {
  const listener = createServer();
  listener.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const { port } = listener.address() as AddressInfo;
  await new Promise<void>((done) => listener.close(() => done()));
  const url = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, [resolve('tests/fake-opencode/server.mjs')], {
    env: { ...process.env, FAKE_OPENCODE_PORT: String(port), FAKE_OPENCODE_SCENARIO: scenario, FAKE_OPENCODE_PASSWORD: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const exited = once(server, 'exit');
  let logs = '';
  server.stderr.on('data', (chunk) => { logs = (logs + chunk).slice(-2000); });
  onTestFinished(async () => {
    if (server.exitCode !== null || server.signalCode !== null) return;
    server.kill('SIGTERM');
    const deadline = setTimeout(() => server.kill('SIGKILL'), 1000);
    try { await exited; } finally { clearTimeout(deadline); }
  });
  await vi.waitFor(async () => {
    expect(server.exitCode, logs).toBeNull();
    expect((await fetch(url + '/api/info')).ok).toBe(true);
  }, { timeout: 5000 });
  return url;
}

function connection(url: string, name: string): ConnectionRecord {
  const settings = { serverUrl: url, username: '', password: '', directory: '' };
  return { id: getConnectionUiScope(settings), name, settings, enabled: true, projects: ['/workspace/demo-project'], preferences: {} };
}

async function streamStatus(url: string, patch: { suppress?: boolean; disconnect?: boolean } = {}) {
  const response = await fetch(url + '/__control/event-stream', { method: 'POST', body: JSON.stringify(patch) });
  expect(response.ok).toBe(true);
  return (await response.json()).data as { clients: number; subscribes: number };
}

async function visible(assertion: () => void, timeout = 12_000) {
  await vi.waitFor(async () => { await settleReact(); assertion(); }, { timeout });
}

it('composes connection, catalog, chat, approval, foreground recovery, scope switch and disposal', async () => {
  const [serverA, serverB] = await Promise.all([startServer('permission'), startServer('happy-path')]);
  const a = connection(serverA, 'First');
  const b = connection(serverB, 'Second');
  const projectPath = a.projects[0];
  const first = { connectionId: a.id, projectPath };
  const second = { connectionId: b.id, projectPath };
  focusManager.setFocused(true);
  cloudLinkPlatform.preferences.clear();
  const core = createAppCore({ settings: a.settings, chatPreferences: defaultChatPreferences, controlPlaneUrl: '' });
  const cleanup = [core.projects.start(), core.autoApproval.start()];
  let disposed = false;
  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const stop of cleanup) stop();
    core.dispose();
    focusManager.setFocused(undefined);
  }
  onTestFinished(dispose);
  await core.persistence.hydrate();
  core.connections.configure({
    createManager: createConnection, hydrated: true, updateSettings: core.commands.connection.updateSettings,
    setup: { phase: 'idle', prepareSettings: async (settings) => settings },
    translate: (key) => key,
  });
  core.commands.workspace.change(() => [a, b]);
  core.store.getState().setRegistry({ ready: true, focus: first });

  function Providers({ children }: PropsWithChildren) {
    return <AppCoreProvider core={core}><QueryClientProvider client={core.queryClient}>{children}</QueryClientProvider></AppCoreProvider>;
  }
  const probe = renderHook((foreground: boolean) => {
    const focus = useAppStore((state) => state.registry.focus);
    useLayoutEffect(() => {
      core.connections.setForeground(foreground);
      core.connections.setDemand(focus?.connectionId, foreground);
      core.projects.setDemand(focus, foreground, true);
    }, [focus, foreground]);
    const scope = useProjectScope();
    const capabilities = useWorkspaceServerData(scope.identity, scope.client, scope.connected && foreground, scope.isCurrentClient, scope.queryActive);
    return {
      agents: capabilities.availableAgents, focus, connection: useConnectionLifecycle(focus?.connectionId).connection,
      projects: useProjects(), selected: useCurrentSession(), chat: useChat().view,
    };
  }, true as boolean, Providers);

  // connect and catalog
  await visible(() => {
    expect(probe.result.current.connection.status).toBe('connected');
    expect(probe.result.current.projects.activeProject?.path).toBe(projectPath);
    expect(probe.result.current.projects.projects.some(({ path }) => path === projectPath)).toBe(true);
    expect(probe.result.current.agents.some(({ id }) => id === 'build')).toBe(true);
  });

  // create/open and send through composed commands
  let idA = '';
  await act(async () => { idA = (await core.commands.workspace.createChat(first)).id; });
  await visible(() => expect(probe.result.current.selected.currentSessionId).toBe(idA));
  await act(async () => { expect(await probe.result.current.chat.sendPrompt(idA, 'Verify the permission flow')).toBe(true); });
  await visible(() => expect(probe.result.current.chat.currentPendingPermissions).toHaveLength(1));
  const permission = probe.result.current.chat.currentPendingPermissions[0];
  await act(async () => { await probe.result.current.chat.replyToPermission(permission.id, 'once'); });
  await visible(() => {
    const parts = probe.result.current.chat.currentMessages.flatMap((record) => record.parts);
    expect(parts.some((part) => part.type === 'text' && part.text.includes('permission resolved'))).toBe(true);
    expect(parts.some((part) => part.type === 'tool' && part.tool === 'todowrite')).toBe(true);
    expect(probe.result.current.chat.currentPendingPermissions).toHaveLength(0);
  });

  // Drop the stream while foreground demand is paused, then recover the same selection.
  const before = await streamStatus(serverA);
  probe.rerender(false);
  await streamStatus(serverA, { disconnect: true });
  probe.rerender(true);
  await vi.waitFor(async () => expect((await streamStatus(serverA)).subscribes).toBeGreaterThan(before.subscribes), { timeout: 10_000 });
  await visible(() => expect(probe.result.current.selected.currentSessionId).toBe(idA));

  // Commands route identical project paths to independent connection owners.
  await act(async () => { await core.commands.workspace.activate(second); });
  await visible(() => expect(probe.result.current.focus?.connectionId).toBe(b.id));
  expect(probe.result.current.selected.currentSessionId).toBeUndefined();
  expect(probe.result.current.chat.currentMessages).toHaveLength(0);
  await act(async () => { await core.commands.workspace.createChat(second); });
  await act(async () => { await core.commands.workspace.activate(first); });
  await visible(() => {
    expect(probe.result.current.focus?.connectionId).toBe(a.id);
    expect(probe.result.current.selected.currentSessionId).toBe(idA);
    expect(probe.result.current.chat.currentMessages.length).toBeGreaterThan(0);
  });

  probe.unmount();
  dispose();
  expect(core.connections.get(a.id)).toBeUndefined();
  expect(core.connections.get(b.id)).toBeUndefined();
  expect(core.queryClient.getQueryCache().getAll()).toHaveLength(0);
  await vi.waitFor(async () => {
    const streams = await Promise.all([streamStatus(serverA), streamStatus(serverB)]);
    expect(streams.map(({ clients }) => clients)).toEqual([0, 0]);
  });
});
