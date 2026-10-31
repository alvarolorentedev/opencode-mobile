import { cn } from '@/lib/utils';
import { Text } from '@/components/ui/text';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRecyclingState } from '@shopify/flash-list';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';


import { buildCollapsedDiffBlocks, buildPatchDiff, getDiffPalette } from '@/components/chat/chat-diff';
import { Colors } from '@/constants/theme';
import type { TranscriptFileDiff } from '@/lib/opencode/format';

type Palette = typeof Colors.light;

function fileBadge(file: string) {
  const name = file.split(/[\\/]/).pop() ?? file;
  const extension = name.includes('.') ? name.split('.').pop()?.toLowerCase() : undefined;
  if (extension === 'ts' || extension === 'tsx') return { label: 'TS', background: '#2f77c9' };
  if (extension === 'js' || extension === 'jsx' || extension === 'mjs' || extension === 'cjs') return { label: 'JS', background: '#b58b18' };
  if (extension === 'md' || extension === 'mdx') return { label: 'MD', background: '#4c7f72' };
  return { label: extension ? extension.slice(0, 2).toUpperCase() : 'FILE', background: '#53635e' };
}

// Inline diff card for an edit/write/patch tool. It is intentionally separate
// from the Files changed overlay so transcript expansion cannot affect the
// review sheet's state or layout.
export function ActivityDiffCard({ diff, fontSize, palette }: { diff: TranscriptFileDiff; fontSize: number; palette: Palette }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useRecyclingState(false, [diff.file, diff.patch]);
  const lines = useMemo(() => (expanded && diff.patch ? buildPatchDiff(diff.patch) : []), [diff.patch, expanded]);
  const blocks = useMemo(() => (expanded ? buildCollapsedDiffBlocks(lines) : []), [expanded, lines]);
  const badge = fileBadge(diff.file);
  const emptyPreviewKey = diff.patch ? 'chat:cards.noLineChanges' : 'chat:cards.previewUnavailable';

  return (
    <View className={cn(stylesClasses.card, "border-border bg-surface")}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        onPress={() => setExpanded((value) => !value)}
        className={cn(stylesClasses.header)}
        testID={`transcript-activity-diff-${diff.file}`}>
        <View className={cn(stylesClasses.badge)} style={[{ backgroundColor: badge.background }]}>
          <Text style={styles.badgeText}>{badge.label}</Text>
        </View>
        <Text numberOfLines={1} ellipsizeMode="middle" className={cn(stylesClasses.file, "text-muted-foreground")} variant="label">{diff.file}</Text>
        <Text className={cn("text-success")} variant="label">+{diff.additions}</Text>
        <Text className={cn("text-destructive")} variant="label">−{diff.deletions}</Text>
        <MaterialCommunityIcons name={expanded ? 'chevron-down' : 'chevron-right'} size={15} color={palette.muted} />
      </Pressable>
      {expanded ? (
        <View className={cn(stylesClasses.body)} style={[{ borderTopColor: palette.border }]}>
          {blocks.length === 0 ? (
            <Text className={cn(stylesClasses.empty, "text-muted-foreground")} variant="label">{t(emptyPreviewKey)}</Text>
          ) : blocks.map((block, blockIndex) => {
            if (block.type === 'collapsed') {
              return (
                <View key={`${diff.file}-collapsed-${blockIndex}`} className={cn(stylesClasses.collapsedRow, "bg-background border-border")}>
                  <Text className={cn("text-muted-foreground")} style={[styles.code]} variant="label">{t('chat:cards.hiddenLines', { count: block.hiddenCount })}</Text>
                </View>
              );
            }

            return block.lines.map((line, index) => {
              const tone = getDiffPalette(line.kind, palette);
              return (
                <View
                  key={`${diff.file}-${blockIndex}-${index}-${line.leftNumber ?? 'x'}-${line.rightNumber ?? 'x'}`}
                  style={[styles.lineRow, { backgroundColor: tone.backgroundColor, borderLeftColor: tone.accentColor }]}>
                  <Text className={cn(stylesClasses.lineNumber, "text-muted-foreground")} variant="label">{line.rightNumber ?? line.leftNumber ?? ''}</Text>
                  <Text style={[styles.marker, { color: tone.accentColor || palette.muted }]}>{line.kind === 'added' ? '+' : line.kind === 'removed' ? '-' : ' '}</Text>
                  <Text selectable className={cn(stylesClasses.lineText)} style={[styles.code, { color: palette.muted, fontSize: Math.max(11, fontSize - 2) }]}>{line.text || ' '}</Text>
                </View>
              );
            });
          })}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  badgeText: { color: '#ffffff', fontSize: 8, fontWeight: '700', letterSpacing: -0.2 },
  lineRow: { alignItems: 'flex-start', borderLeftWidth: 3, flexDirection: 'row', gap: 6, paddingHorizontal: 8, paddingVertical: 2 },
  marker: { fontFamily: 'monospace', textAlign: 'center', width: 12 },
  code: { fontFamily: 'monospace', fontSize: 11, lineHeight: 17 }
});

const stylesClasses = {
  "card": "rounded-[10px] border my-1.25 overflow-hidden",
  "header": "items-center flex-row gap-2 min-h-10.5 px-2.5 py-1.75",
  "badge": "items-center rounded-[4px] h-4.75 justify-center w-5.25",
  "file": "flex-1 min-w-0",
  "body": "border-t py-1.25",
  "empty": "px-2.5 py-1.5",
  "collapsedRow": "rounded-[8px] mx-2 my-1 px-2.5 py-1.5",
  "lineNumber": "text-right w-7",
  "lineText": "flex-1 min-w-0"
} as const;
