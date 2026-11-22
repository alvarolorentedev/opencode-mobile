import type { AppCore } from '@/runtime/core';
import type { ConnectionRecord } from '@/shared/contracts/workspace';
import type { EntrySource } from '@/shared/protocol/opencode/project-entry-operations';

export type FileClipboardEntry = EntrySource & { mode: 'copy' | 'cut' };

export function createFileClipboard(store: Pick<AppCore['store'], 'getState' | 'subscribe'>) {
  let settingsByConnection = new Map<string, ConnectionRecord['settings']>();
  const refreshers = new Map<string, () => Promise<void>>();
  const { setFileClipboard } = store.getState();

  function reconcile(connections: ConnectionRecord[]) {
    const next = new Map(connections.filter(({ enabled }) => enabled).map(({ id, settings }) => [id, settings]));
    const invalid = new Set([...settingsByConnection].filter(([id, previous]) => {
      const current = next.get(id);
      return current !== previous && JSON.stringify(current) !== JSON.stringify(previous);
    }).map(([id]) => id));
    settingsByConnection = next;
    if (invalid.size) setFileClipboard((current) => ({
      entries: Object.fromEntries(Object.entries(current.entries).filter(([id]) => !invalid.has(id))),
    }));
  }

  function start() {
    reconcile(store.getState().registry.connections);
    return store.subscribe((current, previous) => {
      if (current.registry.connections !== previous.registry.connections) reconcile(current.registry.connections);
    });
  }

  function select(id: string, entry?: FileClipboardEntry, expected?: FileClipboardEntry) {
    if (!settingsByConnection.has(id)) return;
    setFileClipboard((current) => expected && current.entries[id] !== expected ? {} : { entries: { ...current.entries, [id]: entry } });
  }

  async function run(id: string, action: () => Promise<boolean>) {
    if (store.getState().fileClipboard.busy[id] || !settingsByConnection.has(id)) return false;
    setFileClipboard((current) => ({ busy: { ...current.busy, [id]: true } }));
    try { return await action(); }
    finally { setFileClipboard((current) => ({ busy: { ...current.busy, [id]: false } })); }
  }

  function register(id: string, root: string, refresh: () => Promise<void>) {
    const key = JSON.stringify([id, root]);
    refreshers.set(key, refresh);
    return () => { if (refreshers.get(key) === refresh) refreshers.delete(key); };
  }

  async function refresh(id: string, roots: string[]) {
    await Promise.all([...new Set(roots)].map((root) => refreshers.get(JSON.stringify([id, root]))?.()));
  }

  return { start, select, run, register, refresh };
}
