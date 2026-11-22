// Public app-core API for features. Import this, never runtime/core internals.
export { AppCoreProvider, useAppCore, useAppStore } from '@/runtime/core/context';
export { WorkspaceScopeContext, WorkspaceValuesContext, useActiveWorkspaceTarget, useWorkspaceDomainValue } from '@/runtime/core/workspace-scope';
export type { AppCore } from '@/runtime/core/create-app-core';
export type { AppState, ChatUiState, PromptUiState, RegistryState, SelectionState, ShellState } from '@/runtime/core/store';
