import type { Session } from '@/shared/protocol/opencode/types';
import type { useWorkspaceConnections } from '@/runtime/workspace/use-workspace-connections';
import type { NewWorktreeChatResult, NewWorktreeChatTarget, WorkspaceCatalog, WorkspaceTarget } from '@/shared/contracts/workspace';
import type { SharedInput } from '@/features/sharing/index';
import { createContext, useContext, useMemo } from 'react';
import type { MissionOverview } from '@/features/sessions/runtime';
import { useAppCore, useAppStore } from '@/runtime/core/context';
import { useWorkspaceDomainValue } from '@/runtime/core/workspace-selectors';

export type WorkspaceRegistry = ReturnType<typeof useWorkspaceConnections> & {
  terminalTarget?: WorkspaceTarget;
  selectTerminalTarget: (target: WorkspaceTarget) => Promise<void>;
  inspectionTarget?: WorkspaceTarget;
  inspect: (target: WorkspaceTarget) => Promise<void>;
  sharedInput: SharedInput;
  catalogs: Record<string, WorkspaceCatalog>;
  mission: MissionOverview;
};
export type WorkspaceActions = {
  createChat: (target: WorkspaceTarget) => Promise<Session>;
  createChatInWorktree: (target: NewWorktreeChatTarget) => Promise<NewWorktreeChatResult>;
  focus?: WorkspaceTarget;
};
export const WorkspaceContext = createContext<WorkspaceRegistry | null>(null);
export function useWorkspaces() {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error('useWorkspaces must be used inside OpencodeProvider.');
  return value;
}
export function useWorkspaceActions(): WorkspaceActions {
  const { createChat, createChatInWorktree } = useAppCore().commands.workspace;
  const focus = useAppStore((state) => state.registry.focus);
  return useMemo(() => ({ createChat, createChatInWorktree, focus }), [createChat, createChatInWorktree, focus]);
}
export function useSharedInput() {
  return useWorkspaces().sharedInput;
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
export function useResolvedWorkspaceTarget(target?: WorkspaceTarget) {
  const { resolveKey } = useAppCore().commands.workspace;
  const availableKey = useAppStore(({ registry: { focus, snapshots } }) => {
    const requested = target ?? focus;
    const key = requested && resolveKey(requested);
    return key && snapshots[key] ? key : undefined;
  });
  return useMemo(() => {
    if (!availableKey) return undefined;
    const [connectionId, projectPath] = JSON.parse(availableKey) as [string, string];
    return { connectionId, projectPath };
  }, [availableKey]);
}
