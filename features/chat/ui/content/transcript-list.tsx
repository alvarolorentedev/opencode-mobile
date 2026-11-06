import { cn } from '@/shared/ui/cn';
import { Spinner } from '@/shared/ui/spinner';
import { Text } from '@/shared/ui/text';
import { CardContent, Card } from '@/shared/ui/card';
import { Button } from '@/shared/ui/button';
import { Icon } from '@/shared/ui/icon';
import { Pressable } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { FlashList, type FlashListRef } from '@shopify/flash-list';
import { useIsFocused } from 'expo-router';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AppState, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';

import { getModelVariantLabel } from '@/features/ai/index';
import { TranscriptMessage } from '@/features/chat/ui/chat-cards';
import { ActivityGroupRow } from '@/features/chat/ui/cards/activity-group';
import { CompactionDivider } from '@/features/chat/ui/cards/compaction-divider';
import { styles, slimStyles, stylesClasses } from '@/features/chat/ui/chat-view-styles';
import { getCurrentTurnActivityKey, getEntryModelLabel, getPinnedActivityKey, STARTER_PROMPT_KEYS } from '@/features/chat/ui/chat-view-utils';
import { TranscriptSkeleton } from '@/features/chat/ui/content/transcript-skeleton';
import { Colors } from '@/shared/ui/theme/theme';
import type { TranscriptEntry } from '@/shared/presentation/format';
import type { ActivityGroup, TranscriptRow } from '@/shared/presentation/transcript';

type Palette = typeof Colors.light;
type Connection = { status: 'idle' | 'connecting' | 'connected' | 'error'; message: string };

// A transient status occupies the same activity-row footprint while no real
// activity row exists (the start of a turn or a Messages-only transcript).
type ActivityStatusRow = { key: string; type: 'activityStatus'; label: string };
type TranscriptListItem = TranscriptRow | ActivityStatusRow;

