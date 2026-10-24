import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Text } from 'react-native-paper';

import { ActivityDiffCard } from '@/components/chat/cards/activity-diff';
import { MarkdownText } from '@/components/chat/chat-markdown';
import { Colors } from '@/constants/theme';
import { formatDuration, getToolDisplayName, isFileChangeToolName } from '@/lib/opencode/format';
import { copyHaptic } from '@/lib/haptics';
import { isShellTool, type ActivityItem, type ToolDetail } from '@/lib/opencode/transcript';

type Palette = typeof Colors.light;

function basename(path: string) {
  return path.split(/[\\/]/).pop() || path;
}

// Consecutive plain reads collapse to one non-expandable line. The row shows
// filenames only: offsets, limits and file contents stay out of the timeline.
export function ActivityReadGroupRow({ palette, reads }: { palette: Palette; reads: ToolDetail[] }) {
  const label = getToolDisplayName('read');
  const active = reads.some((read) => read.status === 'running' || read.status === 'pending');
  const names = [...new Set(reads
    .map((read) => (read.path ? basename(read.path) : read.label))
    .filter((name) => name && name.toLowerCase() !== 'read'))];

  return (
    <View style={styles.row} testID={`transcript-activity-read-${reads[0].id}`}>
      <Text variant="bodySmall" numberOfLines={1} style={[styles.label, { color: palette.muted }]}>{label}</Text>
      {names.length > 0 ? (
        <Text variant="bodySmall" numberOfLines={1} style={[styles.command, { color: palette.muted }]}>{names.join(', ')}</Text>
      ) : <View style={styles.spacer} />}
      {active ? <ActivityIndicator size={12} color={palette.tint} /> : null}
    </View>
  );
}

