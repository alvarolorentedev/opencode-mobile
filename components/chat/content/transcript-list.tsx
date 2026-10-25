import { MaterialCommunityIcons } from '@expo/vector-icons';
import { FlashList, type FlashListRef } from '@shopify/flash-list';
import { useIsFocused } from 'expo-router';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { AppState, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { ActivityIndicator, Button, Card, Text, TouchableRipple } from 'react-native-paper';

import { TranscriptMessage } from '@/components/chat/chat-cards';
import { ActivityGroupRow } from '@/components/chat/cards/activity-group';
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
  positionKey?: string;
  positions?: Map<string, unknown>;
  activityRunning: boolean;
  connection: Connection;
  copiedMessageId?: string;
  currentSessionId?: string;
  transcriptRows: TranscriptRow[];
  flatTranscript: boolean;
  hasMessages: boolean;
  hasOlderMessages: boolean;
  isBootstrappingChat: boolean;
  isLoadingOlderMessages: boolean;
  isRefreshingMessages: boolean;
  onCopyMessage: (entry: TranscriptEntry) => void;
  onForkMessage: (entry: TranscriptEntry) => void;
  onLoadOlderMessages: () => void;
  onRetryTranscript: () => void;
  onRevertMessage: (entry: TranscriptEntry) => void;
  onSelectStarterPrompt: (prompt: string) => void;
  onToggleSpeak: (entry: TranscriptEntry) => void;
  palette: Palette;
  pendingInteractions: number;
  speakingMessageId?: string;
  slim: boolean;
  transcriptFontSize: number;
  transcriptReadError?: string;
};

export function TranscriptList({
  positionKey, positions,
  activityRunning,
  connection,
  copiedMessageId,
  currentSessionId,
  transcriptRows,
  flatTranscript,
  hasMessages,
  hasOlderMessages,
  isBootstrappingChat,
  isLoadingOlderMessages,
  isRefreshingMessages,
  onCopyMessage,
  onForkMessage,
  onLoadOlderMessages,
  onRetryTranscript,
  onRevertMessage,
  onSelectStarterPrompt,
  onToggleSpeak,
  palette,
  pendingInteractions,
  speakingMessageId,
  slim,
  transcriptFontSize,
  transcriptReadError,
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

  const identity = positionKey ?? currentSessionId ?? 'no-session';
  // Retained workspaces restore history; first visits start at the newest message.
  useLayoutEffect(() => {
    const saved = positions?.get(identity) as { follow: boolean; offset: number } | undefined;
    followTailRef.current = saved?.follow ?? true;
    lastOffsetRef.current = saved?.offset ?? 0;
  }, [identity, positions]);

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
  }, [identity, transcriptRows, settleToTail]);

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
    positions?.set(identity, { offset: lastOffsetRef.current, follow: followTailRef.current });
  }, [identity, positions]);

  // While the session runs, the newest activity run remains the visible
  // progress anchor even after its own tools complete.
  const lastActivityKey = useMemo(() => {
    for (let index = transcriptRows.length - 1; index >= 0; index -= 1) {
      if (transcriptRows[index].type === 'activity') return transcriptRows[index].key;
    }
    return undefined;
  }, [transcriptRows]);
  const extraData = useMemo(() => ({ copiedMessageId, speakingMessageId, activityRunning, lastActivityKey }), [copiedMessageId, speakingMessageId, activityRunning, lastActivityKey]);

  return (
    <FlashList
      key={identity}
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
      onLoad={restorePosition}
      onScroll={handleScroll}
      scrollEventThrottle={16}
      onStartReached={hasOlderMessages ? onLoadOlderMessages : undefined}
      onStartReachedThreshold={0.5}
      renderItem={({ item: row }) => {
        if (row.type === 'activity') {
          return (
            <View style={[
              styles.transcriptItem,
              slim && slimStyles.transcriptItem,
              flatTranscript && (slim ? slimStyles.transcriptItemFlat : styles.transcriptItemFlat),
            ]}>
              <ActivityGroupRow
                flat={flatTranscript}
                fontSize={transcriptFontSize}
                group={row.group}
                palette={palette}
                sessionRunning={activityRunning && row.key === lastActivityKey}
              />
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
              onCopy={onCopyMessage}
              onFork={entry.role === 'user' ? onForkMessage : undefined}
              onRevert={entry.role === 'user' ? onRevertMessage : undefined}
              onToggleSpeak={onToggleSpeak}
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
        (isBootstrappingChat || (currentSessionId && isRefreshingMessages)) && !hasMessages ? (
          <TranscriptSkeleton palette={palette} />
        ) : currentSessionId && transcriptReadError !== undefined && !hasMessages ? (
          <Card mode="contained" style={[styles.emptyCard, { backgroundColor: palette.surface }]}>
            <Card.Content style={styles.emptyContent}>
              <Text variant="titleMedium" style={{ color: palette.text }}>{t('chat:content.transcriptErrorTitle')}</Text>
              <Text variant="bodyMedium" style={{ color: palette.muted }}>{t('chat:content.transcriptErrorDescription')}</Text>
              {transcriptReadError.trim() ? <Text selectable variant="bodySmall" style={{ color: palette.muted }}>{transcriptReadError}</Text> : null}
              <Button mode="outlined" onPress={onRetryTranscript}>{t('chat:content.retryTranscript')}</Button>
            </Card.Content>
          </Card>
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
    />
  );
}
