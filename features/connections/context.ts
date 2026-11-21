import { useWorkspaceDomainValue } from '@/runtime/core';

export const useConnection = () => useWorkspaceDomainValue((values) => values.connectionValue, 'useConnection');
export const useDiagnostics = () => useWorkspaceDomainValue((values) => values.diagnosticsValue, 'useDiagnostics');
