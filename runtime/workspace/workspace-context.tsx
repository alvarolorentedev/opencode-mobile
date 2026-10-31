import type { Session } from '@/shared/protocol/opencode/types';
import { useUpdates } from '@/features/updates/context';
import { OpencodeProviderTree } from '@/runtime/workspace/domain-provider-tree';
import type { ProjectPathsByConnection } from '@/shared/contracts/domain';
import type { useWorkspaceConnections } from '@/runtime/workspace/use-workspace-connections';
import { workspaceKey, type NewWorktreeChatResult, type NewWorktreeChatTarget, type WorkspaceCatalog, type WorkspaceTarget } from '@/shared/contracts/workspace';
import type { WorkspaceValues } from '@/runtime/workspace/workspace-types';
import { createContext, useContext, useEffect, useMemo, useState, type PropsWithChildren } from 'react';
import { ActivityIndicator, View } from 'react-native';

export type WorkspaceRegistry = ReturnType<typeof useWorkspaceConnections> & {
  createChat: (target: WorkspaceTarget) => Promise<Session>;
  createChatInWorktree: (target: NewWorktreeChatTarget) => Promise<NewWorktreeChatResult>;
  terminalTarget?: WorkspaceTarget;
  selectTerminalTarget: (target: WorkspaceTarget) => Promise<void>;
  inspectionTarget?: WorkspaceTarget;
  inspect: (target: WorkspaceTarget) => Promise<void>;
  valuesFor: (target?: WorkspaceTarget) => WorkspaceValues | undefined;
  catalogs: Record<string, WorkspaceCatalog>;
  projectPathsByConnection: ProjectPathsByConnection;
};
export type WorkspaceActions = {
  createChat: (target: WorkspaceTarget) => Promise<Session>;
  createChatInWorktree: (target: NewWorktreeChatTarget) => Promise<NewWorktreeChatResult>;
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
  const [retainedTarget, setRetainedTarget] = useState(target);
  const values = incoming ?? (retainedTarget ? valuesFor(retainedTarget) : undefined);
  const key = target && workspaceKey(target);
  useEffect(() => {
    if (!target) return;
    const controller = new AbortController();
    void ensure(target, { signal: controller.signal }).then(() => setRetainedTarget(target)).catch(() => undefined);
    return () => controller.abort();
  }, [key, target, ensure]);
  return values ? <WorkspaceScopeContext.Provider value={target ?? registry.focus}><OpencodeProviderTree values={values} updates={updates}>{children}</OpencodeProviderTree></WorkspaceScopeContext.Provider>
    : <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator /></View>;
}
