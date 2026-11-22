import { resolveWorkspaceProjectKey, workspaceKey, type WorkspaceTarget } from '@/shared/contracts/workspace';

import { createProjectBinding, type ProjectRuntimeDependencies } from './project-binding';

export function createProjectRuntimes(dependencies: ProjectRuntimeDependencies) {
  const { store, connections, queryClient } = dependencies;
  const scopes = new Map<string, NonNullable<ReturnType<typeof createProjectBinding>>>();
  let active = false;
  let queued = false;
  let demand: { target?: WorkspaceTarget; foreground: boolean; hydrated: boolean } = { foreground: false, hydrated: false };

  function schedule() {
    if (!active || queued) return;
    queued = true;
    void Promise.resolve().then(() => {
      queued = false;
      if (active) sync();
    });
  }

  function sync() {
    const { registry, selection } = store.getState();
    function keyFor(target?: WorkspaceTarget) {
      if (!target) return;
      const entry = registry.connections.find(({ id }) => id === target.connectionId);
      if (entry?.enabled) return resolveWorkspaceProjectKey(entry, target, selection);
    }
    const visible = keyFor(registry.focus);
    const demanded = demand.hydrated && demand.foreground ? keyFor(demand.target) : undefined;
    const retained = new Set<string>();
    for (const entry of registry.connections) {
      if (!entry.enabled) continue;
      const manager = connections.get(entry.id);
      if (!manager) continue;
      for (const projectPath of entry.projects) {
        const key = workspaceKey({ connectionId: entry.id, projectPath });
        retained.add(key);
        let scope = scopes.get(key);
        if (!scope?.isCurrent()) {
          scope?.dispose();
          scopes.delete(key);
          scope = createProjectBinding(dependencies, manager, entry, key, selection[key]?.activeProjectPath ?? projectPath, schedule);
          if (scope) scopes.set(key, scope);
        }
        scope?.sync(visible === key, demanded === key);
      }
    }
    for (const [key, scope] of scopes) if (!retained.has(key)) {
      scopes.delete(key);
      scope.dispose();
    }
  }

  return {
    setDemand(target: WorkspaceTarget | undefined, foreground: boolean, hydrated: boolean) {
      demand = { target, foreground, hydrated };
      schedule();
    },
    start() {
      active = true;
      const stopStore = store.subscribe((current, previous) => {
        if (current.registry.connections !== previous.registry.connections || current.registry.focus !== previous.registry.focus
          || current.selection !== previous.selection || current.prompt !== previous.prompt
          || current.conversation !== previous.conversation || current.network !== previous.network
          || current.terminal !== previous.terminal || current.mcpAuthPrompt !== previous.mcpAuthPrompt) schedule();
      });
      const stopConnections = connections.subscribeState(schedule);
      const stopQueries = queryClient.getQueryCache().subscribe(({ type, query: { queryKey } }) => {
        if ((type === 'updated' || type === 'removed') && queryKey[0] === 'opencode'
          && (queryKey[5] === 'sessions' || queryKey[7] === 'pending-interactions' || queryKey[7] === 'prompt-inbox')) schedule();
      });
      schedule();
      return () => {
        active = false;
        stopStore();
        stopConnections();
        stopQueries();
        for (const scope of scopes.values()) scope.dispose();
        scopes.clear();
      };
    },
  };
}
