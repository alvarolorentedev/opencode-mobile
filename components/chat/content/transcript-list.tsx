import { MaterialCommunityIcons } from '@expo/vector-icons';
import { FlashList, type FlashListRef } from '@shopify/flash-list';
import { useIsFocused } from 'expo-router';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { AppState, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { ActivityIndicator, Button, Card, Text, TouchableRipple } from 'react-native-paper';

import { TranscriptMessage } from '@/components/chat/chat-cards';
import { CollapsibleDetail } from '@/components/chat/cards/collapsible-detail';
import { styles, slimStyles } from '@/components/chat/chat-view-styles';
import { STARTER_PROMPT_KEYS } from '@/components/chat/chat-view-utils';
import { TranscriptSkeleton } from '@/components/chat/content/transcript-skeleton';
import { Colors } from '@/constants/theme';
import type { TranscriptEntry } from '@/lib/opencode/format';
import type { TranscriptRow } from '@/lib/opencode/transcript';

type Palette = typeof Colors.light;
type Connection = { status: 'idle' | 'connecting' | 'connected' | 'error'; message: string };

// Stable reference so FlashList does not treat every parent render as a prop
// change. Combined with the memoized TranscriptMessage rows this keeps
// streaming refreshes from re-rendering untouched rows.
const MAINTAIN_VISIBLE_CONTENT_POSITION = {
  autoscrollToBottomThreshold: 0,
  animateAutoScrollToBottom: false,
  startRenderingFromBottom: true,
} as const;

// Treat the transcript as "reading history" once the viewport bottom is more
// than this many pixels from the content end; new content must not pull the
// user back to the newest message.
const TAIL_FOLLOW_THRESHOLD = 48;
// FlashList renders and measures progressively, so a single scrollToEnd can run
// against a partially measured list and settle at the top. Re-assert the tail
// across a few frames after a session switch or data change.
const TAIL_SETTLE_FRAMES = 4;

type TranscriptListProps = {
  awaitingUserInput: boolean;
  connection: Connection;
  copiedMessageId?: string;
  currentActivityLabel?: string;
  currentSessionId?: string;
  transcriptRows: TranscriptRow[];
  flatTranscript: boolean;
  hasMessages: boolean;
  hasOlderMessages: boolean;
  isLoadingOlderMessages: boolean;
  isRefreshingMessages: boolean;
  onCopyMessage: (entry: TranscriptEntry) => void;
  onForkMessage: (messageId: string) => void;
  onLoadOlderMessages: () => void;
  onReviewChanges: (messageId: string) => void;
  onRevertMessage: (messageId: string) => void;
  onSelectStarterPrompt: (prompt: string) => void;
  onToggleSpeak: (entry: TranscriptEntry) => void;
  palette: Palette;
  pendingInteractions: number;
  retryAttempt?: number;
  running: boolean;
  speakingMessageId?: string;
  slim: boolean;
  transcriptFontSize: number;
};

export function TranscriptList({
  awaitingUserInput,
  connection,
  copiedMessageId,
  currentActivityLabel,
  currentSessionId,
  transcriptRows,
  flatTranscript,
  hasMessages,
  hasOlderMessages,
  isLoadingOlderMessages,
  isRefreshingMessages,
  onCopyMessage,
  onForkMessage,
  onLoadOlderMessages,
  onReviewChanges,
  onRevertMessage,
  onSelectStarterPrompt,
  onToggleSpeak,
  palette,
  pendingInteractions,
  retryAttempt,
  running,
  speakingMessageId,
  slim,
  transcriptFontSize,
}: TranscriptListProps) {
  const { t } = useTranslation();
  const focused = useIsFocused();
  const transcriptRef = useRef<FlashListRef<TranscriptRow>>(null);
  const followTailRef = useRef(true);
  const lastOffsetRef = useRef(0);
  const settleFramesRef = useRef(0);
  const settleFrameRef = useRef<number | undefined>(undefined);
  const transcriptRowsRef = useRef(transcriptRows);
  useLayoutEffect(() => {
    transcriptRowsRef.current = transcriptRows;
  });

  // A newly selected session always opens at its newest message.
  useLayoutEffect(() => {
    followTailRef.current = true;
    lastOffsetRef.current = 0;
  }, [currentSessionId]);

  const settleToTail = useCallback(() => {
    settleFramesRef.current = TAIL_SETTLE_FRAMES;
    if (settleFrameRef.current !== undefined) return;
    const run = () => {
      settleFrameRef.current = undefined;
      if (!followTailRef.current || transcriptRowsRef.current.length === 0) {
        settleFramesRef.current = 0;
        return;
      }
      transcriptRef.current?.scrollToEnd({ animated: false });
      settleFramesRef.current -= 1;
      if (settleFramesRef.current > 0) settleFrameRef.current = requestAnimationFrame(run);
    };
    settleFrameRef.current = requestAnimationFrame(run);
  }, []);

  useEffect(() => () => {
    if (settleFrameRef.current !== undefined) cancelAnimationFrame(settleFrameRef.current);
  }, []);

  // Follow additions only while the user is parked at the bottom; FlashList's
  // maintainVisibleContentPosition keeps the visible position otherwise. Group
  // content grows without adding rows, so include the detail count.
  useEffect(() => {
    if (transcriptRows.length === 0) return;
    if (followTailRef.current) settleToTail();
  }, [currentSessionId, transcriptRows, settleToTail]);

  const restorePosition = useCallback(() => {
    if (transcriptRowsRef.current.length === 0) return;
    if (followTailRef.current) {
      settleToTail();
      return;
    }
    if (lastOffsetRef.current > 0) {
      transcriptRef.current?.scrollToOffset({ offset: lastOffsetRef.current, animated: false });
    }
  }, [settleToTail]);

  // Android detaches inactive tab screens, so returning to the tab can leave the
  // recycled list at offset 0 or undrawn until something forces a layout.
  useEffect(() => {
    if (!focused) return;
    restorePosition();
    transcriptRef.current?.recomputeViewableItems();
  }, [focused, restorePosition]);

  // Same protection when the app returns from the background or a locked screen.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') restorePosition();
    });
    return () => subscription.remove();
  }, [restorePosition]);

  const handleScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    lastOffsetRef.current = contentOffset.y;
    followTailRef.current = contentSize.height - (contentOffset.y + layoutMeasurement.height) <= TAIL_FOLLOW_THRESHOLD;
  }, []);

  const extraData = useMemo(() => ({ copiedMessageId, speakingMessageId, onReviewChanges }), [copiedMessageId, speakingMessageId, onReviewChanges]);

  return (
    <FlashList
      key={currentSessionId || 'no-session'}
      ref={transcriptRef}
      data={transcriptRows}
      style={styles.scroll}
      contentContainerStyle={[
        styles.content,
        slim && slimStyles.content,
        pendingInteractions > 0 ? { paddingBottom: 110 } : null,
      ]}
      extraData={extraData}
      keyboardDismissMode="on-drag"
      keyboardShouldPersistTaps="handled"
      keyExtractor={(row) => row.key}
      maintainVisibleContentPosition={MAINTAIN_VISIBLE_CONTENT_POSITION}
      onScroll={handleScroll}
      scrollEventThrottle={16}
      onStartReached={hasOlderMessages ? onLoadOlderMessages : undefined}
      onStartReachedThreshold={0.5}
      renderItem={({ item: row }) => {
        if (row.type === 'details') {
          return (
            <View style={[
              styles.transcriptItem,
              slim && slimStyles.transcriptItem,
              flatTranscript && (slim ? slimStyles.transcriptItemFlat : styles.transcriptItemFlat),
            ]}>
              <CollapsibleDetail flat={flatTranscript} fontSize={transcriptFontSize} group={row.group} palette={palette} />
            </View>
          );
        }

        const entry = row.entry;
        return (
          <View style={[
            styles.transcriptItem,
            slim && slimStyles.transcriptItem,
            flatTranscript && (slim ? slimStyles.transcriptItemFlat : styles.transcriptItemFlat),
          ]}>
            <TranscriptMessage
              canSpeak={entry.role === 'assistant' && Boolean(entry.text.trim())}
              copied={copiedMessageId === entry.id}
              entry={entry}
              flat={flatTranscript}
              fontSize={transcriptFontSize}
              slim={slim}
              onReviewChanges={onReviewChanges}
              onCopy={() => onCopyMessage(entry)}
              onFork={entry.role === 'user' ? () => onForkMessage(entry.id) : undefined}
              onRevert={entry.role === 'user' ? () => onRevertMessage(entry.id) : undefined}
              onToggleSpeak={() => onToggleSpeak(entry)}
              speaking={speakingMessageId === entry.id}
            />
          </View>
        );
      }}
      ListHeaderComponent={(
        <View>
          {isLoadingOlderMessages ? (
            <View style={{ alignItems: 'center', paddingVertical: 12 }}>
              <ActivityIndicator color={palette.tint} />
            </View>
          ) : null}
          {connection.status === 'error' ? (
            <Card mode="contained" style={[styles.noticeCard, styles.transcriptItem, { backgroundColor: palette.surface }]}>
              <Card.Content>
                <Text variant="titleMedium" style={{ color: palette.text }}>{t('chat:content.connectionIssue')}</Text>
                <Text variant="bodyMedium" style={{ color: palette.muted }}>{connection.message}</Text>
              </Card.Content>
            </Card>
          ) : null}
        </View>
      )}
      ListEmptyComponent={
        currentSessionId && isRefreshingMessages && !hasMessages ? (
          <TranscriptSkeleton palette={palette} />
        ) : currentSessionId && hasOlderMessages ? (
          <Card mode="contained" style={[styles.emptyCard, { backgroundColor: palette.surface }]}>
            <Card.Content style={styles.emptyContent}>
              <Text variant="titleMedium" style={{ color: palette.text }}>{t('chat:content.loadEarlier')}</Text>
              <Text variant="bodyMedium" style={{ color: palette.muted }}>{t('chat:content.loadEarlierDescription')}</Text>
              <Button mode="outlined" onPress={onLoadOlderMessages} loading={isLoadingOlderMessages} disabled={isLoadingOlderMessages}>
                {t('chat:content.loadEarlierAction')}
              </Button>
            </Card.Content>
          </Card>
        ) : currentSessionId && hasMessages ? null : (
          <Card mode="contained" style={[styles.emptyCard, { backgroundColor: palette.surface }]}>
            <Card.Content style={styles.emptyContent}>
              <Text variant="headlineSmall" style={[styles.emptyTitle, { color: palette.text }]}>{t('chat:starter.title')}</Text>
              <Text variant="bodyMedium" style={{ color: palette.muted }}>
                {t('chat:starter.description')}
              </Text>
              <View style={styles.promptStack}>
                {STARTER_PROMPT_KEYS.map((key) => (
                  <TouchableRipple
                    accessibilityRole="button"
                    accessibilityLabel={t(key)}
                    key={key}
                    style={[styles.promptCard, { borderColor: palette.border, backgroundColor: palette.background }]}
                    onPress={() => onSelectStarterPrompt(key === 'chat:starter.prompts.implement' ? `${t(key)}\n${t('chat:starter.bugSymptoms')}` : t(key))}>
                    <View style={styles.promptCardInner}>
                      <MaterialCommunityIcons name="lightning-bolt" size={18} color={palette.tint} />
                      <Text variant="bodyMedium" style={{ color: palette.text }}>{t(key)}</Text>
                    </View>
                  </TouchableRipple>
                ))}
              </View>
            </Card.Content>
          </Card>
        )
      }
      ListFooterComponent={(
        <View style={styles.transcriptFooter}>
          {running && !awaitingUserInput ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator color={palette.tint} />
              <Text style={{ color: palette.muted }}>
                {retryAttempt
                  ? t('chat:content.runningRetry', { attempt: retryAttempt })
                  : currentActivityLabel ? t('chat:content.runningActivity', { activity: currentActivityLabel.toLowerCase() }) : t('chat:content.runningGeneric')}
              </Text>
            </View>
          ) : null}
        </View>
      )}
    />
  );
}
