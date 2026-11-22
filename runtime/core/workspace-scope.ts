import { createContext, useContext } from 'react';

import { useAppStore } from '@/runtime/core/context';
import type { WorkspaceValues } from '@/runtime/workspace/workspace-types';
import { workspaceKey, type WorkspaceTarget } from '@/shared/contracts/workspace';

export const WorkspaceScopeContext = createContext<WorkspaceTarget | undefined>(undefined);
export const WorkspaceValuesContext = createContext<WorkspaceValues | undefined>(undefined);

export function useActiveWorkspaceTarget(explicit?: WorkspaceTarget) {
  const scoped = useContext(WorkspaceScopeContext);
  const target = useAppStore((state) => state.registry.focus ?? state.registry.retainedFocus);
  return explicit ?? scoped ?? target;
}

// Domain hooks read the scoped runtime values when a WorkspaceScope supplies
// them, otherwise the focused app values (with app-scope overrides). The
// selector keeps the subscription local, so a transcript update does not
// re-render connection or project consumers.
export function useWorkspaceDomainValue<T>(select: (values: WorkspaceValues) => T, name: string, explicit?: WorkspaceTarget): T {
  const scoped = useContext(WorkspaceValuesContext);
  const target = useActiveWorkspaceTarget(explicit);
  const key = target ? workspaceKey(target) : undefined;
  const value = useAppStore((state) => {
    if (scoped && !explicit) return select(scoped);
    // The focused view is published separately from focus. A pane with an
    // explicit target must keep its own projection through that transition.
    const focused = !explicit && key && state.registry.focus && workspaceKey(state.registry.focus) === key ? state.focusedValues : undefined;
    const values = focused ?? (key ? state.registry.snapshots[key]?.values : undefined);
    return values ? select(values) : undefined;
  });
  if (value === undefined) throw new Error(`${name} must be used inside OpencodeProvider.`);
  return value;
}
