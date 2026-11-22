import { useAppCore, useAppStore } from '@/runtime/core/context';
import type { WorkspaceValues } from '@/runtime/workspace/workspace-types';
import type { WorkspaceTarget } from '@/shared/contracts/workspace';

export function useActiveWorkspaceTarget(explicit?: WorkspaceTarget) {
  return useAppStore((state) => explicit ?? state.registry.focus ?? state.registry.retainedFocus);
}

export function useWorkspaceDomainValue<T>(select: (values: WorkspaceValues) => T, name: string, explicit?: WorkspaceTarget): T {
  const { resolveKey } = useAppCore().commands.workspace;
  const value = useAppStore(({ registry: { focus, retainedFocus, snapshots } }) => {
    const read = (target?: WorkspaceTarget) => target ? snapshots[resolveKey(target)]?.values : undefined;
    const values = read(explicit ?? focus) ?? (!explicit ? read(retainedFocus) : undefined);
    return values ? select(values) : undefined;
  });
  if (value === undefined) throw new Error(`${name} must be used inside OpencodeProvider.`);
  return value;
}
