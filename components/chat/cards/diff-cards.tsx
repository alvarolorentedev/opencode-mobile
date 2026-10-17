import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';

import { getDiffPalette, buildPatchDiff, buildCollapsedDiffBlocks } from '@/components/chat/chat-diff';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { type TranscriptDetail } from '@/lib/opencode/format';
import type { FileDiff } from '@/lib/opencode/types';

export function SessionDiffCard({ diff, expanded, onPress }: { diff: FileDiff; expanded: boolean; onPress: () => void }) {
  const { t } = useTranslation();
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const diffLines = useMemo(() => (expanded ? buildPatchDiff(diff.patch || '') : []), [diff.patch, expanded]);
  const diffBlocks = useMemo(() => (expanded ? buildCollapsedDiffBlocks(diffLines) : []), [diffLines, expanded]);
  // A patch that yields no lines is a genuinely empty hunk. No patch at all
  // means the server reported changes without content the viewer can render.
  const emptyPreviewKey = diff.patch ? 'chat:cards.noLineChanges' : 'chat:cards.previewUnavailable';

  return (
    <View style={[styles.diffAccordion, { borderColor: palette.border }]}>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded }} aria-expanded={expanded} onPress={onPress} style={[styles.diffFileRow, { backgroundColor: palette.surface }]}>
        <MaterialCommunityIcons name={expanded ? 'chevron-down' : 'chevron-right'} size={18} color={palette.muted} />
        <Text variant="labelLarge" numberOfLines={1} ellipsizeMode="middle" style={[styles.diffFileName, { color: palette.text }]}>{diff.file || t('chat:cards.unknownFile')}</Text>
        <Text variant="labelMedium" style={{ color: palette.success }}>+{diff.additions}</Text>
        <Text variant="labelMedium" style={{ color: palette.danger }}>−{diff.deletions}</Text>
      </Pressable>
      <View style={styles.diffAccordionBody}>
        {expanded ? (
          <View style={styles.diffViewer}>
            {diffBlocks.length === 0 ? <Text variant="bodySmall" style={{ color: palette.muted }}>{t(emptyPreviewKey)}</Text> : diffBlocks.map((block, blockIndex) => {
              if (block.type === 'collapsed') {
                return (
                  <View key={`${diff.file}-collapsed-${blockIndex}`} style={[styles.diffCollapsedRow, { backgroundColor: palette.background, borderColor: palette.border }]}>
                    <Text variant="bodySmall" style={[styles.code, { color: palette.muted }]}>
                      {t('chat:cards.hiddenLines', { count: block.hiddenCount })}
                      {block.startLine && block.endLine ? ` (${block.startLine}-${block.endLine})` : ''}
                    </Text>
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
                    <Text variant="labelSmall" style={[styles.diffLineNumber, { color: palette.muted }]}>
                      {line.rightNumber ?? line.leftNumber ?? ''}
                    </Text>
                    <Text style={[styles.diffMarker, { color: tone.accentColor || palette.muted }]}>
                      {line.kind === 'added' ? '+' : line.kind === 'removed' ? '-' : ' '}
                    </Text>
                    <Text selectable variant="bodySmall" style={[styles.code, styles.diffLineText, { color: palette.text }]}>
                      {line.text || ' '}
                    </Text>
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

export function DiffCard({ detail, expanded, onPress }: { detail: Extract<TranscriptDetail, { kind: 'patch' }>; expanded: boolean; onPress: () => void }) {
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];

  return (
    <View style={[styles.diffAccordion, { borderColor: palette.border }]}>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded }} aria-expanded={expanded} onPress={onPress} style={[styles.diffFileRow, { backgroundColor: palette.surface }]}>
        <MaterialCommunityIcons name={expanded ? 'chevron-down' : 'chevron-right'} size={18} color={palette.muted} />
        <Text variant="labelLarge" numberOfLines={1} ellipsizeMode="middle" style={[styles.diffFileName, { color: palette.text }]}>{detail.label}</Text>
      </Pressable>
      {expanded ? <Text selectable variant="bodySmall" style={[styles.code, styles.diffFallback, { color: palette.muted }]}>{detail.body}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  diffAccordion: { borderBottomWidth: 1 },
  diffFileRow: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 48, paddingHorizontal: 12, paddingVertical: 10 },
  diffFileName: { flex: 1, minWidth: 0, fontWeight: '700' },
  diffFallback: { padding: 12 },
  diffAccordionBody: { paddingBottom: 0 },
  diffViewer: { width: '100%', paddingVertical: 4 },
  diffCollapsedRow: { borderRadius: 8, marginHorizontal: 8, marginVertical: 4, paddingHorizontal: 10, paddingVertical: 8 },
  diffLineRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    borderLeftWidth: 3,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  diffLineNumber: { width: 30, textAlign: 'right' },
  diffMarker: { width: 12, textAlign: 'center', fontFamily: 'monospace' },
  diffLineText: { flex: 1, minWidth: 0 },
  code: { fontFamily: 'monospace', fontSize: 12, lineHeight: 18 },
});
