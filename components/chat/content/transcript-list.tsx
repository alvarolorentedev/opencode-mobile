import { MaterialCommunityIcons } from '@expo/vector-icons';
import { FlashList, type FlashListRef } from '@shopify/flash-list';
import { useLayoutEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { ActivityIndicator, Button, Card, Text, TouchableRipple } from 'react-native-paper';

import { TranscriptMessage } from '@/components/chat/chat-cards';
import { styles, slimStyles } from '@/components/chat/chat-view-styles';
import { STARTER_PROMPT_KEYS } from '@/components/chat/chat-view-utils';
import { TranscriptSkeleton } from '@/components/chat/content/transcript-skeleton';
import { Colors } from '@/constants/theme';
import type { TranscriptEntry } from '@/lib/opencode/format';
import type { Session } from '@/lib/opencode/types';

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

type TranscriptListProps = {
  activeSession?: Session;
  awaitingUserInput: boolean;
  connection: Connection;
  copiedMessageId?: string;
  currentActivityLabel?: string;
  currentSessionId?: string;
  displayTranscript: TranscriptEntry[];
  flatTranscript: boolean;
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
  onUnrevert: () => void;
  palette: Palette;
  pendingInteractions: number;
  retryAttempt?: number;
  running: boolean;
  speakingMessageId?: string;
  slim: boolean;
  transcriptFontSize: number;
};

export function TranscriptList({
  activeSession,
  awaitingUserInput,
  connection,
  copiedMessageId,
  currentActivityLabel,
  currentSessionId,
  displayTranscript,
  flatTranscript,
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
  onUnrevert,
  palette,
  pendingInteractions,
  retryAttempt,
  running,
  speakingMessageId,
  slim,
  transcriptFontSize,
}: TranscriptListProps) {
  const { t } = useTranslation();
  const transcriptRef = useRef<FlashListRef<TranscriptEntry>>(null);
  const shouldPositionInitialTranscriptRef = useRef(false);
  const previousTranscriptRef = useRef({ sessionId: currentSessionId, length: displayTranscript.length });

  useLayoutEffect(() => {
    const previous = previousTranscriptRef.current;
    if (previous.sessionId !== currentSessionId || (previous.length === 0 && displayTranscript.length > 0)) {
      shouldPositionInitialTranscriptRef.current = true;
    }
    previousTranscriptRef.current = { sessionId: currentSessionId, length: displayTranscript.length };
  }, [currentSessionId, displayTranscript.length]);

  const extraData = useMemo(() => ({ copiedMessageId, speakingMessageId, onReviewChanges }), [copiedMessageId, speakingMessageId, onReviewChanges]);

  return (
    <FlashList
      key={currentSessionId || 'no-session'}
      ref={transcriptRef}
      data={displayTranscript}
      style={styles.scroll}
      contentContainerStyle={[
        styles.content,
        slim && slimStyles.content,
        pendingInteractions > 0 ? { paddingBottom: 110 } : null,
      ]}
      extraData={extraData}
      keyboardDismissMode="on-drag"
      keyboardShouldPersistTaps="handled"
      keyExtractor={(entry) => `${entry.id}-${entry.createdAt}`}
      maintainVisibleContentPosition={MAINTAIN_VISIBLE_CONTENT_POSITION}
      onStartReached={hasOlderMessages ? onLoadOlderMessages : undefined}
      onStartReachedThreshold={0.5}
      onContentSizeChange={() => {
        if (!shouldPositionInitialTranscriptRef.current || displayTranscript.length === 0) {
          return;
        }
        shouldPositionInitialTranscriptRef.current = false;
        transcriptRef.current?.scrollToEnd({ animated: false });
      }}
      renderItem={({ item: entry }) => (
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
      )}
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
      ListEmptyComponent={isRefreshingMessages && currentSessionId ? (
        <TranscriptSkeleton palette={palette} />
      ) : (
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
      )}
      ListFooterComponent={(
        <View style={styles.transcriptFooter}>
          {activeSession?.revert ? (
            <Card mode="contained" style={[styles.noticeCard, { backgroundColor: palette.surface }]}>
              <Card.Content>
                <Text variant="titleMedium" style={{ color: palette.text }}>{t('chat:content.sessionReverted')}</Text>
                <Button mode="outlined" onPress={onUnrevert}>{t('chat:content.restoreReverted')}</Button>
              </Card.Content>
            </Card>
          ) : null}

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
