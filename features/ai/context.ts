import type { WorkspaceTarget } from '@/shared/contracts/workspace';
import { useWorkspaceDomainValue } from '@/runtime/core';

export const useCapabilities = (target?: WorkspaceTarget) => useWorkspaceDomainValue((values) => values.capabilitiesValue, 'useCapabilities', target);
