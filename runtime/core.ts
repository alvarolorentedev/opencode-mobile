// Public app-core API for features. Import this, never runtime/core internals.
export { AppCoreProvider, useAppCore, useAppStore } from '@/runtime/core/context';
export { useActiveWorkspaceTarget, useConnectionLifecycle, useConnectionLifecycles, useWorkspaceConnectionSettings } from '@/runtime/core/workspace-selectors';
export { useProjectScope } from '@/runtime/core/project-scope';
export { useConnectedProjectScopes } from '@/runtime/core/connected-projects';
export { useCachedProjectTranscripts } from '@/runtime/core/cached-project-transcripts';
export type { AppCore } from '@/runtime/core/create-app-core';
export type { AppState, PromptOutbox, SelectionState } from '@/runtime/core/store';
