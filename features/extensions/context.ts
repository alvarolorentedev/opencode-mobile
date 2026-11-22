import type { WorkspaceTarget } from '@/shared/contracts/workspace';
import { useProjectScope } from '@/runtime/core';
import { useExtensionsState } from './state/use-extensions-state';
import { useMcpState } from './state/use-mcp-state';

export const useMcp = (target?: WorkspaceTarget) => useMcpState(useProjectScope(target));
export function useExtensions(target?: WorkspaceTarget) {
  return useExtensionsState(useProjectScope(target));
}
