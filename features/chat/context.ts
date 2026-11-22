import { useAppCore, useAppStore } from '@/runtime/core';

export { useChat } from './state/use-scoped-chat';

export function useChatBootstrap() {
  const { resolveKey } = useAppCore().commands.workspace;
  return useAppStore(({ registry: { focus }, selection }) => focus ? selection[resolveKey(focus)]?.isBootstrappingChat ?? false : false);
}
