import { cn } from '@/shared/ui/cn';
import { Text } from '@/shared/ui/text';
import { Button } from '@/shared/ui/button';
import { Icon } from '@/shared/ui/icon';
import { Badge } from '@/shared/ui/badge';
import { withAlpha } from '@/shared/ui/theme/color';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Keyboard, StyleSheet, View } from 'react-native';

import { AttachmentStrip } from '@/features/sharing/index';
import { MarkdownText } from '@/features/chat/ui/chat-markdown';
import { getColors } from '@/shared/ui/theme/theme';
import { usePalette } from '@/shared/ui/theme/use-palette';
import { useAppearance } from '@/shared/ui/theme/appearance-context';
import { formatTimestamp, type TranscriptEntry } from '@/shared/presentation/format';
import { summarizeTranscriptDetails } from '@/shared/presentation/transcript';

type TranscriptMessageProps = {
  canSpeak?: boolean;
  copied?: boolean;
  entry: TranscriptEntry;
  flat?: boolean;
  fontSize: number;
  onCopy: (entry: TranscriptEntry) => void;
  onFork?: (entry: TranscriptEntry) => void;
  onRevert?: (entry: TranscriptEntry) => void;
  onToggleSpeak: (entry: TranscriptEntry) => void;
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
  onFork,
  onRevert,
  onToggleSpeak,
  slim = false,
  speaking = false,
}: TranscriptMessageProps) {
  const { t } = useTranslation();
  const palette = usePalette();
  const { accent } = useAppearance();
  const isUser = entry.role === 'user';
  // Non-flat user bubbles stay dark in both themes, so their code surface must
  // use the selected theme's dark palette. Flat messages follow the active
  // theme's text color.
  const darkCodePalette = useMemo(() => getColors('dark', accent).code, [accent]);
  const codePalette = !flat && isUser ? darkCodePalette : palette.code;
  const attachments = entry.details.filter((detail) => detail.kind === 'file').map((detail) => ({ uri: detail.uri || '', mime: detail.mime, filename: detail.filename || detail.label }));
  // Patches render as activity rows; the bubble keeps only file and retry chips.
  const summaryDetails = entry.details.filter((detail) => detail.kind === 'file' || detail.kind === 'retry');
  const detailSummary = summarizeTranscriptDetails(summaryDetails, { patches: (count) => t('chat:cards.updatedPatches', { count }), files: (count) => t('chat:cards.fileCount', { count }) });
  const textColor = flat ? palette.text : isUser ? palette.onBubbleUser : palette.onBubbleAssistant;
  const metaColor = flat ? palette.muted : isUser ? palette.onBubbleUser : palette.muted;
  const accentColor = flat ? palette.tint : isUser ? palette.onBubbleUser : palette.tint;
  const slimSpacing = slim ? (flat ? { paddingVertical: 2, gap: 4 } : { borderRadius: 14, gap: 6, paddingHorizontal: 10, paddingVertical: 8 }) : null;

  return (
    <View className={cn(stylesClasses.messageRow, (flat) ? stylesClasses.messageRowFlat : isUser && stylesClasses.messageRowUser)}>
      <View onTouchEnd={Keyboard.dismiss} className={cn(stylesClasses.messageTouchable)}>
        <View testID={`transcript-message-${entry.id}`} className={cn(stylesClasses.messageBubble)} style={[flat ? styles.messageFlat : isUser ? styles.messageBubbleUser : styles.messageBubbleAssistant, flat
              ? null
              : {
                  backgroundColor: isUser ? palette.bubbleUser : palette.bubbleAssistant,
                  borderColor: copied ? palette.tint : isUser ? palette.bubbleUser : palette.border,
                }, slimSpacing, copied && !flat ? styles.messageBubbleCopied : null]}><View className={cn(stylesClasses.messageMeta, slim && "gap-2")}>
            <Text style={{ color: metaColor }} variant="label">{isUser ? t('chat:cards.you') : t('chat:cards.opencode')}</Text>
            <View className={cn(stylesClasses.messageMetaRight)}>
              <Button accessibilityLabel={t('common:actions.copy')} onPress={() => onCopy(entry)} variant="ghost" size="icon" className={cn(stylesClasses.messageActionButton)} ><Icon name={"content-copy"} size={slim ? 14 : 16} color={palette.muted} /></Button>
              {copied ? (
                <View className={cn(stylesClasses.copiedPill)} style={[{ backgroundColor: flat ? withAlpha(palette.tint, 0x18 / 255) : isUser ? withAlpha(palette.onBubbleUser, 0x20 / 255) : withAlpha(palette.tint, 0x18 / 255) }]}>
                  <MaterialCommunityIcons name="check" size={12} color={accentColor} />
                  <Text style={{ color: accentColor }} variant="label">{t('chat:cards.copied')}</Text>
                </View>
              ) : null}
              {canSpeak ? (
                <Button accessibilityLabel={t(speaking ? 'chat:cards.stopReadAloud' : 'chat:cards.readAloud')} onPress={() => onToggleSpeak(entry)} variant="ghost" size="icon" className={cn(stylesClasses.messageActionButton)} ><Icon name={speaking ? 'stop' : 'volume-high'} size={slim ? 14 : 16} color={palette.muted} /></Button>
              ) : null}
              {onFork ? <Button accessibilityLabel={t('chat:cards.fork')} onPress={() => onFork(entry)} variant="ghost" size="icon" className={cn(stylesClasses.messageActionButton)} ><Icon name={"source-fork"} size={slim ? 14 : 16} color={palette.muted} /></Button> : null}
              {onRevert ? <Button accessibilityLabel={t('chat:cards.revert')} onPress={() => onRevert(entry)} variant="ghost" size="icon" className={cn(stylesClasses.messageActionButton)} ><Icon name={"undo-variant"} size={slim ? 14 : 16} color={palette.muted} /></Button> : null}
              <Text style={{ color: metaColor, opacity: isUser && !flat ? 0.82 : 1 }} variant="label">{formatTimestamp(entry.createdAt)}</Text>
            </View>
          </View>{attachments.length > 0 ? <AttachmentStrip attachments={attachments} /> : null}{entry.text ? (
            <MarkdownText
              codePalette={codePalette}
              text={entry.text}
              color={textColor}
              fontSize={fontSize}
              mutedColor={flat ? palette.muted : isUser ? palette.onBubbleUser : palette.muted}
            />
          ) : null}{entry.error ? <Text className={cn("text-destructive")} variant="description">{entry.error}</Text> : null}{!isUser && detailSummary.length > 0 ? (
            <View className={cn(stylesClasses.summaryRow)}>
              {detailSummary.map((item) => (
                <Badge key={item} accessibilityLabel={item} className={cn(stylesClasses.summaryChip, "bg-background")} variant="secondary"><Text>{item}</Text></Badge>
              ))}
            </View>
          ) : null}</View>
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
    prev.onCopy === next.onCopy &&
    prev.onFork === next.onFork &&
    prev.onRevert === next.onRevert &&
    prev.onToggleSpeak === next.onToggleSpeak
  );
}

export const TranscriptMessage = memo(TranscriptMessageImpl, areTranscriptMessagePropsEqual);

const styles = StyleSheet.create({
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
  messageBubbleCopied: { shadowOpacity: 0.12, shadowRadius: 12, shadowOffset: { width: 0, height: 6 } }
});

const stylesClasses = {
  "messageRow": "items-start",
  "messageRowFlat": "items-stretch",
  "messageRowUser": "items-end",
  "messageTouchable": "self-stretch rounded-[24px]",
  "messageBubble": "rounded-[24px] border px-4 py-3.5 gap-2.5 self-stretch min-w-0 overflow-hidden",
  "messageMeta": "flex-row justify-between items-center gap-3",
  "messageMetaRight": "flex-row items-center gap-1.5",
  "messageActionButton": "m-0",
  "copiedPill": "flex-row items-center gap-1 rounded-full px-2 py-1",
  "summaryRow": "flex-row flex-wrap gap-2",
  "summaryChip": "self-start"
} as const;
