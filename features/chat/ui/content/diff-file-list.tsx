import { FlatList, StyleSheet, View, type ListRenderItemInfo } from 'react-native';
import { useTranslation } from 'react-i18next';

import { cn } from '@/shared/ui/cn';
import { Text } from '@/shared/ui/text';
import { usePalette } from '@/shared/ui/theme/use-palette';

import { SessionDiffCollapsedRow, SessionDiffHeader, SessionDiffLineRow } from '@/features/chat/ui/chat-cards';
import type { DiffListRow } from '@/features/chat/ui/chat-diff';

// One flat list keeps the file headers, their lines and the collapsed context
// in the same scroll surface. FlatList's native sticky headers do not clone the
// header view, unlike FlashList's overlay implementation.
export function DiffFileList({ rows, stickyHeaderIndices, onToggleFile }: {
  rows: DiffListRow[];
  stickyHeaderIndices: number[];
  onToggleFile: (id?: string) => void;
}) {
  const { t } = useTranslation();
  const palette = usePalette();

  const renderItem = ({ item }: ListRenderItemInfo<DiffListRow>) => {
    if (item.type === 'file') {
      return <SessionDiffHeader diff={item.diff} expanded={item.expanded} onPress={() => onToggleFile(item.expanded ? undefined : item.accordionId)} />;
    }
    if (item.type === 'collapsed') return <SessionDiffCollapsedRow block={item.block} />;
    if (item.type === 'empty') return <View className={cn(stylesClasses.emptyPreview)}><Text className={cn("text-muted-foreground")} variant="label">{t(item.messageKey)}</Text></View>;
    return <SessionDiffLineRow line={item.line} />;
  };

  return (
    <FlatList
      testID="changes-diff-list"
      data={rows}
      style={{ flex: 1, backgroundColor: palette.background }}
      contentContainerStyle={styles.content}
      keyExtractor={(row) => row.key}
      keyboardDismissMode="on-drag"
      removeClippedSubviews={false}
      renderItem={renderItem}
      stickyHeaderIndices={stickyHeaderIndices}
    />
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: 12 },
});

const stylesClasses = {
  "emptyPreview": "px-3 py-2",
} as const;
