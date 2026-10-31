import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ConnectionRecord } from '@/shared/contracts/workspace';
import type { EntrySource } from '@/shared/protocol/opencode/project-entry-operations';

export type FileClipboardEntry = EntrySource & { mode: 'copy' | 'cut' };

export function useFileClipboard(connections: ConnectionRecord[]) {
  const [entries, setEntries] = useState<Record<string, FileClipboardEntry | undefined>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const locks = useRef(new Set<string>());
  const signatures = useRef(new Map<string, string>());
  const refreshers = useRef(new Map<string, () => Promise<void>>());
  useLayoutEffect(() => {
    const next = new Map(connections.filter((entry) => entry.enabled).map((entry) => [entry.id, JSON.stringify(entry.settings)]));
    const invalid = [...signatures.current].filter(([id, signature]) => next.get(id) !== signature).map(([id]) => id);
    signatures.current = next;
    if (invalid.length) setEntries((current) => Object.fromEntries(Object.entries(current).filter(([id]) => !invalid.includes(id))));
  }, [connections]);
  const select = useCallback((id: string, entry?: FileClipboardEntry, expected?: FileClipboardEntry) => {
    if (!signatures.current.has(id)) return;
    setEntries((current) => expected && current[id] !== expected ? current : { ...current, [id]: entry });
  }, []);
  const run = useCallback(async (id: string, action: () => Promise<boolean>) => {
    if (locks.current.has(id) || !signatures.current.has(id)) return false;
    locks.current.add(id); setBusy((current) => ({ ...current, [id]: true }));
    try { return await action(); }
    finally { locks.current.delete(id); setBusy((current) => ({ ...current, [id]: false })); }
  }, []);
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
