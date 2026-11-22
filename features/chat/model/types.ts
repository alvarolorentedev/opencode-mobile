import type { PendingPrompt } from '@/shared/protocol/opencode/prompt-inbox';

import type { Command, FileDiff, Todo } from '@/shared/protocol/opencode/types';

import type { PendingPermission, PendingQuestion, PendingQuestionAnswer } from '@/shared/protocol/opencode/client';

import type { SessionMessageRecord, TranscriptEntry } from '@/shared/presentation/format';

import type { SessionUsage } from '@/shared/presentation/usage';

import type { DiffScope } from '@/features/projects/index';

import type { SendPrompt , SendingState } from '@/shared/contracts/prompt-actions';
import type { SideQuestionAnswer } from '@/shared/contracts/session-commands';

// A selectable user turn that has a recorded snapshot diff.
export type DiffTurn = {
  id: string;
  number: number;
};

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
  commands: {
    available: Command[];
    execute: (sessionId: string, command: string, args: string, input?: Pick<import('@/shared/protocol/opencode/prompt-inbox').CommandOptions, 'attachments' | 'context'>) => Promise<SideQuestionAnswer | void>;
    executeShell: (sessionId: string, command: string) => Promise<void>;
  };
  availableSkills: import('@/shared/protocol/opencode/types').Skill[];
  availableReferences: import('@/shared/protocol/opencode/types').Reference[];
  switchSessionModel: (sessionId: string, model: NonNullable<import('@/shared/protocol/opencode/types').Session['model']>) => Promise<void>;
  sendPrompt: SendPrompt;
  abortSession: (sessionId: string) => Promise<void>;
  sendingState: SendingState;
  promptError?: { message: string; occurredAt: number; sessionId?: string; sourceTitle?: string };
  clearPromptError: () => void;
  // Content shared into the app from the OS share sheet, grouped so the context
  // surface does not grow one member per share concern.
};

