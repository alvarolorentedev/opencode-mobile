import { skipToken, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useLayoutEffect, useMemo } from 'react';
import { AppState } from 'react-native';

import { useAppCore, useAppStore } from '@/runtime/core';
import type { Pty } from '@/shared/protocol/opencode/types';
import { projectQueryKey } from '@/shared/server-data/keys';
import type { TerminalRuntime } from '@/features/terminal/model/terminal-types';
import { createProjectTerminal, EMPTY_TERMINALS, EMPTY_TERMINAL_INSTANCES, type TerminalStateInput } from '@/features/terminal/services/project-terminal';

export function useTerminalState({ scopeKey, ...input }: TerminalStateInput) {
  const { store } = useAppCore();
  const device = useAppStore((state) => state.terminal[scopeKey]);
  const { scope = 0, activeTerminalId, instances = EMPTY_TERMINAL_INSTANCES } = device ?? {};
  const cache = useQueryClient();
  const controller = useMemo(() => createProjectTerminal({
    scopeKey, cache, getState: store.getState,
    foreground: AppState.currentState !== 'background' && AppState.currentState !== 'inactive',
  }), [cache, scopeKey, store]);
  const { data: terminals = EMPTY_TERMINALS } = useQuery<Pty[]>({
    queryKey: projectQueryKey(input.identity, input.client, 'terminals'),
    queryFn: skipToken,
  });

  useLayoutEffect(() => { controller.configure(input); });
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => controller.setForeground(state === 'active'));
    return () => {
      subscription.remove();
      controller.dispose();
    };
  }, [controller]);

  const { registerRenderer, resize, refreshTerminals, openTerminal, createTerminal, sendTerminalInput, closeTerminal, resetTerminal } = controller;
  const terminalRuntime = useMemo<TerminalRuntime>(
    () => ({ scope, instances, registerRenderer, resize }), [scope, instances, registerRenderer, resize],
  );
  const terminalConnection = instances.find(({ id }) => id === activeTerminalId)?.status ?? 'idle';

  return { terminals, activeTerminalId, terminalRuntime, terminalConnection, refreshTerminals, openTerminal, createTerminal, sendTerminalInput, closeTerminal, resetTerminal };
}
