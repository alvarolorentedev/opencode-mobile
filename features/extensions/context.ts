import type { WorkspaceTarget } from '@/shared/contracts/workspace';
import { useWorkspaceDomainValue } from '@/runtime/core';

export const useMcp = (target?: WorkspaceTarget) => useWorkspaceDomainValue((values) => values.mcpValue, 'useMcp', target);
export const useExtensions = (target?: WorkspaceTarget) => useWorkspaceDomainValue((values) => values.extensionsValue, 'useExtensions', target);
