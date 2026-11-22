import type { WorkspaceTarget } from '@/shared/contracts/workspace';
import { useProjectScope, useWorkspaceDomainValue } from '@/runtime/core';
import { useExtensionsState } from './state/use-extensions-state';

export const useMcp = (target?: WorkspaceTarget) => useWorkspaceDomainValue((values) => values.mcpValue, 'useMcp', target);
export function useExtensions(target?: WorkspaceTarget) {
  return useExtensionsState(useProjectScope(target));
}
