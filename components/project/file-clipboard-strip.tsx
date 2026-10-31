import { cn } from '@/lib/utils';
import { Text } from '@/components/ui/text';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Spinner } from '@/components/ui/spinner';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { ControlSize, Shape, Spacing } from '@/constants/design-tokens';

import type { FileClipboardEntry } from '@/providers/use-file-clipboard';

export function FileClipboardStrip({ entry, busy, available, onPaste, onClear }: {
  entry: FileClipboardEntry; busy: boolean; available: boolean; onPaste: () => void; onClear: () => void;
}) {
  const { t } = useTranslation();

  return <View testID="project-file-clipboard" className={cn("bg-surface-alt border-border")} style={[styles.strip]}>
    <View className={cn("flex-1 min-w-0")}>
      <Text>{t(`project:files.actions.${entry.mode === 'cut' ? 'cutEntry' : 'copiedEntry'}`, { name: entry.path.split('/').pop() })}</Text>
      <Text className={cn("text-muted-foreground")}>{entry.root}{' '}/ {entry.path}</Text>
    </View>
    <Button accessibilityLabel={t('project:files.actions.clearClipboard')} disabled={busy} onPress={onClear} variant="ghost" size="icon" className={cn("m-0")} ><Icon name={"close"} size={20} /></Button>
    <Button testID="project-file-paste" disabled={busy || !available} onPress={onPaste} variant="ghost">{busy ? <Spinner size="small" /> : null}<Text>{t('project:files.actions.paste')}</Text></Button>
  </View>;
}
const styles = StyleSheet.create({
  strip: { minHeight: ControlSize.target, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.xs, borderWidth: 1, borderRadius: Shape.control, padding: Spacing.sm }
});
