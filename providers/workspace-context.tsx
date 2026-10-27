import { createContext, useContext, useEffect, useMemo, useState, type PropsWithChildren } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useUpdates } from '@/providers/opencode-contexts';
import type { Session } from '@/lib/opencode/types';
import { OpencodeProviderTree } from '@/providers/opencode-provider-tree';
import { useWorkspaceConnections } from '@/providers/use-workspace-connections';
import { workspaceKey, type WorkspaceTarget, type WorkspaceValues } from '@/providers/workspace-types';

export type WorkspaceRegistry = ReturnType<typeof useWorkspaceConnections> & {
  createChat: (target: WorkspaceTarget) => Promise<Session>;
  terminalTarget?: WorkspaceTarget;
  selectTerminalTarget: (target: WorkspaceTarget) => Promise<void>;
  inspectionTarget?: WorkspaceTarget;
  inspect: (target: WorkspaceTarget) => Promise<void>;
  valuesFor: (target?: WorkspaceTarget) => WorkspaceValues | undefined;
};
export type WorkspaceActions = {
  createChat: (target: WorkspaceTarget) => Promise<Session>;
  focus?: WorkspaceTarget;
};
export const WorkspaceScopeContext = createContext<WorkspaceTarget | undefined>(undefined);
export const WorkspaceContext = createContext<WorkspaceRegistry | null>(null);
export const WorkspaceActionsContext = createContext<WorkspaceActions | null>(null);
// Presentation state is stable and independent of the changing snapshot
// registry. Keeping it in its own context stops drafts and scroll positions
// from re-rendering on every background workspace publish.
export const WorkspacePresentationContext = createContext<Map<string, unknown> | null>(null);
export function useWorkspaces() {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error('useWorkspaces must be used inside OpencodeProvider.');
  return value;
}
export function useWorkspaceActions() {
  const value = useContext(WorkspaceActionsContext);
  if (!value) throw new Error('useWorkspaceActions must be used inside OpencodeProvider.');
  return value;
}
export function useWorkspacePresentation() {
  const value = useContext(WorkspacePresentationContext);
  if (!value) throw new Error('useWorkspacePresentation must be used inside OpencodeProvider.');
  return value;
}
export function WorkspaceScope({ target, children }: PropsWithChildren<{ target?: WorkspaceTarget }>) {
  const registry = useWorkspaces();
  const updates = useUpdates();
  const { ensure, valuesFor } = registry;
  const incoming = useMemo(() => valuesFor(target), [target, valuesFor]);
  const [retained, setRetained] = useState(incoming);
  if (incoming && retained !== incoming) setRetained(incoming);
  const values = incoming ?? retained;
  const key = target && workspaceKey(target);
  useEffect(() => { if (target && !incoming) void ensure(target).catch(() => undefined); }, [key, target, incoming, ensure]);
  return values ? <WorkspaceScopeContext.Provider value={target ?? registry.focus}><OpencodeProviderTree values={values} updates={updates}>{children}</OpencodeProviderTree></WorkspaceScopeContext.Provider>
    : <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator /></View>;
}
