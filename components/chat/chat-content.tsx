import { MaterialCommunityIcons } from '@expo/vector-icons';
import { FlashList, type FlashListRef } from '@shopify/flash-list';
import { useLayoutEffect, useRef, useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { ActivityIndicator, Button, Card, IconButton, Text, TouchableRipple } from 'react-native-paper';

import { Colors } from '@/constants/theme';
import { DiffCard, PendingInteractionsCard, SessionDiffCard, TranscriptMessage } from '@/components/chat/chat-cards';
import type { TranscriptEntry } from '@/lib/opencode/format';
import type { FileDiff, Session, SessionStatus, Todo } from '@/lib/opencode/types';
import type { PendingPermissionRequest, PendingQuestionAnswer, PendingQuestionRequest } from '@/lib/opencode/client';

import { styles } from '@/components/chat/chat-view-styles';
import { STARTER_PROMPTS } from '@/components/chat/chat-view-utils';

type Palette = typeof Colors.light;
type DiffDetail = Extract<TranscriptEntry['details'][number], { kind: 'patch' }>;

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
  currentTodos: Todo[];
  currentSessionId?: string;
  diffCount: number;
  diffDetails: DiffDetail[];
  displayTranscript: TranscriptEntry[];
  expandedDiffId?: string;
  isRefreshingDiffs: boolean;
  isRefreshingMessages: boolean;
  onCopyMessage: (entry: TranscriptEntry) => void;
  onForkMessage: (messageId: string) => void;
  onRevertMessage: (messageId: string) => void;
  onUnrevert: () => void;
  onExpandDiff: (id?: string) => void;
  onRefresh: () => void;
  onReplyToPermission: (requestId: string, reply: 'once' | 'always' | 'reject') => void;
  onRejectQuestion: (requestId: string) => void;
  onReplyToQuestion: (requestId: string, answers: PendingQuestionAnswer[]) => void;
  onSendStarterPrompt: (prompt: string) => void;
  onToggleSpeak: (entry: TranscriptEntry) => void;
  palette: Palette;
  pendingInteractions: number;
  running: boolean;
  speakingMessageId?: string;
  status?: SessionStatus;
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
  currentTodos,
  currentSessionId,
  diffCount,
  diffDetails,
  displayTranscript,
  expandedDiffId,
  isRefreshingDiffs,
  isRefreshingMessages,
  onCopyMessage,
  onForkMessage,
  onRevertMessage,
  onUnrevert,
  onExpandDiff,
  onRefresh,
  onRejectQuestion,
  onReplyToPermission,
  onReplyToQuestion,
  onSendStarterPrompt,
  onToggleSpeak,
  palette,
  pendingInteractions,
  running,
  speakingMessageId,
  status,
}: ChatContentProps) {
  const [todosExpanded, setTodosExpanded] = useState(false);
  const transcriptRef = useRef<FlashListRef<TranscriptEntry>>(null);
  const shouldPositionInitialTranscriptRef = useRef(false);
  const previousTranscriptRef = useRef({ sessionId: currentSessionId, length: displayTranscript.length });
  const completedTodoCount = currentTodos.filter((todo) => todo.status === 'completed').length;

  useLayoutEffect(() => {
    const previous = previousTranscriptRef.current;
    if (previous.sessionId !== currentSessionId || (previous.length === 0 && displayTranscript.length > 0)) {
      shouldPositionInitialTranscriptRef.current = true;
    }
    previousTranscriptRef.current = { sessionId: currentSessionId, length: displayTranscript.length };
  }, [currentSessionId, displayTranscript.length]);

  return (
    <View style={styles.chatArea}>
      {activeTab === 'session' ? (
        <FlashList
          key={currentSessionId || 'no-session'}
          ref={transcriptRef}
          data={displayTranscript}
          style={styles.scroll}
          contentContainerStyle={[
            styles.content,
            currentTodos.length > 0 ? { paddingBottom: todosExpanded ? 320 : 76 } : null,
          ]}
          extraData={{ copiedMessageId, speakingMessageId }}
          keyboardShouldPersistTaps="handled"
          keyExtractor={(entry) => `${entry.id}-${entry.createdAt}`}
          maintainVisibleContentPosition={{
            autoscrollToBottomThreshold: 0,
            animateAutoScrollToBottom: false,
            startRenderingFromBottom: true,
          }}
          onContentSizeChange={() => {
            if (!shouldPositionInitialTranscriptRef.current || displayTranscript.length === 0) {
              return;
            }
            shouldPositionInitialTranscriptRef.current = false;
            transcriptRef.current?.scrollToEnd({ animated: false });
          }}
          refreshControl={<RefreshControl refreshing={isRefreshingMessages} onRefresh={onRefresh} tintColor={palette.tint} />}
          renderItem={({ item: entry }) => (
            <View style={styles.transcriptItem}>
              <TranscriptMessage
                canSpeak={entry.role === 'assistant' && Boolean(entry.text.trim())}
                copied={copiedMessageId === entry.id}
                entry={entry}
                onCopy={() => onCopyMessage(entry)}
                onFork={entry.role === 'user' ? () => onForkMessage(entry.id) : undefined}
                onRevert={entry.role === 'user' ? () => onRevertMessage(entry.id) : undefined}
                onToggleSpeak={() => onToggleSpeak(entry)}
                speaking={speakingMessageId === entry.id}
              />
            </View>
          )}
          ListHeaderComponent={connection.status === 'error' ? (
            <Card mode="contained" style={[styles.noticeCard, styles.transcriptItem, { backgroundColor: palette.surface }]}>
              <Card.Content>
                <Text variant="titleMedium" style={{ color: palette.text }}>Connection issue</Text>
                <Text variant="bodyMedium" style={{ color: palette.muted }}>{connection.message}</Text>
              </Card.Content>
            </Card>
          ) : null}
          ListEmptyComponent={(
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
          )}
          ListFooterComponent={(
            <View style={styles.transcriptFooter}>
              {pendingInteractions > 0 ? (
                <PendingInteractionsCard
                  permissions={currentPendingPermissions}
                  questions={currentPendingQuestions}
                  onPermissionReply={onReplyToPermission}
                  onQuestionReject={onRejectQuestion}
                  onQuestionReply={onReplyToQuestion}
                />
              ) : null}

              {activeSession?.revert ? (
                <Card mode="contained" style={[styles.noticeCard, { backgroundColor: palette.surface }]}>
                  <Card.Content>
                    <Text variant="titleMedium" style={{ color: palette.text }}>Session is reverted</Text>
                    <Button mode="outlined" onPress={onUnrevert}>Restore reverted work</Button>
                  </Card.Content>
                </Card>
              ) : null}

              {awaitingUserInput ? (
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

              {running && !awaitingUserInput ? (
                <View style={styles.loadingRow}>
                  <ActivityIndicator color={palette.tint} />
                  <Text style={{ color: palette.muted }}>
                    {currentActivityLabel ? `OpenCode is ${currentActivityLabel.toLowerCase()}...` : 'OpenCode is working through the current step...'}
                  </Text>
                </View>
              ) : null}
            </View>
          )}
        />
      ) : (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.content}
          refreshControl={<RefreshControl refreshing={isRefreshingDiffs} onRefresh={onRefresh} tintColor={palette.tint} />}>
          {connection.status === 'error' ? (
            <Card mode="contained" style={[styles.noticeCard, { backgroundColor: palette.surface }]}>
              <Card.Content>
                <Text variant="titleMedium" style={{ color: palette.text }}>Connection issue</Text>
                <Text variant="bodyMedium" style={{ color: palette.muted }}>{connection.message}</Text>
              </Card.Content>
            </Card>
          ) : null}

          <View style={styles.sectionStack}>
          <Card mode="contained" style={[styles.sectionCard, { backgroundColor: palette.surface }]}>
            <Card.Content style={styles.sectionHeaderCard}>
              <View>
                <Text variant="titleMedium" style={{ color: palette.text }}>Latest turn diff</Text>
                <Text variant="bodyMedium" style={{ color: palette.muted }}>
                  {currentDiffs.length > 0
                    ? `${diffCount} files changed, +${currentDiffs.reduce((total, diff) => total + diff.additions, 0)} / -${currentDiffs.reduce((total, diff) => total + diff.deletions, 0)}`
                    : `${diffCount} files changed`}
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
                {currentDiffs.map((diff) => {
                  const accordionId = `diff:${diff.file}`;
                  return <SessionDiffCard key={accordionId} diff={diff} expanded={expandedDiffId === accordionId} onPress={() => onExpandDiff(expandedDiffId === accordionId ? undefined : accordionId)} />;
                })}
                {currentDiffs.length === 0
                  ? diffDetails.map((detail) => {
                      const accordionId = `detail:${detail.id}`;
                      return <DiffCard key={detail.id} detail={detail} expanded={expandedDiffId === accordionId} onPress={() => onExpandDiff(expandedDiffId === accordionId ? undefined : accordionId)} />;
                    })
                  : null}
              </Card.Content>
            </Card>
          ) : null}
          </View>
        </ScrollView>
      )}

      {activeTab === 'session' && currentTodos.length > 0 ? (
        <Card mode="elevated" style={[styles.todoOverlay, { backgroundColor: palette.surface, borderColor: palette.border }]}>
          <Card.Content style={styles.todoHeader}>
            <Text variant="labelLarge" style={[styles.todoSummary, { color: palette.text }]}>
              {`${completedTodoCount} of ${currentTodos.length} tasks completed`}
            </Text>
            <IconButton
              accessibilityLabel={todosExpanded ? 'Collapse tasks' : 'Expand tasks'}
              icon={todosExpanded ? 'chevron-down' : 'chevron-up'}
              size={20}
              style={styles.todoToggleButton}
              onPress={() => setTodosExpanded((expanded) => !expanded)}
            />
          </Card.Content>
          {todosExpanded ? (
            <ScrollView style={styles.todoListScroll} contentContainerStyle={styles.todoList} nestedScrollEnabled>
              {currentTodos.map((todo, index) => (
                <View key={`${todo.content}-${index}`} style={styles.todoItemRow}>
                  <IconButton icon={todo.status === 'completed' ? 'check-circle' : todo.status === 'in_progress' ? 'progress-clock' : 'circle-outline'} size={20} disabled style={styles.todoStatusIcon} />
                  <View style={styles.todoTextWrap}>
                    <Text variant="bodyMedium" style={{ color: palette.text }}>{todo.content || 'Untitled task'}</Text>
                    {todo.priority ? <Text variant="bodySmall" style={{ color: palette.muted }}>{todo.priority}</Text> : null}
                  </View>
                </View>
              ))}
            </ScrollView>
          ) : null}
        </Card>
      ) : null}
    </View>
  );
}
