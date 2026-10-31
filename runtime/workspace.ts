export { useWorkspaces, useWorkspaceActions, useWorkspacePresentation, WorkspaceScope } from '@/runtime/workspace/workspace-context';
export { useRetainedState } from '@/runtime/presentation/use-retained-state';
export { hasWorkspaceDrafts, clearWorkspacePresentation } from '@/runtime/presentation/workspace-presentation';
export type { WorkspaceRegistry, WorkspaceActions } from '@/runtime/workspace/workspace-context';
export type { WorkspaceSnapshot, WorkspaceValues } from '@/runtime/workspace/workspace-types';
export { workspaceKey, sessionKey } from '@/shared/contracts/workspace';
export type { WorkspaceTarget, SessionTarget, ConnectionRecord, WorkspaceCatalog, NewWorktreeChatTarget, NewWorktreeChatResult } from '@/shared/contracts/workspace';
export { useSharedInput } from './workspace/entry-state';
export { useOnboarding as useBootState } from '@/features/onboarding/context';
