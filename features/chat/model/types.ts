import type { PendingPrompt } from '@/shared/protocol/opencode/prompt-inbox';

import type { Command, FileDiff, Todo } from '@/shared/protocol/opencode/types';

import type { PendingPermission, PendingQuestion, PendingQuestionAnswer } from '@/shared/protocol/opencode/client';

import type { SessionMessageRecord, TranscriptEntry } from '@/shared/presentation/format';

import type { SessionUsage } from '@/shared/presentation/usage';

import type { SharedInput } from '@/features/sharing/index';

import type { DiffScope , DiffTurn } from '@/shared/contracts/domain';

import type { SendPrompt , SendingState } from '@/shared/contracts/prompt-actions';

export type ChatContextValue = {
  pendingPrompts: PendingPrompt[];
  cancelPrompt: (sessionId: string, promptId: string) => Promise<void>;
  currentMessages: SessionMessageRecord[];
  currentTranscript: TranscriptEntry[];
  currentUsage: SessionUsage;
  latestAssistantTurnUsage?: SessionUsage;
  currentDiffs: FileDiff[];
  currentDiffScope: DiffScope;
  setDiffScope: (scope: DiffScope) => void;
  diffTurns: DiffTurn[];
  selectedDiffMessageId?: string;
  selectDiffMessage: (messageId: string) => void;
  refreshDiffs: (silent?: boolean) => Promise<void>;
  currentTodos: Todo[];
  currentPendingPermissions: PendingPermission[];
  currentPendingQuestions: PendingQuestion[];
  isRefreshingMessages: boolean;
  transcriptReadError?: string;
  retryTranscript: () => Promise<void>;
  isRefreshingDiffs: boolean;
  isBootstrappingChat: boolean;
  // Grouped so the domain context surface does not grow one member per paging
  // concern.
  transcriptPaging: {
    loadOlder: (sessionId: string) => Promise<void>;
    hasOlder: boolean;
    isLoadingOlder: boolean;
  };
  replyToPermission: (requestId: string, reply: 'once' | 'always' | 'reject') => Promise<void>;
  replyToQuestion: (requestId: string, answers: PendingQuestionAnswer[]) => Promise<void>;
  rejectQuestion: (requestId: string) => Promise<void>;
  commands: Command[];
  availableSkills: import('@/shared/protocol/opencode/types').Skill[];
  availableReferences: import('@/shared/protocol/opencode/types').Reference[];
  searchProjectFiles: (query: string) => Promise<string[]>;
  executeCommand: (sessionId: string, command: string, args: string) => Promise<void>;
  executeShell: (sessionId: string, command: string) => Promise<void>;
  sendPrompt: SendPrompt;
  abortSession: (sessionId: string) => Promise<void>;
  setAutoApprove: (enabled: boolean) => Promise<void>;
  sendingState: SendingState;
  promptError?: { message: string; occurredAt: number; sessionId?: string; sourceTitle?: string };
  clearPromptError: () => void;
  // Content shared into the app from the OS share sheet, grouped so the context
  // surface does not grow one member per share concern.
  sharedInput: SharedInput;
};