// One row inside an activity run. The row is the second collapse level: it
// stays closed while the run shows the shape of the turn, then reveals the
// thought, command output, tool body, or changed-file list on demand.
export function ActivityItemRow({ fontSize, item, palette }: { fontSize: number; item: ActivityItem; palette: Palette }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(timer);
  }, [copied]);

  if (item.kind === 'tool' && item.status !== 'error' && item.files?.length && isFileChangeToolName(item.tool)) {
    return (
      <View>
        {item.files.map((diff, index) => (
          <ActivityDiffCard diff={diff} fontSize={fontSize} key={`${diff.file}-${index}`} palette={palette} />
        ))}
      </View>
    );
  }

  let label = item.label;
  let meta: string | undefined;
  let command: string | undefined;
  let body: string | undefined;
  let files: string[] = [];
  let toolStatus: string | undefined;
  let expandable = false;

  if (item.kind === 'reasoning') {
    label = t('chat:activity.thought');
    meta = item.durationMs !== undefined ? formatDuration(item.durationMs) : undefined;
    body = item.body.trim() ? item.body : undefined;
    expandable = Boolean(body);
  } else if (item.kind === 'tool') {
    label = getToolDisplayName(item.tool);
    toolStatus = item.status;
    if (item.tool === 'read') {
      command = item.path ? basename(item.path) : undefined;
    } else if (item.tool === 'grep') {
      command = item.pattern?.trim() ? `pattern=${item.pattern.trim()}` : item.label;
      meta = item.matchCount !== undefined && item.matchCount > 0 ? t('chat:activity.matches', { count: item.matchCount }) : undefined;
    } else if (isShellTool(item.tool)) {
      command = item.command?.trim();
      const output = item.body?.trim() ? item.body : undefined;
      body = [command ? `$ ${command}` : undefined, output].filter(Boolean).join('\n');
      expandable = Boolean(body);
    } else {
      const text = item.body?.trim();
      body = text && text !== 'No output' ? item.body : undefined;
      expandable = Boolean(body);
    }
  } else {
    files = item.body.split('\n').map((file) => file.trim()).filter(Boolean);
    label = t('chat:cards.filesChangedSimple', { files: files.length, count: files.length });
    expandable = files.length > 0;
  }

  const actionLabel = t(expanded ? 'chat:activity.collapseItem' : 'chat:activity.expandItem', { item: label });
  const secondary = command ?? (item.kind === 'tool' && item.label && item.label !== label ? item.label : undefined);

  async function handleCopy() {
    if (!body) return;
    try {
      await Clipboard.setStringAsync(body);
      copyHaptic();
      setCopied(true);
    } catch {
      // Leave the copy affordance unchanged when the platform clipboard fails.
    }
  }

  return (
    <View>
      <Pressable
        accessibilityLabel={expandable ? `${label}${meta ? `, ${meta}` : ''}. ${actionLabel}` : label}
        accessibilityRole="button"
        accessibilityState={expandable ? { expanded } : undefined}
        disabled={!expandable}
        onPress={expandable ? () => setExpanded((value) => !value) : undefined}
        style={({ pressed }) => [styles.row, pressed && expandable ? { backgroundColor: palette.surfaceAlt } : null]}
        testID={`transcript-activity-item-${item.id}`}>
        {toolStatus === 'running' || toolStatus === 'pending' ? (
          <ActivityIndicator size={12} color={palette.tint} />
        ) : toolStatus === 'error' ? (
          <MaterialCommunityIcons name="alert-circle-outline" size={14} color={palette.danger} />
        ) : null}
        <Text variant="bodySmall" numberOfLines={1} style={[styles.label, { color: palette.muted }]}>{label}</Text>
        {secondary ? (
          <Text variant="bodySmall" numberOfLines={1} style={[styles.command, { color: palette.muted }]}>{secondary}</Text>
        ) : null}
        {meta ? <Text variant="labelSmall" style={[styles.meta, { color: palette.muted }]}>{meta}</Text> : null}
        {!secondary && !meta ? <View style={styles.spacer} /> : null}
        {expandable ? <MaterialCommunityIcons name={expanded ? 'chevron-down' : 'chevron-right'} size={15} color={palette.muted} /> : null}
      </Pressable>
      {expanded ? (
        item.kind === 'patch' ? (
          <View style={styles.fileList}>
            {files.map((file) => (
              <Text key={file} selectable variant="bodySmall" style={[styles.file, { color: palette.muted }]}>{file}</Text>
            ))}
          </View>
        ) : item.kind === 'tool' && isShellTool(item.tool) ? (
          <View style={[styles.shellBlock, { backgroundColor: palette.background, borderColor: palette.border }]}>
            <Pressable
              accessibilityLabel={t(copied ? 'chat:cards.copied' : 'common:actions.copy')}
              accessibilityRole="button"
              hitSlop={8}
              onPress={() => void handleCopy()}
              style={styles.shellCopy}>
              <MaterialCommunityIcons name={copied ? 'check' : 'content-copy'} size={15} color={palette.muted} />
            </Pressable>
            <Text selectable style={[styles.shellText, { color: palette.muted, fontSize: Math.max(12, fontSize - 1) }]}>
              {body}
            </Text>
          </View>
        ) : (
          <View style={styles.markdownBody}>
            <MarkdownText
              codePalette={palette.code}
              color={palette.muted}
              fontSize={Math.max(12, fontSize - 1)}
              mutedColor={palette.muted}
              text={body || label}
            />
          </View>
        )
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    alignItems: 'center',
    borderRadius: 8,
    flexDirection: 'row',
    gap: 8,
    minHeight: 34,
    paddingHorizontal: 2,
    paddingVertical: 5,
  },
  label: { flexShrink: 0, fontWeight: '600' },
  meta: { flexShrink: 0 },
  command: { flex: 1, minWidth: 0 },
  spacer: { flex: 1, minWidth: 0 },
  markdownBody: { paddingBottom: 6, paddingHorizontal: 2, paddingTop: 2 },
  shellBlock: { borderRadius: 8, borderWidth: 1, marginBottom: 8, marginTop: 2, padding: 10, paddingTop: 12 },
  shellCopy: { position: 'absolute', right: 4, top: 4, zIndex: 1 },
  shellText: {
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
    lineHeight: 18,
    paddingRight: 20,
  },
  fileList: { gap: 4, marginBottom: 8, marginTop: 2, paddingHorizontal: 2, paddingVertical: 4 },
  file: { fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }), fontSize: 12, lineHeight: 18 },
});
