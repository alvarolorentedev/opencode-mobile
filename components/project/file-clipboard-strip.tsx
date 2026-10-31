import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { Button, IconButton, Text } from 'react-native-paper';
import { ControlSize, Shape, Spacing } from '@/constants/design-tokens';
import { usePalette } from '@/hooks/use-palette';
import type { FileClipboardEntry } from '@/providers/use-file-clipboard';

export function FileClipboardStrip({ entry, busy, available, onPaste, onClear }: {
  entry: FileClipboardEntry; busy: boolean; available: boolean; onPaste: () => void; onClear: () => void;
}) {
  const { t } = useTranslation();
  const palette = usePalette();
  return <View testID="project-file-clipboard" style={[styles.strip, { backgroundColor: palette.surfaceAlt, borderColor: palette.border }]}>
    <View style={{ flex: 1, minWidth: 0 }}>
      <Text>{t(`project:files.actions.${entry.mode === 'cut' ? 'cutEntry' : 'copiedEntry'}`, { name: entry.path.split('/').pop() })}</Text>
      <Text style={{ color: palette.muted }}>{entry.root} / {entry.path}</Text>
    </View>
    <IconButton icon="close" style={{ margin: 0 }} size={20} accessibilityLabel={t('project:files.actions.clearClipboard')} disabled={busy} onPress={onClear} />
    <Button testID="project-file-paste" compact loading={busy} disabled={busy || !available} onPress={onPaste}>{t('project:files.actions.paste')}</Button>
  </View>;
}
const styles = StyleSheet.create({ strip: { minHeight: ControlSize.target, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.xs, borderWidth: 1, borderRadius: Shape.control, padding: Spacing.sm } });
