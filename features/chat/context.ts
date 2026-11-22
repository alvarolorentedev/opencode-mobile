import { useAppCore, useAppStore, useWorkspaceDomainValue } from '@/runtime/core';

export const useChat = () => useWorkspaceDomainValue((values) => values.chatValue, 'useChat');

export function useChatBootstrap() {
  const { resolveKey } = useAppCore().commands.workspace;
  return useAppStore(({ registry: { focus }, selection }) => focus ? selection[resolveKey(focus)]?.isBootstrappingChat ?? false : false);
}
