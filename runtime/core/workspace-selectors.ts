import { useAppStore } from '@/runtime/core/context';
import type { WorkspaceValues } from '@/runtime/workspace/workspace-types';
import { workspaceKey, type WorkspaceTarget } from '@/shared/contracts/workspace';

export function useActiveWorkspaceTarget(explicit?: WorkspaceTarget) {
  return useAppStore((state) => explicit ?? state.registry.focus ?? state.registry.retainedFocus);
}

export function useWorkspaceDomainValue<T>(select: (values: WorkspaceValues) => T, name: string, explicit?: WorkspaceTarget): T {
  const target = useActiveWorkspaceTarget(explicit);
  const key = target ? workspaceKey(target) : undefined;
  const value = useAppStore((state) => {
    // The focused view is published separately from focus. A pane with an
    // explicit target keeps its own projection through that transition.
    const focused = !explicit && key && state.registry.focus && workspaceKey(state.registry.focus) === key ? state.focusedValues : undefined;
    const values = focused ?? (key ? state.registry.snapshots[key]?.values : undefined);
    return values ? select(values) : undefined;
  });
  if (value === undefined) throw new Error(`${name} must be used inside OpencodeProvider.`);
  return value;
}
