import { useWorkspaceDomainValue } from '@/runtime/core';

export const useMcp = () => useWorkspaceDomainValue((values) => values.mcpValue, 'useMcp');
export const useExtensions = () => useWorkspaceDomainValue((values) => values.extensionsValue, 'useExtensions');
