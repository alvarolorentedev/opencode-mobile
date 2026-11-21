import { createContext, useContext } from 'react';

import { useAppStore } from '@/runtime/core/context';
import type { WorkspaceValues } from '@/runtime/workspace/workspace-types';
import { workspaceKey, type WorkspaceTarget } from '@/shared/contracts/workspace';

export const WorkspaceScopeContext = createContext<WorkspaceTarget | undefined>(undefined);

export function useActiveWorkspaceTarget() {
  const scoped = useContext(WorkspaceScopeContext);
  const target = useAppStore((state) => state.registry.focus ?? state.registry.retainedFocus);
  return scoped ?? target;
}

// Domain hooks read the focused app values (with app-scope overrides) or the
// scoped runtime's raw values. The selector keeps the subscription local, so a
// transcript update does not re-render connection or project consumers.
export function useWorkspaceDomainValue<T>(select: (values: WorkspaceValues) => T, name: string): T {
  const target = useActiveWorkspaceTarget();
  const key = target ? workspaceKey(target) : undefined;
  const value = useAppStore((state) => {
    const focused = key && state.registry.focus && workspaceKey(state.registry.focus) === key ? state.focusedValues : undefined;
    const values = focused ?? (key ? state.registry.snapshots[key]?.values : undefined);
    return values ? select(values) : undefined;
  });
  if (value === undefined) throw new Error(`${name} must be used inside OpencodeProvider.`);
  return value;
}
