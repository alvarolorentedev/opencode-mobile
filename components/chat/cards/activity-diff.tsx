import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';

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
  const [expanded, setExpanded] = useState(false);
  const lines = useMemo(() => (expanded && diff.patch ? buildPatchDiff(diff.patch) : []), [diff.patch, expanded]);
  const blocks = useMemo(() => (expanded ? buildCollapsedDiffBlocks(lines) : []), [expanded, lines]);
  const badge = fileBadge(diff.file);
  const emptyPreviewKey = diff.patch ? 'chat:cards.noLineChanges' : 'chat:cards.previewUnavailable';

  return (
    <View style={[styles.card, { borderColor: palette.border, backgroundColor: palette.surface }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        onPress={() => setExpanded((value) => !value)}
        style={styles.header}
        testID={`transcript-activity-diff-${diff.file}`}>
        <View style={[styles.badge, { backgroundColor: badge.background }]}>
          <Text style={styles.badgeText}>{badge.label}</Text>
        </View>
        <Text variant="bodySmall" numberOfLines={1} ellipsizeMode="middle" style={[styles.file, { color: palette.muted }]}>{diff.file}</Text>
        <Text variant="labelMedium" style={{ color: palette.success }}>+{diff.additions}</Text>
        <Text variant="labelMedium" style={{ color: palette.danger }}>−{diff.deletions}</Text>
        <MaterialCommunityIcons name={expanded ? 'chevron-down' : 'chevron-right'} size={15} color={palette.muted} />
      </Pressable>
      {expanded ? (
        <View style={[styles.body, { borderTopColor: palette.border }]}>
          {blocks.length === 0 ? (
            <Text variant="bodySmall" style={[styles.empty, { color: palette.muted }]}>{t(emptyPreviewKey)}</Text>
          ) : blocks.map((block, blockIndex) => {
            if (block.type === 'collapsed') {
              return (
                <View key={`${diff.file}-collapsed-${blockIndex}`} style={[styles.collapsedRow, { backgroundColor: palette.background, borderColor: palette.border }]}>
                  <Text variant="bodySmall" style={[styles.code, { color: palette.muted }]}>
                    {t('chat:cards.hiddenLines', { count: block.hiddenCount })}
                  </Text>
                </View>
              );
            }

            return block.lines.map((line, index) => {
              const tone = getDiffPalette(line.kind, palette);
              return (
                <View
                  key={`${diff.file}-${blockIndex}-${index}-${line.leftNumber ?? 'x'}-${line.rightNumber ?? 'x'}`}
                  style={[styles.lineRow, { backgroundColor: tone.backgroundColor, borderLeftColor: tone.accentColor }]}>
                  <Text variant="labelSmall" style={[styles.lineNumber, { color: palette.muted }]}>
                    {line.rightNumber ?? line.leftNumber ?? ''}
                  </Text>
                  <Text style={[styles.marker, { color: tone.accentColor || palette.muted }]}>
                    {line.kind === 'added' ? '+' : line.kind === 'removed' ? '-' : ' '}
                  </Text>
                  <Text selectable style={[styles.code, styles.lineText, { color: palette.muted, fontSize: Math.max(11, fontSize - 2) }]}>
                    {line.text || ' '}
                  </Text>
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
  card: { borderRadius: 10, borderWidth: 1, marginVertical: 5, overflow: 'hidden' },
  header: { alignItems: 'center', flexDirection: 'row', gap: 8, minHeight: 42, paddingHorizontal: 10, paddingVertical: 7 },
  badge: { alignItems: 'center', borderRadius: 4, height: 19, justifyContent: 'center', width: 21 },
  badgeText: { color: '#ffffff', fontSize: 8, fontWeight: '700', letterSpacing: -0.2 },
  file: { flex: 1, minWidth: 0 },
  body: { borderTopWidth: 1, paddingVertical: 5 },
  empty: { paddingHorizontal: 10, paddingVertical: 6 },
  collapsedRow: { borderRadius: 8, marginHorizontal: 8, marginVertical: 4, paddingHorizontal: 10, paddingVertical: 6 },
  lineRow: { alignItems: 'flex-start', borderLeftWidth: 3, flexDirection: 'row', gap: 6, paddingHorizontal: 8, paddingVertical: 2 },
  lineNumber: { textAlign: 'right', width: 28 },
  marker: { fontFamily: 'monospace', textAlign: 'center', width: 12 },
  lineText: { flex: 1, minWidth: 0 },
  code: { fontFamily: 'monospace', fontSize: 11, lineHeight: 17 },
});
