import { cn } from '@/shared/ui/cn';
import { Text } from '@/shared/ui/text';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import type { CompactionDetail } from '@/shared/presentation/transcript';
import { formatTokenCount } from '@/shared/presentation/usage';
import { Colors } from '@/shared/ui/theme/theme';

type Palette = typeof Colors.light;

// Session-level divider for a compaction record: the boundary where older
// context was replaced, with the summary call's token totals when available.
export function CompactionDivider({ detail, palette }: { detail: CompactionDetail; palette: Palette }) {
  const { t } = useTranslation();
  const label = detail.status === 'running'
    ? t('chat:compaction.started')
    : detail.status === 'failed'
      ? t('chat:compaction.failed')
      : t('chat:compaction.completed');
  const usage = detail.status === 'completed' && detail.inputTokens !== undefined && detail.outputTokens !== undefined
    ? t('chat:compaction.usage', { input: formatTokenCount(detail.inputTokens), output: formatTokenCount(detail.outputTokens) })
    : undefined;
  const text = usage ? `${label} · ${usage}` : label;

  return (
    <View accessible accessibilityLabel={text} className={cn(stylesClasses.divider)} testID="transcript-compaction">
      <View className={cn(stylesClasses.rule)} style={{ backgroundColor: palette.border }} />
      <Text className={cn("shrink min-w-0 text-center text-muted-foreground")} style={{ color: palette.muted }} variant="description">{text}</Text>
      <View className={cn(stylesClasses.rule)} style={{ backgroundColor: palette.border }} />
    </View>
  );
}

const stylesClasses = {
  "divider": "flex-row items-center gap-2",
  "rule": "h-px flex-1"
} as const;
