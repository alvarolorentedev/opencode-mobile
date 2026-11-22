import { useCallback, useLayoutEffect, useMemo, useRef } from 'react';
import { useAppCore, useAppStore } from '@/runtime/core';
import type { ConnectionRecord } from '@/shared/contracts/workspace';
import type { EntrySource } from '@/shared/protocol/opencode/project-entry-operations';

export type FileClipboardEntry = EntrySource & { mode: 'copy' | 'cut' };

export function useFileClipboard(connections: ConnectionRecord[]) {
  const { store } = useAppCore();
  const { entries, busy } = useAppStore((state) => state.fileClipboard);
  const setClipboard = store.getState().setFileClipboard;
  // Change detection for invalidating staged clipboard entries after a settings write.
  const signatures = useRef(new Map<string, string>());
  const refreshers = useRef(new Map<string, () => Promise<void>>());
  useLayoutEffect(() => {
    const next = new Map(connections.filter((entry) => entry.enabled).map((entry) => [entry.id, JSON.stringify(entry.settings)]));
    const invalid = [...signatures.current].filter(([id, signature]) => next.get(id) !== signature).map(([id]) => id);
    signatures.current = next;
    if (invalid.length) setClipboard((current) => ({ entries: Object.fromEntries(Object.entries(current.entries).filter(([id]) => !invalid.includes(id))) }));
  }, [connections, setClipboard]);
  const select = useCallback((id: string, entry?: FileClipboardEntry, expected?: FileClipboardEntry) => {
    if (!signatures.current.has(id)) return;
    setClipboard((current) => expected && current.entries[id] !== expected ? {} : { entries: { ...current.entries, [id]: entry } });
  }, [setClipboard]);
  const run = useCallback(async (id: string, action: () => Promise<boolean>) => {
    if (store.getState().fileClipboard.busy[id] || !signatures.current.has(id)) return false;
    setClipboard((current) => ({ busy: { ...current.busy, [id]: true } }));
    try { return await action(); }
    finally { setClipboard((current) => ({ busy: { ...current.busy, [id]: false } })); }
  }, [setClipboard, store]);
  const register = useCallback((id: string, root: string, refresh: () => Promise<void>) => {
    const key = JSON.stringify([id, root]);
    refreshers.current.set(key, refresh);
    return () => { if (refreshers.current.get(key) === refresh) refreshers.current.delete(key); };
  }, []);
  const refresh = useCallback(async (id: string, roots: string[]) => {
    await Promise.all([...new Set(roots)].map((root) => refreshers.current.get(JSON.stringify([id, root]))?.()));
  }, []);
  return useMemo(() => ({ entries, busy, select, run, register, refresh }), [entries, busy, select, run, register, refresh]);
}
export type FileClipboard = ReturnType<typeof useFileClipboard>;
