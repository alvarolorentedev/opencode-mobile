import { useWorkspaceDomainValue } from '@/runtime/core';

export const useTerminal = () => useWorkspaceDomainValue((values) => values.terminalValue, 'useTerminal');
