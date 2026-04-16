import { MaterialCommunityIcons } from '@expo/vector-icons';
import { RefObject } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { ActivityIndicator, Button, Card, List, Text, TouchableRipple } from 'react-native-paper';

import { Colors } from '@/constants/theme';
import { DiffCard, PendingInteractionsCard, SessionDiffCard, TranscriptMessage } from '@/components/chat/chat-cards';
import { getSessionSubtitle, type TranscriptEntry } from '@/lib/opencode/format';
import type { FileDiff, Session, SessionStatus } from '@/lib/opencode/types';
import type { PendingPermissionRequest, PendingQuestionAnswer, PendingQuestionRequest } from '@/lib/opencode/client';

import { styles } from '@/components/chat/chat-view-styles';
import { STARTER_PROMPTS } from '@/components/chat/chat-view-utils';

type Palette = typeof Colors.light;
type DiffDetail = Extract<TranscriptEntry['details'][number], { kind: 'patch' | 'file' }>;

type ChatContentProps = {
  activeSession?: Session;
  activeTab: 'session' | 'changes';
  awaitingUserInput: boolean;
  connection: { status: 'idle' | 'connecting' | 'connected' | 'error'; message: string };
  copiedMessageId?: string;
  currentActivityLabel?: string;
  currentDiffs: FileDiff[];
  currentPendingPermissions: PendingPermissionRequest[];
  currentPendingQuestions: PendingQuestionRequest[];
  currentSessionId?: string;
  diffDetails: DiffDetail[];
  displayTranscript: TranscriptEntry[];
  expandedDiffId?: string;
  hasMoreTranscript: boolean;
  isRefreshingDiffs: boolean;
  isRefreshingMessages: boolean;
  onCopyMessage: (entry: TranscriptEntry) => void;
  onExpandDiff: (id?: string) => void;
  onLoadEarlier: () => void;
  onRefresh: () => void;
  onReplyToPermission: (requestId: string, reply: 'once' | 'always' | 'reject') => void;
  onReplyToQuestion: (requestId: string, answers: PendingQuestionAnswer[]) => void;
  onRejectQuestion: (requestId: string) => void;
  onSendStarterPrompt: (prompt: string) => void;
  onToggleSpeak: (entry: TranscriptEntry) => void;
  palette: Palette;
  pendingInteractions: number;
  running: boolean;
  scrollRef: RefObject<ScrollView | null>;
  speakingMessageId?: string;
  status?: SessionStatus;
  visibleTranscript: TranscriptEntry[];
};

