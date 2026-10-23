import { MaterialCommunityIcons } from '@expo/vector-icons';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Keyboard, StyleSheet, View } from 'react-native';
import { Chip, IconButton, Surface, Text } from 'react-native-paper';

import { AttachmentStrip } from '@/components/chat/attachment-strip';
import { MarkdownText } from '@/components/chat/chat-markdown';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { formatTimestamp, type TranscriptEntry } from '@/lib/opencode/format';
import { summarizeTranscriptDetails } from '@/lib/opencode/transcript';

type TranscriptMessageProps = {
  canSpeak?: boolean;
  copied?: boolean;
  entry: TranscriptEntry;
  flat?: boolean;
  fontSize: number;
  onCopy: () => void;
  onReviewChanges?: (messageId: string) => void;
  onFork?: () => void;
  onRevert?: () => void;
  onToggleSpeak: () => void;
  slim?: boolean;
  speaking?: boolean;
};

function TranscriptMessageImpl({
  canSpeak = false,
  copied = false,
  entry,
  flat = false,
  fontSize,
  onCopy,
  onReviewChanges,
  onFork,
  onRevert,
  onToggleSpeak,
  slim = false,
  speaking = false,
}: TranscriptMessageProps) {
  const { t } = useTranslation();
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const isUser = entry.role === 'user';
  // Non-flat user bubbles stay dark in both themes, so their code surface must
  // use the dark palette. Flat messages follow the active theme's text color.
  const codePalette = !flat && isUser ? Colors.dark.code : palette.code;
  const attachments = entry.details.filter((detail) => detail.kind === 'file').map((detail) => ({ uri: detail.uri || '', mime: detail.mime, filename: detail.filename || detail.label }));
  const summaryDetails = entry.details.filter((detail) => detail.kind === 'patch' || detail.kind === 'file' || detail.kind === 'retry');
  const patchSummary = t('chat:cards.updatedPatches', { count: entry.details.filter((detail) => detail.kind === 'patch').length });
  const detailSummary = summarizeTranscriptDetails(summaryDetails, { patches: (count) => t('chat:cards.updatedPatches', { count }), files: (count) => t('chat:cards.fileCount', { count }) });
  const textColor = flat ? palette.text : isUser ? palette.onBubbleUser : palette.onBubbleAssistant;
  const metaColor = flat ? palette.muted : isUser ? palette.onBubbleUser : palette.muted;
  const accentColor = flat ? palette.tint : isUser ? palette.onBubbleUser : palette.tint;
  const slimSpacing = slim ? (flat ? { paddingVertical: 2, gap: 4 } : { borderRadius: 14, gap: 6, paddingHorizontal: 10, paddingVertical: 8 }) : null;

  return (
    <View style={[styles.messageRow, flat ? styles.messageRowFlat : isUser && styles.messageRowUser]}>
      <View onTouchEnd={Keyboard.dismiss} style={styles.messageTouchable}>
        <Surface
          testID={`transcript-message-${entry.id}`}
          style={[
            styles.messageBubble,
            flat ? styles.messageFlat : isUser ? styles.messageBubbleUser : styles.messageBubbleAssistant,
            flat
              ? null
              : {
                  backgroundColor: isUser ? palette.bubbleUser : palette.bubbleAssistant,
                  borderColor: copied ? palette.tint : isUser ? palette.bubbleUser : palette.border,
                },
            slimSpacing,
            copied && !flat ? styles.messageBubbleCopied : null,
          ]}
          elevation={flat ? 0 : 1}>
          <View style={[styles.messageMeta, slim && { gap: 8 }]}>
            <Text variant="labelMedium" style={{ color: metaColor }}>{isUser ? t('chat:cards.you') : t('chat:cards.opencode')}</Text>
            <View style={styles.messageMetaRight}>
              <IconButton
                accessibilityLabel={t('common:actions.copy')}
                icon="content-copy"
                size={slim ? 14 : 16}
                style={styles.messageActionButton}
                iconColor={palette.muted}
                onPress={onCopy}
              />
              {copied ? (
                <View style={[styles.copiedPill, { backgroundColor: flat ? `${palette.tint}18` : isUser ? `${palette.onBubbleUser}20` : `${palette.tint}18` }]}> 
                  <MaterialCommunityIcons name="check" size={12} color={accentColor} />
                  <Text variant="labelSmall" style={{ color: accentColor }}>{t('chat:cards.copied')}</Text>
                </View>
              ) : null}
              {canSpeak ? (
                <IconButton
                  accessibilityLabel={t(speaking ? 'chat:cards.stopReadAloud' : 'chat:cards.readAloud')}
                  icon={speaking ? 'stop' : 'volume-high'}
                  size={slim ? 14 : 16}
                  style={styles.messageActionButton}
                  iconColor={palette.muted}
                  onPress={onToggleSpeak}
                />
              ) : null}
              {onFork ? <IconButton accessibilityLabel={t('chat:cards.fork')} icon="source-fork" size={slim ? 14 : 16} style={styles.messageActionButton} iconColor={palette.muted} onPress={onFork} /> : null}
              {onRevert ? <IconButton accessibilityLabel={t('chat:cards.revert')} icon="undo-variant" size={slim ? 14 : 16} style={styles.messageActionButton} iconColor={palette.muted} onPress={onRevert} /> : null}
              <Text variant="labelSmall" style={{ color: metaColor, opacity: isUser && !flat ? 0.82 : 1 }}>
                {formatTimestamp(entry.createdAt)}
              </Text>
            </View>
          </View>
          {attachments.length > 0 ? <AttachmentStrip attachments={attachments} /> : null}
          {entry.text ? (
            <MarkdownText
              codePalette={codePalette}
              text={entry.text}
              color={textColor}
              fontSize={fontSize}
              mutedColor={flat ? palette.muted : isUser ? palette.onBubbleUser : palette.muted}
            />
          ) : null}
          {entry.error ? <Text variant="bodyMedium" style={{ color: palette.danger }}>{entry.error}</Text> : null}
          {!isUser && detailSummary.length > 0 ? (
            <View style={styles.summaryRow}>
              {detailSummary.map((item) => (
                <Chip key={item} onPress={item === patchSummary && onReviewChanges ? () => onReviewChanges(entry.id) : undefined} accessibilityLabel={item === patchSummary ? `${item}. ${t('chat:cards.reviewChanges')}` : item} compact mode="flat" style={[styles.summaryChip, { backgroundColor: palette.background }]}>
                  {item}
                </Chip>
              ))}
            </View>
          ) : null}
        </Surface>
      </View>
    </View>
  );
}

