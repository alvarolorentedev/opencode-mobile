import type { Session } from '@/shared/protocol/opencode/types';
import type { useWorkspaceConnections } from '@/runtime/workspace/use-workspace-connections';
import { workspaceKey, type NewWorktreeChatResult, type NewWorktreeChatTarget, type WorkspaceCatalog, type WorkspaceTarget } from '@/shared/contracts/workspace';
import type { WorkspaceValues } from '@/runtime/workspace/workspace-types';
import { createContext, useContext, useEffect, useMemo, useState, type PropsWithChildren } from 'react';
import { ActivityIndicator, View } from 'react-native';
import type { MissionOverview } from '@/features/sessions/runtime';
import { useAppStore } from '@/runtime/core/context';
import { WorkspaceScopeContext, WorkspaceValuesContext } from '@/runtime/core/workspace-scope';
export { WorkspaceScopeContext };

export type WorkspaceRegistry = ReturnType<typeof useWorkspaceConnections> & {
  createChat: (target: WorkspaceTarget) => Promise<Session>;
  createChatInWorktree: (target: NewWorktreeChatTarget) => Promise<NewWorktreeChatResult>;
  terminalTarget?: WorkspaceTarget;
  selectTerminalTarget: (target: WorkspaceTarget) => Promise<void>;
  inspectionTarget?: WorkspaceTarget;
  inspect: (target: WorkspaceTarget) => Promise<void>;
  valuesFor: (target?: WorkspaceTarget) => WorkspaceValues | undefined;
  catalogs: Record<string, WorkspaceCatalog>;
  mission: MissionOverview;
};
export type WorkspaceActions = {
  createChat: (target: WorkspaceTarget) => Promise<Session>;
  createChatInWorktree: (target: NewWorktreeChatTarget) => Promise<NewWorktreeChatResult>;
  focus?: WorkspaceTarget;
};
export const WorkspaceContext = createContext<WorkspaceRegistry | null>(null);
export const WorkspaceActionsContext = createContext<WorkspaceActions | null>(null);
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
// Presentation state is stable and independent of the changing snapshot
// registry. It lives in the app store so drafts and scroll positions never
// re-render on a background workspace publish.
export function useWorkspacePresentation() {
  return useAppStore((state) => state.presentation);
}
export function WorkspaceScope({ target, children }: PropsWithChildren<{ target?: WorkspaceTarget }>) {
  const registry = useWorkspaces();
  const { ensure, valuesFor, resolveKey } = registry;
  const incoming = useMemo(() => valuesFor(target), [target, valuesFor]);
  const [retainedTarget, setRetainedTarget] = useState(target);
  const effective = incoming ? target : retainedTarget;
  const values = incoming ?? (retainedTarget ? valuesFor(retainedTarget) : undefined);
  const key = target && workspaceKey(target);
  // The snapshot key can be the placeholder project while the target names the
  // active project. Provide the resolved target so domain selectors look up
  // the same snapshot that valuesFor found.
  const resolvedKey = effective ? resolveKey(effective) : undefined;
  const resolvedTarget = resolvedKey
    ? (([connectionId, projectPath]) => ({ connectionId, projectPath }))(JSON.parse(resolvedKey) as [string, string])
    : effective;
  useEffect(() => {
    if (!target) return;
    const controller = new AbortController();
    void ensure(target, { signal: controller.signal }).then(() => setRetainedTarget(target)).catch(() => undefined);
    return () => controller.abort();
  }, [key, target, ensure]);
  return values ? <WorkspaceScopeContext.Provider value={resolvedTarget ?? registry.focus ?? registry.retainedFocus}><WorkspaceValuesContext.Provider value={values}>{children}</WorkspaceValuesContext.Provider></WorkspaceScopeContext.Provider>
    : <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator /></View>;
}
