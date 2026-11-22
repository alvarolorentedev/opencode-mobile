import type { CommandContext } from '@/runtime/core/commands/context';
import type { createSessionCommands } from './session';
import { createWorktreeCommands } from '@/features/projects/runtime';
import { projectSessionsKey, sessionCatalogOptions } from '@/features/sessions/runtime';
import { createWorkspaceWaiters } from '@/runtime/workspace/workspace-lifecycle';
import { getConnectionScope } from '@/shared/contracts/connection-scope';
import { resolveWorkspaceProjectKey, type ConnectionRecord, type NewWorktreeChatResult, type NewWorktreeChatTarget, type SessionTarget, type WorkspaceTarget } from '@/shared/contracts/workspace';
import { findSessionForNavigation } from '@/shared/protocol/services/session-service';
import type { Session } from '@/shared/protocol/opencode/types';

type ReadinessOptions = { signal?: AbortSignal; waitForProject?: boolean };

export function createWorkspaceCommands({ store, connections, queryClient }: Pick<CommandContext, 'store' | 'queryClient'> & {
  connections: Pick<CommandContext['connections'], 'get' | 'subscribeState' | 'subscribeProjects'>;
}, sessions: Pick<ReturnType<typeof createSessionCommands>, 'creation' | 'navigation'>, pauseConversation: (connectionId?: string) => Promise<void>) {
  const waiters = createWorkspaceWaiters();
  let unsubscribe: (() => void) | undefined;
  let stopConnectionStatus: (() => void) | undefined;
  let stopProjects: (() => void) | undefined;
  let navigation: AbortController | undefined;
  let focusRequest: WorkspaceTarget | undefined;
  let canPersist = true;
  const registry = () => store.getState().registry;
  const { setRegistry } = store.getState();

  function observeReadiness() {
    if (focusRequest && scopeIfReady(focusRequest)) commitFocus(focusRequest);
    waiters.notify();
  }
  function resume() {
    waiters.resume();
    unsubscribe ??= store.subscribe((current, previous) => {
      if (current.registry.connections !== previous.registry.connections || current.selection !== previous.selection) observeReadiness();
    });
    stopConnectionStatus ??= connections.subscribeState(observeReadiness);
    stopProjects ??= connections.subscribeProjects(observeReadiness);
  }
  function cancelNavigation() { navigation?.abort(); }
  function beginNavigation(externalSignal?: AbortSignal) {
    cancelNavigation();
    const controller = new AbortController();
    navigation = controller;
    if (externalSignal) {
      const cancel = () => controller.abort();
      externalSignal.addEventListener('abort', cancel, { once: true });
      controller.signal.addEventListener('abort', () => externalSignal.removeEventListener('abort', cancel), { once: true });
      if (externalSignal.aborted) controller.abort();
    }
    return controller;
  }

  function change(update: (current: ConnectionRecord[]) => ConnectionRecord[]) {
    const current = registry().connections;
    const next = update(current);
    if (next.length === current.length && next.every((entry, index) => entry === current[index])) return;
    const connections = next.map((entry) => {
      const previous = current.find((record) => record.id === entry.id);
      if (!previous || (previous.settings === entry.settings && previous.enabled === entry.enabled)) return entry;
      const old = previous.settings;
      const settings = entry.settings;
      const credentialsChanged = old.password !== settings.password || JSON.stringify(old.headers) !== JSON.stringify(settings.headers)
        || JSON.stringify(old.certificate) !== JSON.stringify(settings.certificate) || JSON.stringify(old.oidc) !== JSON.stringify(settings.oidc)
        || getConnectionScope(old) !== getConnectionScope(settings);
      return {
        ...entry, revision: (previous.revision ?? 0) + 1,
        authRevision: (previous.authRevision ?? 0) + Number(credentialsChanged),
      };
    });
    setRegistry({ connections });
  }

  function resolveKey(target: WorkspaceTarget) {
    const { registry, selection } = store.getState();
    const entry = registry.connections.find(({ id }) => id === target.connectionId);
    return resolveWorkspaceProjectKey(entry, target, selection);
  }
  function directoryForKey(key: string) {
    const [, directory] = JSON.parse(key) as [string, string];
    return store.getState().selection[key]?.activeProjectPath ?? (directory || undefined);
  }
  function projectPath(target: WorkspaceTarget) {
    return directoryForKey(resolveKey(target));
  }
  function scopeIfReady(target: WorkspaceTarget) {
    const entry = registry().connections.find(({ id }) => id === target.connectionId);
    const key = resolveKey(target);
    const [, registeredDirectory] = JSON.parse(key) as [string, string];
    if (!entry?.projects.includes(registeredDirectory)) return;
    const boundDirectory = directoryForKey(key);
    const scope = { boundDirectory, revision: entry.revision, enabled: entry.enabled };
    if (!entry.enabled) return scope;
    const sources = connections.get(entry.id)?.realtime.getProjectSources(boundDirectory ?? '', key);
    if (!sources?.binding || (sources.binding.revision ?? 0) !== (entry.revision ?? 0) || !sources.catalog?.isCurrent()) return;
    return scope;
  }
  function commitFocus(target: WorkspaceTarget) {
    focusRequest = undefined;
    setRegistry({ focus: target });
  }
  function select(target: WorkspaceTarget, persist = true) {
    if (persist) canPersist = true;
    if (registry().focus && !scopeIfReady(target)) {
      focusRequest = target;
      return;
    }
    commitFocus(target);
  }
  function readWorkspace(target: WorkspaceTarget) {
    if (!registry().connections.some(({ id }) => id === target.connectionId)) throw new Error('This server is no longer available.');
    return scopeIfReady(target);
  }
  async function ensure(target: WorkspaceTarget, options?: ReadinessOptions) {
    const key = resolveKey(target);
    const [, path] = JSON.parse(key) as [string, string];
    change((current) => current.map((entry) => entry.id === target.connectionId && !entry.projects.includes(path)
      ? { ...entry, projects: [...entry.projects, path] } : entry));
    return waiters.wait(() => readWorkspace(target), options?.signal);
  }
  async function selectIndependentTarget(target: WorkspaceTarget, field: 'terminalTarget' | 'inspectionTarget') {
    await ensure(target);
    setRegistry({ [field]: target });
  }
  async function retry(id: string) {
    canPersist = true;
    const { connections: records } = registry();
    const entry = records.find((record) => record.id === id);
    if (!entry) throw new Error('Server not found.');
    connections.get(id)?.realtime.suspendProjects();
    // The placeholder's catalog read restores the server's default project.
    change((current) => current.map((item) => item.id === id ? { ...entry, enabled: true, settings: { ...item.settings } } : item));
    await ensure({ connectionId: id, projectPath: '' });
    return (await waitForManager(id)).connect();
  }
  function waitForManager(id: string, signal?: AbortSignal) {
    return waiters.wait(() => {
      if (!registry().connections.find((record) => record.id === id)?.enabled) throw new Error('Server disconnected.');
      return connections.get(id);
    }, signal);
  }
  async function connectedWorkspace(target: WorkspaceTarget, options?: ReadinessOptions) {
    if (!registry().connections.find((record) => record.id === target.connectionId)?.enabled) {
      throw new Error('Connect this server before opening its workspace.');
    }
    await ensure(target, options);
    const manager = await waitForManager(target.connectionId, options?.signal);
    let failure: unknown;
    const status = manager.getState().connection.status;
    if (status !== 'connected') {
      if (options?.signal?.aborted) throw new Error('This navigation was cancelled.');
      const attempt = status === 'error' ? retry(target.connectionId) : manager.connect();
      void attempt.catch((error) => { failure = error; waiters.notify(); });
    }
    return waiters.wait(() => {
      if (failure) throw failure;
      if (!registry().connections.find((record) => record.id === target.connectionId)?.enabled) throw new Error('Server disconnected.');
      const current = readWorkspace(target);
      const connection = connections.get(target.connectionId)?.getState().connection;
      if (connection?.status === 'error') throw new Error(connection.message);
      if (connection?.status === 'connected' && (!options?.waitForProject || projectPath(target))) return current;
    }, options?.signal);
  }

  function selectWorkspace(target: WorkspaceTarget) {
    select({ connectionId: target.connectionId, projectPath: target.projectPath || projectPath(target) || '' });
  }
  function bindSession(target: WorkspaceTarget, binding: NonNullable<ReturnType<typeof scopeIfReady>>) {
    const scoped = { connectionId: target.connectionId, projectPath: binding.boundDirectory ?? '' };
    const key = resolveKey(target);
    return {
      ...sessions.creation(scoped, key, binding.revision),
      ...sessions.navigation(scoped, key, binding.revision),
    };
  }

  async function navigate(target: SessionTarget) {
    const controller = beginNavigation();
    const { signal } = controller;
    const check = () => { if (signal.aborted) throw new Error('This navigation was cancelled.'); };
    check();
    await pauseConversation();
    const next = await connectedWorkspace(target, { signal });
    check();
    const manager = connections.get(target.connectionId);
    const access = manager?.getProjectAccess(projectPath(target) ?? '');
    const catalogClient = manager?.getCatalogClient();
    if (!access || !catalogClient || !access.isCurrent()) throw new Error('This server is no longer available.');
    // Rendered library rows are known in the owning connection. A stale favorite
    // is resolved once against that same server before changing focus.
    const inProject = (session: { id: string; directory?: string }) => session.id === target.sessionId && (!session.directory || session.directory === target.projectPath);
    const catalog = queryClient.getQueryData(sessionCatalogOptions(access.identity, catalogClient).queryKey);
    const known = catalog?.sessions.some(inProject) || queryClient.getQueriesData<Session[]>({
      queryKey: projectSessionsKey(access.identity, access.client).slice(0, -1),
    }).some(([, sessions]) => sessions?.some(inProject));
    if (!known) {
      const session = await findSessionForNavigation(catalogClient, target.sessionId, signal);
      check();
      if (!access.isCurrent()) throw new Error('This server is no longer available.');
      if (!session || !inProject(session) || session.time.archived) {
        throw new Error(`Session ${target.sessionId} was not found in the ${target.projectPath} project.`);
      }
    }
    check();
    await bindSession(target, next).openSession(target.sessionId);
    check();
    selectWorkspace(target);
    controller.abort();
  }
  async function activate(target: WorkspaceTarget) {
    const controller = beginNavigation();
    const { signal } = controller;
    await pauseConversation();
    await connectedWorkspace(target, { signal });
    if (signal.aborted) throw new Error('This navigation was cancelled.');
    selectWorkspace(target);
    controller.abort();
  }
  async function openExternalSession(target: SessionTarget, externalSignal?: AbortSignal) {
    const controller = beginNavigation(externalSignal);
    const { signal } = controller;
    const check = () => { if (signal.aborted) throw new Error('This session link was cancelled.'); };
    try {
      check();
      await pauseConversation();
      let next = await connectedWorkspace(target, { signal });
      check();
      if (!target.projectPath && !projectPath(target)) {
        // The probe may settle before the default project publishes readiness.
        const sources = connections.get(target.connectionId)?.realtime.getProjectSources('', resolveKey(target));
        const catalog = await sources?.catalog?.actions.loadProjectCatalog(true);
        check();
        if (catalog?.currentProjectPath || catalog?.serverProjects[0]?.worktree) {
          next = await connectedWorkspace(target, { signal, waitForProject: true });
          check();
        }
      }
      const opened = await bindSession(target, next).openDeepLinkSession({ sessionId: target.sessionId, projectPath: target.projectPath || undefined }, signal);
      if (!opened.ok) throw new Error(opened.error);
      check();
      selectWorkspace(target);
    } finally {
      controller.abort();
    }
  }
  async function createSession(target: WorkspaceTarget) {
    return bindSession(target, await ensure(target)).createSession();
  }
  async function createChat(target: WorkspaceTarget) {
    if (!target.projectPath) throw new Error('Choose a project before creating a chat.');
    const commands = bindSession(target, await connectedWorkspace(target));
    const session = await commands.createSession();
    await commands.openSession(session.id);
    await activate(target);
    return session;
  }
  async function createChatInWorktree(target: NewWorktreeChatTarget): Promise<NewWorktreeChatResult> {
    let checkout: NewWorktreeChatResult['checkout'];
    try {
      const root = { connectionId: target.connectionId, projectPath: target.projectRoot };
      await connectedWorkspace(root);
      const scopeKey = resolveKey(root);
      const readDirectory = () => store.getState().selection[scopeKey]?.activeProjectPath ?? root.projectPath;
      const directory = readDirectory();
      const manager = connections.get(root.connectionId);
      const access = manager?.getProjectAccess(directory);
      if (!manager || !access) throw new Error('This server is no longer available.');
      checkout = await createWorktreeCommands({ ...access, cache: queryClient,
        isCurrent: () => access.isCurrent() && manager === connections.get(root.connectionId)
          && resolveKey(root) === scopeKey && readDirectory() === directory,
        shouldRefresh: () => manager.realtime.getProjectSources(directory, scopeKey)?.demanded === true,
      }).createWorktree(target.name);
      const project = { connectionId: target.connectionId, projectPath: checkout.directory };
      const session = await createChat(project);
      return { session, checkout };
    } catch (reason) {
      return { checkout, error: reason instanceof Error ? reason.message : 'Could not create the worktree chat.' };
    }
  }

  resume();
  return {
    resume,
    dispose() {
      cancelNavigation();
      unsubscribe?.(); unsubscribe = undefined;
      stopConnectionStatus?.(); stopConnectionStatus = undefined;
      stopProjects?.(); stopProjects = undefined;
      focusRequest = undefined; waiters.dispose();
    },
    cancelNavigation, pauseConversation,
    isPersistenceAllowed: () => canPersist,
    setPersistenceAllowed: (allowed: boolean) => { canPersist = allowed; },
    isEnabled: (id: string) => registry().connections.some((record) => record.id === id && record.enabled),
    change, select, resolveKey, ensure, retry, connectedWorkspace,
    activate, navigate, openExternalSession, createSession, createChat, createChatInWorktree,
    selectTerminalTarget: (target: WorkspaceTarget) => selectIndependentTarget(target, 'terminalTarget'),
    inspect: (target: WorkspaceTarget) => selectIndependentTarget(target, 'inspectionTarget'),
  };
}