// Re-render only when entry identity or visible state changes.
// Review actions also depend on the current session's parent-message mapping.
function areTranscriptMessagePropsEqual(prev: TranscriptMessageProps, next: TranscriptMessageProps) {
  return (
    prev.entry === next.entry &&
    prev.fontSize === next.fontSize &&
    prev.flat === next.flat &&
    prev.slim === next.slim &&
    prev.copied === next.copied &&
    prev.speaking === next.speaking &&
    prev.canSpeak === next.canSpeak &&
    prev.onReviewChanges === next.onReviewChanges
  );
}

export const TranscriptMessage = memo(TranscriptMessageImpl, areTranscriptMessagePropsEqual);

const styles = StyleSheet.create({
  messageRow: { alignItems: 'flex-start' },
  messageRowUser: { alignItems: 'flex-end' },
  messageRowFlat: { alignItems: 'stretch' },
  messageTouchable: { alignSelf: 'stretch', borderRadius: 24 },
  messageBubble: {
    borderRadius: 24,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 10,
    alignSelf: 'stretch',
    minWidth: 0,
    overflow: 'hidden',
  },
  messageFlat: {
    borderRadius: 0,
    borderWidth: 0,
    paddingHorizontal: 0,
    paddingVertical: 4,
    gap: 6,
    alignSelf: 'stretch',
    minWidth: 0,
    backgroundColor: 'transparent',
  },
  messageBubbleUser: { borderBottomRightRadius: 10, marginLeft: '8%', marginRight: 8 },
  messageBubbleAssistant: { borderBottomLeftRadius: 10, marginRight: '8%', marginLeft: 8 },
  messageBubbleCopied: { shadowOpacity: 0.12, shadowRadius: 12, shadowOffset: { width: 0, height: 6 } },
  messageMeta: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  messageMetaRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  messageActionButton: { margin: 0 },
  copiedPill: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4 },
  summaryRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  summaryChip: { alignSelf: 'flex-start' },
});
