import { useCallback } from 'react';

import { resolveDiffTurn } from '@/shared/presentation/transcript';

import type { DiffScope } from '@/shared/contracts/domain';

import { getSessionDiff as svcGetSessionDiff, getSessionTodos as svcGetSessionTodos } from '@/shared/protocol/services/session-service';

import { getVcsDiff as svcGetVcsDiff } from '@/features/projects/runtime';

import type { ChatRefreshInput } from '@/features/chat/model/refresh-input';

async function withDiffLoading<T>(silent: boolean, setLoading: (value: boolean) => void, task: () => Promise<T>) {
  if (!silent) setLoading(true);
  try {
    return await task();
  } finally {
    if (!silent) setLoading(false);
  }
}
export function useChatRefresh({ client, isCurrentClient, setIsRefreshingDiffs, setDiffsBySession, setVcsDiffsByScope, setTodosBySession, setDiffScopeBySession, setSelectedDiffMessageBySession, selectedDiffMessageBySessionRef, diffScopeBySessionRef, currentSessionIdRef, messagesBySessionRef }: ChatRefreshInput) {

  const refreshSessionDiff = useCallback(
    async (sessionId: string, silent = false, messageId?: string) => withDiffLoading(silent, setIsRefreshingDiffs, async () => {
      const messages = messagesBySessionRef.current[sessionId] ?? [];
      const pinned = selectedDiffMessageBySessionRef.current[sessionId];
      // Resolve through the same selector the diff surface displays with so a
      // request can never ask the server for a different turn than the one the
      // overlay highlights.
      const targetMessageId = messageId ?? resolveDiffTurn(messages, pinned);
      const data = await svcGetSessionDiff(client, sessionId, targetMessageId, messages);
      if (!isCurrentClient(client)) {
        return data;
      }
      setDiffsBySession((current) => ({
        ...current,
        [sessionId]: data,
      }));

      return data;
    }),
    [client, isCurrentClient, messagesBySessionRef, selectedDiffMessageBySessionRef, setDiffsBySession, setIsRefreshingDiffs],
  );

  const refreshVcsDiff = useCallback(
    async (scope: 'uncommitted' | 'branch', silent = false) => withDiffLoading(silent, setIsRefreshingDiffs, async () => {
      const data = await svcGetVcsDiff(client, scope === 'branch' ? 'branch' : 'git');
      if (!isCurrentClient(client)) {
        return data;
      }
      setVcsDiffsByScope((current) => ({
        ...current,
        [scope]: data,
      }));

      return data;
    }),
    [client, isCurrentClient, setIsRefreshingDiffs, setVcsDiffsByScope],
  );

  const setDiffScope = useCallback(
    (scope: DiffScope) => {
      const sessionId = currentSessionIdRef.current;
      if (!sessionId) {
        return;
      }
      setDiffScopeBySession((current) => ({ ...current, [sessionId]: scope }));
      if (scope !== 'turn') {
        void refreshVcsDiff(scope, true);
      }
    },
    [currentSessionIdRef, refreshVcsDiff, setDiffScopeBySession],
  );

  const selectDiffMessage = useCallback(
    (messageId: string) => {
      const sessionId = currentSessionIdRef.current;
      if (!sessionId) {
        return;
      }
      setSelectedDiffMessageBySession((current) => ({ ...current, [sessionId]: messageId }));
      void refreshSessionDiff(sessionId, true, messageId);
    },
    [currentSessionIdRef, refreshSessionDiff, setSelectedDiffMessageBySession],
  );

  const refreshDiffs = useCallback(
    async (silent = false) => {
      const sessionId = currentSessionIdRef.current;
      if (!sessionId) {
        return;
      }
      const scope = diffScopeBySessionRef.current[sessionId] ?? 'turn';
      if (scope === 'turn') {
        await refreshSessionDiff(sessionId, silent);
      } else {
        await refreshVcsDiff(scope, silent);
      }
    },
    [currentSessionIdRef, diffScopeBySessionRef, refreshSessionDiff, refreshVcsDiff],
  );

  const refreshSessionTodos = useCallback(
    async (sessionId: string) => {
      const data = await svcGetSessionTodos(client, sessionId);
      if (!isCurrentClient(client)) {
        return data;
      }

      setTodosBySession((current) => ({
        ...current,
        [sessionId]: data,
      }));

      return data;
    },
    [client, isCurrentClient, setTodosBySession],
  );
  return { refreshSessionDiff, refreshVcsDiff, setDiffScope, selectDiffMessage, refreshDiffs, refreshSessionTodos };
}
