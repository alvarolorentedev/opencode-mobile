// Public app-core API for features. Import this, never runtime/core internals.
export { AppCoreProvider, useAppCore, useAppStore } from '@/runtime/core/context';
export { useActiveWorkspaceTarget, useWorkspaceDomainValue } from '@/runtime/core/workspace-selectors';
export { useProjectScope } from '@/runtime/core/project-scope';
export type { AppCore } from '@/runtime/core/create-app-core';
export type { AppState, ChatUiState, PromptOutbox, PromptUiState, RegistryState, SelectionState, ShellState } from '@/runtime/core/store';
