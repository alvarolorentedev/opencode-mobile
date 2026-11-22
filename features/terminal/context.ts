import { useWorkspaceDomainValue } from '@/runtime/core';
import type { WorkspaceTarget } from '@/shared/contracts/workspace';

export const useTerminal = (target?: WorkspaceTarget) => useWorkspaceDomainValue((values) => values.terminalValue, 'useTerminal', target);
