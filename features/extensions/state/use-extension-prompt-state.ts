import { useCallback, type Dispatch, type SetStateAction } from 'react';

import { useAppCore, useAppStore } from '@/runtime/core';

export function useExtensionPromptState() {
  const { store } = useAppCore();
  const mcpAuthPrompt = useAppStore((state) => state.mcpAuthPrompt);
  const setMcpAuthPrompt = useCallback<Dispatch<SetStateAction<{ mcpName: string; url: string } | undefined>>>((value) => {
    store.getState().setMcpAuthPrompt(value);
  }, [store]);
  return { mcpAuthPrompt, setMcpAuthPrompt };
}
