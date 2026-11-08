import { cn } from '@/shared/ui/cn';
import { Text } from '@/shared/ui/text';
import { Button } from '@/shared/ui/button';
import { Icon } from '@/shared/ui/icon';
import { withAlpha } from '@/shared/ui/theme/color';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Keyboard, StyleSheet, View } from 'react-native';

import { MarkdownText } from '@/features/chat/ui/chat-markdown';
import { usePalette } from '@/shared/ui/theme/use-palette';
import { formatMessageTime, type TranscriptEntry } from '@/shared/presentation/format';

type NoticeCardProps = {
  copied?: boolean;
  entry: TranscriptEntry;
  flat?: boolean;
  fontSize: number;
  onCopy: (entry: TranscriptEntry) => void;
  slim?: boolean;
};

function NoticeCardImpl({ copied = false, entry, flat = false, fontSize, onCopy, slim = false }: NoticeCardProps) {
  const { t } = useTranslation();
  const palette = usePalette();

  return (
    <View
      testID={`transcript-message-${entry.id}`}
      onTouchEnd={Keyboard.dismiss}
      style={[
        styles.card,
        slim ? styles.cardSlim : null,
        flat
          ? { ...styles.cardFlat, borderLeftColor: palette.border }
          : { backgroundColor: palette.surfaceAlt, borderColor: palette.border },
      ]}
    >
      <View testID={`transcript-notice-${entry.id}`} className={cn(stylesClasses.inner, slim && stylesClasses.innerSlim)}>
        <View className={cn(stylesClasses.header)}>
          <Icon name="information-outline" size={slim ? 14 : 16} color={palette.muted} />
          <Text className={cn('text-muted-foreground')} style={{ color: palette.muted }} variant="label">{t('chat:cards.notice')}</Text>
          <View className={cn(stylesClasses.headerRight)}>
            {copied ? (
              <View className={cn(stylesClasses.copiedPill)} style={{ backgroundColor: withAlpha(palette.tint, 0x18 / 255) }}>
                <MaterialCommunityIcons name="check" size={12} color={palette.tint} />
                <Text style={{ color: palette.tint }} variant="label">{t('chat:cards.copied')}</Text>
              </View>
            ) : (
              <Button
                accessibilityLabel={t('common:actions.copy')}
                onPress={() => onCopy(entry)}
                variant="ghost"
                size="icon"
                className={cn(stylesClasses.actionButton)}
              >
                <Icon name="content-copy" size={slim ? 14 : 16} color={palette.muted} />
              </Button>
            )}
            <Text style={{ color: palette.muted }} variant="label">{formatMessageTime(entry.createdAt)}</Text>
          </View>
        </View>
        {entry.text ? (
          <MarkdownText
            codePalette={palette.code}
            text={entry.text}
            color={palette.text}
            fontSize={fontSize}
            mutedColor={palette.muted}
            tokenColor={palette.tint}
          />
        ) : null}
        {entry.error ? <Text className={cn('text-destructive')} variant="description">{entry.error}</Text> : null}
      </View>
    </View>
  );
}

function areNoticeCardPropsEqual(prev: NoticeCardProps, next: NoticeCardProps) {
  return (
    prev.entry === next.entry &&
    prev.copied === next.copied &&
    prev.flat === next.flat &&
    prev.slim === next.slim &&
    prev.fontSize === next.fontSize &&
    prev.onCopy === next.onCopy
  );
}

export const NoticeCard = memo(NoticeCardImpl, areNoticeCardPropsEqual);

const styles = StyleSheet.create({
  card: {
    alignSelf: 'stretch',
    minWidth: 0,
    marginHorizontal: 8,
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  cardFlat: {
    marginHorizontal: 0,
    borderRadius: 0,
    borderWidth: 0,
    borderLeftWidth: 2,
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: 'transparent',
  },
  cardSlim: {
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
});

const stylesClasses = {
  inner: 'gap-2 min-w-0',
  innerSlim: 'gap-1.5',
  header: 'flex-row items-center gap-1.5',
  headerRight: 'flex-row flex-wrap justify-end items-center shrink min-w-0 gap-0.5',
  actionButton: 'm-0',
  copiedPill: 'flex-row items-center gap-1 rounded-full px-2 py-1',
} as const;
