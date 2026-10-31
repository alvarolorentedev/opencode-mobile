import * as Clipboard from 'expo-clipboard';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ScopedOpencodeClient } from '@/lib/opencode/client';
import { projectPath, type ProjectFileEntry } from '@/lib/opencode/project';
import { EntryOperationError, type EntryOperation } from '@/lib/opencode/project-entry-operations';
import { projectEntryOperations } from './services/project-service';
import type { FileClipboard } from './use-file-clipboard';

export function useProjectEntryActions({ client, isCurrentClient, connectionId, clipboard, refresh, enabled }: {
  client: ScopedOpencodeClient;
  isCurrentClient: (candidate: object) => boolean;
  connectionId: string;
  clipboard?: FileClipboard;
  refresh: () => Promise<void>;
  enabled: boolean;
}) {
  const { t } = useTranslation();
  const root = client.__opencode.directory || '';
  const adapter = useMemo(() => projectEntryOperations(client), [client]);
  const [availability, setAvailability] = useState<{ client: object; available: boolean }>();
  const [feedback, setFeedback] = useState<{ client: object; error?: string; notice?: string }>();
  const latestRefresh = useRef(refresh);
  useLayoutEffect(() => { latestRefresh.current = refresh; }, [refresh]);
  const register = clipboard?.register;
  useEffect(() => register?.(connectionId, root, () => latestRefresh.current()), [register, connectionId, root]);
  const probe = useCallback(async () => {
    const available = enabled && await adapter.probe().catch(() => false);
    if (isCurrentClient(client)) setAvailability({ client, available });
  }, [adapter, client, enabled, isCurrentClient]);
  const available = enabled && availability?.client === client && availability.available;
  const entry = clipboard?.entries[connectionId];
  const currentFeedback = feedback?.client === client ? feedback : undefined;
  const errorText = useCallback((error: unknown) => t(`project:files.actions.${error instanceof EntryOperationError ? error.code : 'failed'}`), [t]);
  const execute = useCallback(async (action: () => Promise<boolean>) => {
    if (!clipboard || !available || !isCurrentClient(client)) return false;
    setFeedback({ client });
    try { return await clipboard.run(connectionId, async () => isCurrentClient(client) ? action() : false); }
    catch (error) {
      if (isCurrentClient(client)) setFeedback({ client, error: errorText(error) });
      return false;
    }
  }, [available, client, clipboard, connectionId, errorText, isCurrentClient]);
  const completed = useCallback(async (roots: string[]) => {
    if (!isCurrentClient(client)) return;
    try {
      await clipboard?.refresh(connectionId, roots);
      if (isCurrentClient(client)) setFeedback({ client, notice: t('project:files.actions.done') });
    } catch { if (isCurrentClient(client)) setFeedback({ client, error: t('project:files.actions.refreshFailed') }); }
  }, [client, clipboard, connectionId, isCurrentClient, t]);
  const rename = useCallback((file: ProjectFileEntry, name: string) => execute(async () => {
    if (!name.trim() || /[/\\\x00-\x1f]/.test(name) || name === '.' || name === '..') throw new EntryOperationError('unsafe');
    const path = projectPath(file.path, root);
    const parent = path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : '';
    const operation: EntryOperation = { kind: 'move', source: { root, path, type: file.type }, destination: { root, path: parent + name } };
    if (await adapter.inspect(operation) !== 'missing') throw new EntryOperationError('collision');
    if (!isCurrentClient(client)) return false;
    await adapter.mutate(operation, 'missing');
    await completed([root]);
    return true;
  }), [adapter, client, completed, execute, isCurrentClient, root]);
  const pasteOperation = useCallback((directory: string): EntryOperation => {
    if (!entry) throw new EntryOperationError('missing');
    const target = projectPath(directory, root, true);
    return { kind: entry.mode === 'cut' ? 'move' : 'copy', source: entry, destination: { root, path: `${target ? target + '/' : ''}${entry.path.split('/').pop()}` } };
  }, [entry, root]);
  const paste = useCallback((directory: string, expected: string) => execute(async () => {
    const operation = pasteOperation(directory);
    if (await adapter.inspect(operation) !== expected) throw new EntryOperationError('changed');
    if (!isCurrentClient(client)) return false;
    await adapter.mutate(operation, expected);
    if (!isCurrentClient(client)) return true;
    if (entry?.mode === 'cut') clipboard?.select(connectionId, undefined, entry);
    await completed([root, operation.source.root]);
    return true;
  }), [adapter, client, clipboard, completed, connectionId, entry, execute, isCurrentClient, pasteOperation, root]);
  const inspectPaste = useCallback(async (directory: string) => {
    if (!entry || !available || clipboard?.busy[connectionId]) return undefined;
    try {
      const expected = await adapter.inspect(pasteOperation(directory));
      return isCurrentClient(client) ? expected : undefined;
    } catch (error) { if (isCurrentClient(client)) setFeedback({ client, error: errorText(error) }); return undefined; }
  }, [adapter, available, client, clipboard, connectionId, entry, errorText, isCurrentClient, pasteOperation]);
  return useMemo(() => ({
    available: Boolean(available), reason: !available ? t('project:files.actions.unsupported') : undefined,
    busy: clipboard?.busy[connectionId] === true, clipboard: entry,
    error: currentFeedback?.error, notice: currentFeedback?.notice,
    probe, rename, paste, inspectPaste,
    clearFeedback: () => setFeedback({ client }),
    clear: () => clipboard?.select(connectionId),
    select: (file: ProjectFileEntry, mode: 'copy' | 'cut') => {
      if (available && !clipboard?.busy[connectionId]) clipboard?.select(connectionId, { root, path: projectPath(file.path, root), type: file.type, mode });
    },
    copyPath: async (file: ProjectFileEntry) => {
      try {
        await Clipboard.setStringAsync(`${root.replace(/\/$/, '')}/${projectPath(file.path, root)}`);
        if (isCurrentClient(client)) setFeedback({ client, notice: t('project:files.actions.pathCopied') });
      } catch { if (isCurrentClient(client)) setFeedback({ client, error: t('project:files.actions.failed') }); }
    },
  }), [available, client, clipboard, connectionId, currentFeedback, entry, inspectPaste, isCurrentClient, paste, probe, rename, root, t]);
}
export type ProjectEntryActions = ReturnType<typeof useProjectEntryActions>;
