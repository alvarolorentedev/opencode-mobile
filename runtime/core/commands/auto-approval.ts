import { approvalsAccess } from '@/features/sessions/runtime';
import { workspaceKey } from '@/shared/contracts/workspace';

import type { CommandContext } from './context';
import type { createSessionCommands } from './session';

export function createAutoApproval(
  { store, queryClient, connections }: Pick<CommandContext, 'store' | 'queryClient'> & {
    connections: Pick<CommandContext['connections'], 'get' | 'subscribeState'>;
  },
  interactions: ReturnType<typeof createSessionCommands>['interactions'],
) {
  const attempted = new Set<string>();
  let scheduled = false;
  let cleanup: (() => void) | undefined;

  function scan() {
    scheduled = false;
    if (!cleanup) return;
    const { registry, selection } = store.getState();
    const pending = new Set<string>();

    for (const entry of registry.connections) {
      if (!entry.enabled || !entry.preferences.autoApprove) continue;
      const manager = connections.get(entry.id);
      if (!manager) continue;
      for (const projectPath of entry.projects) {
        const scope = workspaceKey({ connectionId: entry.id, projectPath });
        const path = selection[scope]?.activeProjectPath ?? projectPath;
        const access = manager.getProjectAccess(path);
        if (!access?.isCurrent() || access.client.__opencode.contract !== 'v2') continue;
        const { permissions } = approvalsAccess(queryClient, access.identity, access.client).read();
        for (const requests of Object.values(permissions)) {
          for (const { id } of requests) {
            const key = JSON.stringify([entry.id, id]);
            pending.add(key);
            if (attempted.has(key)) continue;
            attempted.add(key);
            void interactions({ connectionId: entry.id, projectPath: path }, access.revision)
              .replyToPermission(id, 'once').catch((error) => console.warn('Automatic approval failed; review the request manually.', error));
          }
        }
      }
    }

    for (const key of attempted) if (!pending.has(key)) attempted.delete(key);
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(scan);
  }

  function start() {
    if (!cleanup) {
      const stopStore = store.subscribe((current, previous) => {
        if (current.registry.connections !== previous.registry.connections || current.selection !== previous.selection) schedule();
      });
      const stopCache = queryClient.getQueryCache().subscribe((event) => {
        const key = event.query.queryKey;
        if ((event.type === 'updated' || event.type === 'removed') && key[0] === 'opencode' && key.at(-1) === 'pending-interactions') schedule();
      });
      const stopConnection = connections.subscribeState(schedule);
      cleanup = () => { stopStore(); stopCache(); stopConnection(); };
      schedule();
    }
    return dispose;
  }

  function dispose() {
    cleanup?.();
    cleanup = undefined;
    attempted.clear();
  }

  return { start, dispose };
}
