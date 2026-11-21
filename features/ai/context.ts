import { useWorkspaceDomainValue } from '@/runtime/core';

export const useCapabilities = () => useWorkspaceDomainValue((values) => values.capabilitiesValue, 'useCapabilities');
