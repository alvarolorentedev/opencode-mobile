import { type ReactNode } from 'react';
import { View } from 'react-native';

import { styles } from '@/components/chat/chat-view-styles';
import { ChangesOverlay } from '@/components/chat/content/changes-overlay';
import { PendingInteractions } from '@/components/chat/content/pending-interactions';
import { TranscriptList } from '@/components/chat/content/transcript-list';
import { Colors } from '@/constants/theme';
import type { TranscriptEntry } from '@/lib/opencode/format';
import type { FileDiff, Session, Todo } from '@/lib/opencode/types';
import type { DiffScope, DiffTurn } from '@/providers/opencode-provider-types';
import type { PendingPermission, PendingQuestion, PendingQuestionAnswer } from '@/lib/opencode/client';

type Palette = typeof Colors.light;
type DiffDetail = Extract<TranscriptEntry['details'][number], { kind: 'patch' }>;

type ChatContentProps = {
  activeSession?: Session;
  progressAction?: ReactNode;
  progressVisible: boolean;
  onCloseProgress: () => void;
  changesVisible: boolean;
  onCloseChanges: () => void;
  awaitingUserInput: boolean;
  connection: { status: 'idle' | 'connecting' | 'connected' | 'error'; message: string };
  copiedMessageId?: string;
  currentActivityLabel?: string;
  currentDiffs: FileDiff[];
  currentDiffScope: DiffScope;
  currentPendingPermissions: PendingPermission[];
  currentPendingQuestions: PendingQuestion[];
  currentTodos: Todo[];
  currentSessionId?: string;
  diffCount: number;
  diffDetails: DiffDetail[];
  diffTurns: DiffTurn[];
  displayTranscript: TranscriptEntry[];
  flatTranscript: boolean;
  hasMessages: boolean;
  hasOlderMessages: boolean;
  isLoadingOlderMessages: boolean;
  onLoadOlderMessages: () => void;
  slim: boolean;
  transcriptFontSize: number;
  expandedDiffId?: string;
  isRefreshingMessages: boolean;
  onCopyMessage: (entry: TranscriptEntry) => void;
  onForkMessage: (messageId: string) => void;
  onRevertMessage: (messageId: string) => void;
  onUnrevert: () => void;
  onExpandDiff: (id?: string) => void;
  onSelectDiffScope: (scope: DiffScope) => void;
  onSelectDiffMessage: (messageId: string) => void;
  selectedDiffMessageId?: string;
  onReplyToPermission: (requestId: string, reply: 'once' | 'always' | 'reject') => Promise<void>;
  onRejectQuestion: (requestId: string) => Promise<void>;
  onReplyToQuestion: (requestId: string, answers: PendingQuestionAnswer[]) => Promise<void>;
  onReviewChanges: (messageId: string) => void;
  onSelectStarterPrompt: (prompt: string) => void;
  onToggleSpeak: (entry: TranscriptEntry) => void;
  palette: Palette;
  pendingInteractions: number;
  retryAttempt?: number;
  running: boolean;
  speakingMessageId?: string;
};

export function ChatContent({ ...props }: ChatContentProps) {
  return (
    <View style={styles.chatArea}>
      <TranscriptList
        activeSession={props.activeSession}
        awaitingUserInput={props.awaitingUserInput}
        connection={props.connection}
        copiedMessageId={props.copiedMessageId}
        currentActivityLabel={props.currentActivityLabel}
        currentSessionId={props.currentSessionId}
        displayTranscript={props.displayTranscript}
        flatTranscript={props.flatTranscript}
        hasMessages={props.hasMessages}
        hasOlderMessages={props.hasOlderMessages}
        isLoadingOlderMessages={props.isLoadingOlderMessages}
        isRefreshingMessages={props.isRefreshingMessages}
        onCopyMessage={props.onCopyMessage}
        onForkMessage={props.onForkMessage}
        onLoadOlderMessages={props.onLoadOlderMessages}
        onReviewChanges={props.onReviewChanges}
        onRevertMessage={props.onRevertMessage}
        onSelectStarterPrompt={props.onSelectStarterPrompt}
        onToggleSpeak={props.onToggleSpeak}
        onUnrevert={props.onUnrevert}
        palette={props.palette}
        pendingInteractions={props.pendingInteractions}
        retryAttempt={props.retryAttempt}
        running={props.running}
        speakingMessageId={props.speakingMessageId}
        slim={props.slim}
        transcriptFontSize={props.transcriptFontSize}
      />
      <ChangesOverlay
        changesVisible={props.changesVisible}
        connection={props.connection}
        currentDiffScope={props.currentDiffScope}
        currentDiffs={props.currentDiffs}
        currentSessionId={props.currentSessionId}
        diffCount={props.diffCount}
        diffDetails={props.diffDetails}
        diffTurns={props.diffTurns}
        expandedDiffId={props.expandedDiffId}
        onCloseChanges={props.onCloseChanges}
        onExpandDiff={props.onExpandDiff}
        onSelectDiffMessage={props.onSelectDiffMessage}
        onSelectDiffScope={props.onSelectDiffScope}
        palette={props.palette}
        selectedDiffMessageId={props.selectedDiffMessageId}
      />
      <PendingInteractions
        changesVisible={props.changesVisible}
        currentPendingPermissions={props.currentPendingPermissions}
        currentPendingQuestions={props.currentPendingQuestions}
        currentTodos={props.currentTodos}
        diffCount={props.diffCount}
        onCloseProgress={props.onCloseProgress}
        onRejectQuestion={props.onRejectQuestion}
        onReplyToPermission={props.onReplyToPermission}
        onReplyToQuestion={props.onReplyToQuestion}
        palette={props.palette}
        progressAction={props.progressAction}
        progressVisible={props.progressVisible}
      />
    </View>
  );
}
