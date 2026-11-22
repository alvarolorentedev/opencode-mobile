import type { Session } from '@/shared/protocol/opencode/types';
import type { useWorkspaceConnections } from '@/runtime/workspace/use-workspace-connections';
import type { NewWorktreeChatResult, NewWorktreeChatTarget, WorkspaceCatalog, WorkspaceTarget } from '@/shared/contracts/workspace';
import type { WorkspaceValues } from '@/runtime/workspace/workspace-types';
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { MissionOverview } from '@/features/sessions/runtime';
import { useAppStore } from '@/runtime/core/context';
import { useWorkspaceDomainValue } from '@/runtime/core/workspace-selectors';

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
export function useWorkspacePreferences(target?: WorkspaceTarget) {
  return useWorkspaceDomainValue((values) => values.preferencesValue, 'useWorkspacePreferences', target);
}
export function useRetainedWorkspaceTarget(target?: WorkspaceTarget) {
  const { ensure, resolveKey, snapshots, focus, retainedFocus } = useWorkspaces();
  const requestedKey = target && resolveKey(target);
  const [retainedTarget, setRetainedTarget] = useState(target);
  const effective = requestedKey && snapshots[requestedKey] ? target : retainedTarget ?? focus ?? retainedFocus;
  const resolvedKey = effective ? resolveKey(effective) : undefined;
  useEffect(() => {
    if (!target) return;
    const controller = new AbortController();
    void ensure(target, { signal: controller.signal }).then(() => setRetainedTarget(target)).catch(() => undefined);
    return () => controller.abort();
  }, [target, ensure]);
  const availableKey = resolvedKey && snapshots[resolvedKey] ? resolvedKey : undefined;
  return useMemo(() => {
    if (!availableKey) return undefined;
    const [connectionId, projectPath] = JSON.parse(availableKey) as [string, string];
    return { connectionId, projectPath };
  }, [availableKey]);
}