export function ChatContent({
  activeSession,
  activeTab,
  awaitingUserInput,
  connection,
  copiedMessageId,
  currentActivityLabel,
  currentDiffs,
  currentPendingPermissions,
  currentPendingQuestions,
  diffDetails,
  displayTranscript,
  expandedDiffId,
  hasMoreTranscript,
  isRefreshingDiffs,
  isRefreshingMessages,
  onCopyMessage,
  onExpandDiff,
  onLoadEarlier,
  onRefresh,
  onReplyToPermission,
  onReplyToQuestion,
  onRejectQuestion,
  onSendStarterPrompt,
  onToggleSpeak,
  palette,
  pendingInteractions,
  running,
  scrollRef,
  speakingMessageId,
  status,
  visibleTranscript,
}: ChatContentProps) {
  return (
    <ScrollView
      ref={scrollRef}
      style={styles.scroll}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={isRefreshingMessages || isRefreshingDiffs} onRefresh={onRefresh} tintColor={palette.tint} />}>
      {connection.status === 'error' ? (
        <Card mode="contained" style={[styles.noticeCard, { backgroundColor: palette.surface }]}>
          <Card.Content>
            <Text variant="titleMedium" style={{ color: palette.text }}>Connection issue</Text>
            <Text variant="bodyMedium" style={{ color: palette.muted }}>{connection.message}</Text>
          </Card.Content>
        </Card>
      ) : null}

      {activeTab === 'session' && displayTranscript.length === 0 ? (
        <Card mode="contained" style={[styles.emptyCard, { backgroundColor: palette.surface }]}>
          <Card.Content style={styles.emptyContent}>
            <Text variant="headlineSmall" style={[styles.emptyTitle, { color: palette.text }]}>Start a new task</Text>
            <Text variant="bodyMedium" style={{ color: palette.muted }}>
              Keep the prompt specific and OpenCode will inspect the workspace, show progress, and stream back file changes.
            </Text>
            <View style={styles.promptStack}>
              {STARTER_PROMPTS.map((prompt) => (
                <TouchableRipple
                  key={prompt}
                  style={[styles.promptCard, { borderColor: palette.border, backgroundColor: palette.background }]}
                  onPress={() => onSendStarterPrompt(prompt)}>
                  <View style={styles.promptCardInner}>
                    <MaterialCommunityIcons name="lightning-bolt" size={18} color={palette.tint} />
                    <Text variant="bodyMedium" style={{ color: palette.text }}>{prompt}</Text>
                  </View>
                </TouchableRipple>
              ))}
            </View>
          </Card.Content>
        </Card>
      ) : null}

      {activeTab === 'session' && hasMoreTranscript ? (
        <View style={styles.paginationRow}>
          <Button mode="text" onPress={onLoadEarlier}>Load earlier messages</Button>
        </View>
      ) : null}

      {activeTab === 'session'
        ? visibleTranscript.map((entry, index) => (
            <TranscriptMessage
              key={`${entry.id}-${entry.createdAt}-${index}`}
              canSpeak={entry.role === 'assistant' && Boolean(entry.text.trim())}
              copied={copiedMessageId === entry.id}
              entry={entry}
              onCopy={() => onCopyMessage(entry)}
              onToggleSpeak={() => onToggleSpeak(entry)}
              speaking={speakingMessageId === entry.id}
            />
          ))
        : null}

      {activeTab === 'session' && pendingInteractions > 0 ? (
        <PendingInteractionsCard
          permissions={currentPendingPermissions}
          questions={currentPendingQuestions}
          onPermissionReply={onReplyToPermission}
          onQuestionReject={onRejectQuestion}
          onQuestionSubmit={onReplyToQuestion}
        />
      ) : null}

      {activeTab === 'changes' ? (
        <View style={styles.sectionStack}>
          <Card mode="contained" style={[styles.sectionCard, { backgroundColor: palette.surface }]}>
            <Card.Content style={styles.sectionHeaderCard}>
              <View>
                <Text variant="titleMedium" style={{ color: palette.text }}>Workspace diff</Text>
                <Text variant="bodyMedium" style={{ color: palette.muted }}>
                  {activeSession ? getSessionSubtitle(activeSession) : 'Current session'}
                </Text>
              </View>
              <Text variant="labelMedium" style={{ color: palette.tint }}>{isRefreshingDiffs ? 'Syncing' : status?.type || 'idle'}</Text>
            </Card.Content>
          </Card>

          {currentDiffs.length === 0 && diffDetails.length === 0 ? (
            <Card mode="contained" style={[styles.sectionCard, { backgroundColor: palette.surface }]}>
              <Card.Content>
                <Text variant="bodyMedium" style={{ color: palette.muted }}>No file changes yet.</Text>
              </Card.Content>
            </Card>
          ) : null}

          {currentDiffs.length > 0 || diffDetails.length > 0 ? (
            <Card mode="contained" style={[styles.sectionCard, { backgroundColor: palette.surface }]}>
              <Card.Content style={styles.diffListCardContent}>
                <List.AccordionGroup expandedId={expandedDiffId} onAccordionPress={(id) => onExpandDiff(expandedDiffId === String(id) ? undefined : String(id))}>
                  {currentDiffs.map((diff) => {
                    const accordionId = `diff:${diff.file}`;
                    return <SessionDiffCard key={diff.file} accordionId={accordionId} diff={diff} expanded={expandedDiffId === accordionId} />;
                  })}
                  {currentDiffs.length === 0
                    ? diffDetails.map((detail) => {
                        const accordionId = `detail:${detail.id}`;
                        return <DiffCard key={detail.id} accordionId={accordionId} detail={detail} expanded={expandedDiffId === accordionId} />;
                      })
                    : null}
                </List.AccordionGroup>
              </Card.Content>
            </Card>
          ) : null}
        </View>
      ) : null}

      {activeTab === 'session' && awaitingUserInput ? (
        <Card mode="contained" style={[styles.noticeCard, { backgroundColor: palette.surface }]}>
          <Card.Content style={styles.waitingNoticeContent}>
            <View style={styles.waitingNoticeHeader}>
              <MaterialCommunityIcons name="alert-circle-outline" size={18} color={palette.warning} />
              <Text variant="titleMedium" style={{ color: palette.text }}>Waiting for your input</Text>
            </View>
            <Text style={{ color: palette.muted }}>
              OpenCode is blocked on {pendingInteractions === 1 ? 'a response' : `${pendingInteractions} responses`} below.
            </Text>
          </Card.Content>
        </Card>
      ) : null}

      {activeTab === 'session' && running && !awaitingUserInput ? (
        <View style={styles.loadingRow}>
          <ActivityIndicator color={palette.tint} />
          <Text style={{ color: palette.muted }}>
            {currentActivityLabel ? `OpenCode is ${currentActivityLabel.toLowerCase()}...` : 'OpenCode is working through the current step...'}
          </Text>
        </View>
      ) : null}
    </ScrollView>
  );
}
