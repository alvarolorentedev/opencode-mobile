import { cn } from '@/lib/utils';
import { Text } from '@/components/ui/text';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';


import { getDiffPalette, buildPatchDiff, buildCollapsedDiffBlocks } from '@/components/chat/chat-diff';
import type { FileDiff } from '@/lib/opencode/types';
import { usePalette } from '@/hooks/use-palette';

export function SessionDiffCard({ diff, expanded, onPress }: { diff: FileDiff; expanded: boolean; onPress: () => void }) {
  const { t } = useTranslation();
  const palette = usePalette();
  const diffLines = useMemo(() => (expanded ? buildPatchDiff(diff.patch || '') : []), [diff.patch, expanded]);
  const diffBlocks = useMemo(() => (expanded ? buildCollapsedDiffBlocks(diffLines) : []), [diffLines, expanded]);
  // A patch that yields no lines is a genuinely empty hunk. No patch at all
  // means the server reported changes without content the viewer can render.
  const emptyPreviewKey = diff.patch ? 'chat:cards.noLineChanges' : 'chat:cards.previewUnavailable';

  return (
    <View className={cn("border-border")} style={[styles.diffAccordion]}>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded }} aria-expanded={expanded} onPress={onPress} className={cn(stylesClasses.diffFileRow, "bg-surface")}>
        <MaterialCommunityIcons name={expanded ? 'chevron-down' : 'chevron-right'} size={18} color={palette.muted} />
        <Text numberOfLines={1} ellipsizeMode="middle" className={cn(stylesClasses.diffFileName, "text-foreground")} variant="description">{diff.file || t('chat:cards.unknownFile')}</Text>
        <Text className={cn("text-success")} variant="label">+{diff.additions}</Text>
        <Text className={cn("text-destructive")} variant="label">−{diff.deletions}</Text>
      </Pressable>
      <View className={cn(stylesClasses.diffAccordionBody)}>
        {expanded ? (
          <View className={cn(stylesClasses.diffViewer)}>
            {diffBlocks.length === 0 ? <Text className={cn("text-muted-foreground")} variant="label">{t(emptyPreviewKey)}</Text> : diffBlocks.map((block, blockIndex) => {
              if (block.type === 'collapsed') {
                return (
                  <View key={`${diff.file}-collapsed-${blockIndex}`} className={cn(stylesClasses.diffCollapsedRow, "bg-background border-border")}>
                    <Text className={cn("text-muted-foreground")} style={[styles.code]} variant="label">{t('chat:cards.hiddenLines', { count: block.hiddenCount })}{block.startLine && block.endLine ? ` (${block.startLine}-${block.endLine})` : ''}</Text>
                  </View>
                );
              }

              return block.lines.map((line, index) => {
                const tone = getDiffPalette(line.kind, palette);
                return (
                  <View
                    key={`${diff.file}-${blockIndex}-${index}-${line.leftNumber ?? 'x'}-${line.rightNumber ?? 'x'}`}
                    style={[
                      styles.diffLineRow,
                      {
                        backgroundColor: tone.backgroundColor,
                        borderLeftColor: tone.accentColor,
                      },
                    ]}>
                    <Text className={cn(stylesClasses.diffLineNumber, "text-muted-foreground")} variant="label">{line.rightNumber ?? line.leftNumber ?? ''}</Text>
                    <Text style={[styles.diffMarker, { color: tone.accentColor || palette.muted }]}>{line.kind === 'added' ? '+' : line.kind === 'removed' ? '-' : ' '}</Text>
                    <Text selectable className={cn(stylesClasses.diffLineText, "text-foreground")} style={[styles.code]} variant="label">{line.text || ' '}</Text>
                  </View>
                );
              });
            })}
          </View>
        ) : null}
      </View>
    </View>
  );
}

// Filename-only fallback for a turn whose structured diff the server did not
// provide. It is a file list, not a diff, so it is never rendered as one.
export function ChangedFilesCard({ files }: { files: string[] }) {
  const { t } = useTranslation();


  return (
    <View testID="changed-files-card" className={cn("bg-surface border-border")} style={[styles.changedFilesCard]}>
      <Text className={cn("text-foreground")} variant="description">{t('chat:cards.filesChanged')}</Text>
      {files.map((file) => (
        <Text key={file} selectable className={cn("text-foreground")} style={[styles.code]} variant="label">{file}</Text>
      ))}
      <Text className={cn("text-muted-foreground")} variant="label">{t('chat:diff.changedFilesNote')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  diffAccordion: { borderBottomWidth: 1 },
  changedFilesCard: { borderBottomWidth: 1, gap: 6, paddingHorizontal: 16, paddingVertical: 12 },
  diffLineRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    borderLeftWidth: 3,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  diffMarker: { width: 12, textAlign: 'center', fontFamily: 'monospace' },
  code: { fontFamily: 'monospace', fontSize: 12, lineHeight: 18 }
});

const stylesClasses = {
  "diffFileRow": "flex-row items-center gap-2 min-h-target px-3 py-2.5",
  "diffFileName": "flex-1 min-w-0 font-bold",
  "diffAccordionBody": "pb-0",
  "diffViewer": "w-full py-1",
  "diffCollapsedRow": "rounded-[8px] mx-2 my-1 px-2.5 py-2",
  "diffLineNumber": "w-7.5 text-right",
  "diffLineText": "flex-1 min-w-0"
} as const;
