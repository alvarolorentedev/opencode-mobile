import type { QueryClient } from '@tanstack/react-query';

import type { AppStore } from '@/runtime/core/store';
import { getConnectionScope } from '@/shared/contracts/connection-scope';
import type { NetworkStatus } from '@/shared/network/network-status';
import type { ConnectionRecord } from '@/shared/contracts/workspace';
import { replaceQueryPartition, type QueryIdentity } from '@/shared/server-data/keys';

import type { createConnection, ConnectionInput } from './create-connection';
import type { ConnectionLifecycle } from '@/features/connections/index';
import { idleConnection } from './idle-connection';

type Manager = ReturnType<typeof createConnection>;
type Configuration = Pick<ConnectionInput, 'setup' | 'hydrated' | 'translate' | 'updateSettings'> & {
  createManager: typeof createConnection;
};
type Slot = {
  manager: Manager;
  input?: ConnectionInput;
  stopState: () => void;
  stopProjects: () => void;
  stopConnection?: () => void;
  stopRenewal?: () => void;
};

function queryIdentity(entry: ConnectionRecord): QueryIdentity {
  return { connectionId: entry.id, connectionScope: getConnectionScope(entry.settings), authRevision: entry.authRevision ?? 0 };
}

function paused(input: ConnectionInput) {
  return input.setup.phase === 'waitingForApproval' || input.setup.phase === 'delayed';
}

export function createConnectionRegistry({ store, queryClient }: { store: AppStore; queryClient: QueryClient }) {
  const slots = new Map<string, Slot>();
  const listeners = new Set<() => void>();
  const stateListeners = new Set<() => void>();
  const projectListeners = new Set<() => void>();
  const environmentListeners = new Set<() => void>();
  const foregroundListeners = new Set<(active: boolean) => void>();
  let foregroundActive = true;
  let activeId: string | undefined;
  let queryForeground = true;
  let unsubscribed: (() => void) | undefined;
  let configuration: Configuration | undefined;
  let lifecycles: ReadonlyMap<string, ConnectionLifecycle> | undefined;
  const foreground = {
    isActive: () => foregroundActive,
    subscribe(listener: (active: boolean) => void) {
      foregroundListeners.add(listener);
      return () => { foregroundListeners.delete(listener); };
    },
  };
  function notify() { for (const listener of listeners) listener(); }
  function notifyState() {
    lifecycles = undefined;
    for (const listener of stateListeners) listener();
  }
  function notifyEnvironment() { for (const listener of environmentListeners) listener(); }
  function notifyProjects() { for (const listener of projectListeners) listener(); }
  const isOnline = () => store.getState().network.online;
  function applyDemand() {
    for (const [id, { manager }] of slots) manager.setDemand(queryForeground && activeId === id, isOnline());
  }

  function drop(id: string, slot: Slot) {
    slots.delete(id);
    slot.stopState();
    slot.stopProjects();
    slot.stopRenewal?.();
    if (slot.input) slot.manager.setInput({ ...slot.input, entry: { ...slot.input.entry, enabled: false } });
    slot.stopConnection?.();
    slot.manager.syncConnection();
    slot.manager.dispose();
  }

  function sync(records: ConnectionRecord[]) {
    if (!configuration) return;
    const { createManager, ...environment } = configuration;
    const active = records.filter((entry) => entry.enabled);
    const activeIds = new Set(active.map(({ id }) => id));
    let changed = false;
    for (const [id, slot] of slots) {
      if (activeIds.has(id)) continue;
      drop(id, slot);
      changed = true;
    }
    for (const entry of active) {
      let slot = slots.get(entry.id);
      if (!slot) {
        const manager = createManager({ queryClient, foreground });
        slot = { manager, stopState: manager.subscribe(notifyState), stopProjects: manager.realtime.subscribeProjects(notifyProjects) };
        slots.set(entry.id, slot);
        changed = true;
      }
      const previous = slot.input;
      const identity = queryIdentity(entry);
      const next: ConnectionInput = { ...environment, entry, identity };
      slot.input = next;
      slot.manager.setInput(next);
      if (previous && (previous.identity.connectionScope !== identity.connectionScope || previous.identity.authRevision !== identity.authRevision)) {
        const old = previous.entry.settings;
        const current = entry.settings;
        const sameMachine = old.connect && current.connect && old.connect.machineId === current.connect.machineId
          && old.connect.controlPlaneUrl === current.connect.controlPlaneUrl && old.serverUrl === current.serverUrl;
        replaceQueryPartition(queryClient, previous.identity, identity, Boolean(sameMachine));
      }
      if (!previous || previous.entry.revision !== entry.revision || previous.entry.settings !== entry.settings || previous.hydrated !== next.hydrated) {
        slot.stopConnection?.();
        slot.stopConnection = slot.manager.syncConnection();
      }
      if (!previous || previous.entry.settings.connect !== entry.settings.connect || previous.entry.settings.password !== entry.settings.password || paused(previous) !== paused(next)) {
        slot.stopRenewal?.();
        slot.stopRenewal = slot.manager.syncRenewal();
      }
      slot.manager.setDemand(queryForeground && activeId === entry.id, isOnline());
    }
    if (changed) { notify(); notifyState(); notifyProjects(); }
  }

  return {
    get: (id: string) => slots.get(id)?.manager,
    getLifecycle: (id: string | undefined) => (id ? slots.get(id)?.manager.getState() : undefined) ?? idleConnection,
    getLifecycles: () => lifecycles ??= new Map([...slots].map(([id, { manager }]) => [id, manager.getState()])),
    environment: {
      isForeground: () => foregroundActive,
      isOnline,
      subscribe(listener: () => void) {
        environmentListeners.add(listener);
        return () => { environmentListeners.delete(listener); };
      },
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    subscribeState(listener: () => void) {
      stateListeners.add(listener);
      return () => { stateListeners.delete(listener); };
    },
    subscribeProjects(listener: () => void) {
      projectListeners.add(listener);
      return () => { projectListeners.delete(listener); };
    },
    isUpdateBlocked: () => [...slots.values()].some(({ manager }) => manager.realtime.isUpdateBlocked()),
    configure(next: Configuration) {
      configuration = next;
      unsubscribed ??= store.subscribe((current, previous) => {
        if (current.registry.connections !== previous.registry.connections) sync(current.registry.connections);
      });
      sync(store.getState().registry.connections);
    },
    setForeground(active: boolean) {
      if (foregroundActive === active) return;
      foregroundActive = active;
      for (const listener of foregroundListeners) listener(active);
      notifyEnvironment();
    },
    setDemand(connectionId: string | undefined, nextQueryForeground: boolean) {
      activeId = connectionId;
      queryForeground = nextQueryForeground;
      applyDemand();
    },
    setNetwork(next: NetworkStatus) {
      const { network, setNetwork } = store.getState();
      if (network.online === next.online && network.type === next.type && network.expensive === next.expensive
        && network.constrained === next.constrained && network.generation === next.generation) return;
      setNetwork(next);
      if (network.online !== next.online) { applyDemand(); notifyEnvironment(); }
    },
    dispose() {
      unsubscribed?.();
      unsubscribed = undefined;
      configuration = undefined;
      for (const [id, slot] of slots) drop(id, slot);
      notify();
      notifyState();
      notifyProjects();
    },
  };
}