const ACTIVITY_STATUS_KEY = 'activity-status:session';
const noExpansionChange = () => undefined;
const ACTIVITY_STATUS_GROUP: ActivityGroup = {
  key: 'session-status',
  kind: 'activity',
  items: [],
  tools: [],
  callCount: 0,
  status: 'running',
};

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
  activityStatusLabel?: string;
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
  modelLabels?: ReadonlyMap<string, string>;
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
  activityStatusLabel,
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
  modelLabels,
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
  const rows = useMemo<TranscriptListItem[]>(() => (
    activityStatusLabel
      ? [...transcriptRows, { key: ACTIVITY_STATUS_KEY, type: 'activityStatus', label: activityStatusLabel }]
      : transcriptRows
  ), [activityStatusLabel, transcriptRows]);
  const transcriptRef = useRef<FlashListRef<TranscriptListItem>>(null);
  const followTailRef = useRef(true);
  const lastOffsetRef = useRef(0);
  const settleFramesRef = useRef(0);
  const settleFrameRef = useRef<number | undefined>(undefined);
  const transcriptRowsRef = useRef<TranscriptListItem[]>(rows);
  const previousRowCountRef = useRef(rows.length);
  const [detached, setDetached] = useState(false);
  const [unseen, setUnseen] = useState(false);
  const [expandedActivityKeys, setExpandedActivityKeys] = useState<ReadonlySet<string>>(() => new Set());
  const [pinnedActivityKey, setPinnedActivityKey] = useState<string>();
  useLayoutEffect(() => {
    transcriptRowsRef.current = rows;
  });

  const identity = positionKey ?? currentSessionId ?? 'no-session';
  // Retained workspaces restore history; first visits start at the newest message.
  useLayoutEffect(() => {
    const saved = positions?.get(identity) as { follow: boolean; offset: number } | undefined;
    const followsTail = saved?.follow ?? true;
    followTailRef.current = followsTail;
    lastOffsetRef.current = saved?.offset ?? 0;
    previousRowCountRef.current = transcriptRowsRef.current.length;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- restoring a retained scroll position changes the visible affordance.
    setDetached(!followsTail);
    setUnseen(false);
    // A new session must not inherit the previous transcript's expanded runs.
    setExpandedActivityKeys((current) => (current.size > 0 ? new Set() : current));
    // The pinned copy belongs to the previous session's scroll position.
    setPinnedActivityKey(undefined);
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

  const setActivityExpanded = useCallback((key: string, expanded: boolean) => {
    setExpandedActivityKeys((current) => {
      if (current.has(key) === expanded) return current;
      const next = new Set(current);
      if (expanded) next.add(key);
      else next.delete(key);
      return next;
    });
  }, []);

  // A long expanded run keeps its level-one header reachable: while the run
  // covers the viewport top, render a pinned copy that collapses it in place.
  const updatePinnedActivity = useCallback(() => {
    let next: string | undefined;
    if (expandedActivityKeys.size > 0) {
      try {
        const list = transcriptRef.current;
        if (list) {
          next = getPinnedActivityKey(
            transcriptRowsRef.current,
            expandedActivityKeys,
            lastOffsetRef.current,
            list.getFirstItemOffset(),
            (index) => list.getLayout(index),
          );
        }
      } catch {
        // FlashList may not have a layout manager yet during early restore.
        next = undefined;
      }
    }
    setPinnedActivityKey((current) => (current === next ? current : next));
  }, [expandedActivityKeys]);

  useEffect(() => {
    updatePinnedActivity();
  }, [rows, updatePinnedActivity]);

  const collapsePinnedActivity = useCallback(() => {
    const key = pinnedActivityKey;
    if (!key) return;
    const index = transcriptRowsRef.current.findIndex((row) => row.type === 'activity' && row.group.key === key);
    setActivityExpanded(key, false);
    setPinnedActivityKey(undefined);
    if (index < 0) return;
    requestAnimationFrame(() => {
      const list = transcriptRef.current;
      if (list) void list.scrollToIndex({ index, viewPosition: 0, animated: false }).catch(() => undefined);
    });
  }, [pinnedActivityKey, setActivityExpanded]);

  // Follow additions only while the user is parked at the bottom; FlashList's
  // maintainVisibleContentPosition keeps the visible position otherwise. Group
  // content grows without adding rows, so include the detail count.
  useEffect(() => {
    if (rows.length === 0) return;
    if (followTailRef.current) settleToTail();
  }, [identity, rows, settleToTail]);

  useEffect(() => {
    const grew = rows.length > previousRowCountRef.current;
    previousRowCountRef.current = rows.length;
    if (!followTailRef.current && grew) {
      setUnseen(true);
    } else if (followTailRef.current) {
      setUnseen(false);
    }
  }, [rows]);

  const restorePosition = useCallback(() => {
    if (transcriptRowsRef.current.length === 0) return;
    if (followTailRef.current) {
      settleToTail();
      updatePinnedActivity();
      return;
    }
    if (lastOffsetRef.current > 0) {
      transcriptRef.current?.scrollToOffset({ offset: lastOffsetRef.current, animated: false });
    }
    updatePinnedActivity();
  }, [settleToTail, updatePinnedActivity]);

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
    const followsTail = contentSize.height - (contentOffset.y + layoutMeasurement.height) <= TAIL_FOLLOW_THRESHOLD;
    followTailRef.current = followsTail;
    setDetached(!followsTail);
    if (followsTail) setUnseen(false);
    positions?.set(identity, { offset: lastOffsetRef.current, follow: followsTail });
    updatePinnedActivity();
  }, [identity, positions, updatePinnedActivity]);

  const jumpToLatest = useCallback(() => {
    followTailRef.current = true;
    setDetached(false);
    setUnseen(false);
    positions?.set(identity, { offset: lastOffsetRef.current, follow: true });
    settleToTail();
  }, [identity, positions, settleToTail]);

  // While the session runs, the current turn's newest activity run remains the
  // visible progress anchor even after its own tools complete.
  const lastActivityKey = useMemo(() => getCurrentTurnActivityKey(transcriptRows), [transcriptRows]);
  const extraData = useMemo(() => ({ activityStatusLabel, copiedMessageId, speakingMessageId, activityRunning, lastActivityKey, modelLabels, expandedActivityKeys }), [activityStatusLabel, copiedMessageId, speakingMessageId, activityRunning, lastActivityKey, modelLabels, expandedActivityKeys]);
  const pinnedRow = pinnedActivityKey
    ? rows.find((row) => row.type === 'activity' && row.group.key === pinnedActivityKey)
    : undefined;

  return (
    <View className={cn(stylesClasses.transcriptContainer)}>
      <FlashList
      key={identity}
      ref={transcriptRef}
      data={rows}
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
        if (row.type === 'activityStatus') {
          return (
            <View style={[
              styles.transcriptItem,
              slim && slimStyles.transcriptItem,
              flatTranscript && (slim ? slimStyles.transcriptItemFlat : styles.transcriptItemFlat),
            ]}>
              <ActivityGroupRow
                expanded={false}
                flat={flatTranscript}
                fontSize={transcriptFontSize}
                group={ACTIVITY_STATUS_GROUP}
                onExpandedChange={noExpansionChange}
                palette={palette}
                statusLabel={row.label}
              />
            </View>
          );
        }

        if (row.type === 'activity') {
          return (
            <View style={[
              styles.transcriptItem,
              slim && slimStyles.transcriptItem,
              flatTranscript && (slim ? slimStyles.transcriptItemFlat : styles.transcriptItemFlat),
            ]}>
              <ActivityGroupRow
                expanded={expandedActivityKeys.has(row.group.key)}
                flat={flatTranscript}
                fontSize={transcriptFontSize}
                group={row.group}
                onExpandedChange={(expanded) => setActivityExpanded(row.group.key, expanded)}
                palette={palette}
                sessionRunning={activityRunning && row.key === lastActivityKey}
              />
            </View>
          );
        }

        if (row.type === 'compaction') {
          return (
            <View style={[
              styles.transcriptItem,
              slim && slimStyles.transcriptItem,
              flatTranscript && (slim ? slimStyles.transcriptItemFlat : styles.transcriptItemFlat),
            ]}>
              <CompactionDivider detail={row.detail} palette={palette} />
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
              canSpeak={entry.role === 'assistant' && !entry.notice && Boolean(entry.text.trim())}
              copied={copiedMessageId === entry.id}
              entry={entry}
              flat={flatTranscript}
              fontSize={transcriptFontSize}
              modelLabel={getEntryModelLabel(
                entry,
                modelLabels,
                entry.model?.variant ? getModelVariantLabel(entry.model.variant, t) : undefined,
              )}
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
              <Spinner color={palette.tint} />
            </View>
          ) : null}
          {connection.status === 'error' ? (
            <Card style={[styles.noticeCard, styles.transcriptItem, { backgroundColor: palette.surface }]}><CardContent><Text style={{ color: palette.text }} variant="title">{t('chat:content.connectionIssue')}</Text><Text style={{ color: palette.muted }} variant="description">{connection.message}</Text></CardContent></Card>
          ) : null}
        </View>
      )}
      ListEmptyComponent={
        (isBootstrappingChat || (currentSessionId && isRefreshingMessages)) && !hasMessages ? (
          <TranscriptSkeleton palette={palette} />
        ) : currentSessionId && transcriptReadError !== undefined && !hasMessages ? (
          <Card style={[styles.emptyCard, { backgroundColor: palette.surface }]}><CardContent style={styles.emptyContent}><Text style={{ color: palette.text }} variant="title">{t('chat:content.transcriptErrorTitle')}</Text><Text style={{ color: palette.muted }} variant="description">{t('chat:content.transcriptErrorDescription')}</Text>{transcriptReadError.trim() ? <Text selectable style={{ color: palette.muted }} variant="label">{transcriptReadError}</Text> : null}<Button onPress={onRetryTranscript} variant="outline"><Text>{t('chat:content.retryTranscript')}</Text></Button></CardContent></Card>
        ) : currentSessionId && hasOlderMessages ? (
          <Card style={[styles.emptyCard, { backgroundColor: palette.surface }]}><CardContent style={styles.emptyContent}><Text style={{ color: palette.text }} variant="title">{t('chat:content.loadEarlier')}</Text><Text style={{ color: palette.muted }} variant="description">{t('chat:content.loadEarlierDescription')}</Text><Button onPress={onLoadOlderMessages} disabled={isLoadingOlderMessages} variant="outline">{isLoadingOlderMessages ? <Spinner size="small" /> : null}<Text>{t('chat:content.loadEarlierAction')}</Text></Button></CardContent></Card>
        ) : currentSessionId && hasMessages ? null : (
          <Card style={[styles.emptyCard, { backgroundColor: palette.surface }]}><CardContent style={styles.emptyContent}><Text style={[styles.emptyTitle, { color: palette.text }]} variant="display">{t('chat:starter.title')}</Text><Text style={{ color: palette.muted }} variant="description">{t('chat:starter.description')}</Text><View style={styles.promptStack}>
                {STARTER_PROMPT_KEYS.map((key) => (
                  <Pressable accessibilityRole="button" accessibilityLabel={t(key)} key={key} style={[styles.promptCard, { borderColor: palette.border, backgroundColor: palette.background }]} onPress={() => onSelectStarterPrompt(key === 'chat:starter.prompts.implement' ? `${t(key)}\n${t('chat:starter.bugSymptoms')}` : t(key))}><View style={styles.promptCardInner}>
                      <MaterialCommunityIcons name="lightning-bolt" size={18} color={palette.tint} />
                      <Text style={{ color: palette.text }} variant="description">{t(key)}</Text>
                    </View></Pressable>
                ))}
              </View></CardContent></Card>
        )
      }
      />
      {detached && rows.length > 0 ? (
        <View pointerEvents="box-none" style={styles.jumpToLatestWrap}>
          <Button testID="chat-jump-to-latest" onPress={jumpToLatest} variant="default"><Icon name={"arrow-down"} size={20} /><Text>{unseen ? t('chat:content.newMessages') : t('chat:content.jumpToLatest')}</Text></Button>
        </View>
      ) : null}
      {pinnedRow && pinnedRow.type === 'activity' && expandedActivityKeys.has(pinnedRow.group.key) ? (
        <View pointerEvents="box-none" style={[styles.pinnedActivity, { backgroundColor: palette.background, paddingHorizontal: slim ? 8 : 12 }]}>
          <ActivityGroupRow
            expanded
            headerOnly
            fontSize={transcriptFontSize}
            group={pinnedRow.group}
            onExpandedChange={collapsePinnedActivity}
            palette={palette}
            pinned
            sessionRunning={activityRunning && pinnedRow.key === lastActivityKey}
          />
        </View>
      ) : null}
    </View>
  );
}
