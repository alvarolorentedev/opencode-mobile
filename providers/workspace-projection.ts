import { aggregateSessionUsage } from '@/lib/opencode/usage';
import type { WorkspaceValues } from '@/providers/workspace-types';

// A closed project's runtime stays mounted so drafts and retained state survive.
// Public workspace values must not keep exposing that project or its session.
export function projectClosedValues(values: WorkspaceValues): WorkspaceValues {
  return {
    ...values,
    projectsValue: {
      ...values.projectsValue,
      projects: [],
      activeProjectPath: undefined,
      activeProject: undefined,
      isRefreshingProjectCatalog: false,
    },
    projectFilesValue: {
      ...values.projectFilesValue,
      projectFileStatuses: [],
      projectFile: { ...values.projectFilesValue.projectFile, selected: undefined },
      vcsInfo: undefined,
      worktrees: { entries: [], loading: false },
    },
    currentSessionValue: {
      ...values.currentSessionValue,
      currentSessionId: undefined,
      activeSession: undefined,
      createSession: async () => { throw new Error('Choose a project before creating a chat.'); },
      ensureActiveSession: async () => undefined,
    },
    sessionLibraryValue: {
      ...values.sessionLibraryValue,
      sessions: [],
      sessionStatuses: {},
      sessionPreviewById: {},
    },
    chatValue: {
      ...values.chatValue,
      pendingPrompts: [],
      currentMessages: [],
      currentTranscript: [],
      currentUsage: aggregateSessionUsage([]),
      latestAssistantTurnUsage: undefined,
      currentDiffs: [],
      diffTurns: [],
      selectedDiffMessageId: undefined,
      currentTodos: [],
      currentPendingPermissions: [],
      currentPendingQuestions: [],
      isRefreshingMessages: false,
      transcriptReadError: undefined,
      isRefreshingDiffs: false,
      isBootstrappingChat: false,
      transcriptPaging: { ...values.chatValue.transcriptPaging, hasOlder: false },
      commands: [],
      availableSkills: [],
      availableReferences: [],
      sendingState: { active: false },
      promptError: undefined,
    },
    conversationValue: {
      ...values.conversationValue,
      conversation: {
        ...values.conversationValue.conversation,
        active: false,
        phase: 'off',
        inputPhase: 'off',
        readbackPhase: 'idle',
        isListening: false,
        level: 0,
        statusLabel: undefined,
      },
    },
    terminalValue: {
      ...values.terminalValue,
      terminals: [],
      activeTerminalId: undefined,
      terminalRuntime: { ...values.terminalValue.terminalRuntime, instances: [] },
    },
  };
}
