import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';

import { MarkdownText } from '@/components/chat/chat-markdown';
import { Colors } from '@/constants/theme';
import { formatDuration, getToolDisplayName } from '@/lib/opencode/format';
import { isShellTool, type ActivityItem } from '@/lib/opencode/transcript';

type Palette = typeof Colors.light;

// One row inside an activity run. The row is the second collapse level: it
// stays closed while the run shows the shape of the turn, then reveals the
// thought, command output, tool body, or changed-file list on demand.
export function ActivityItemRow({ fontSize, item, palette }: { fontSize: number; item: ActivityItem; palette: Palette }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);

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
    if (isShellTool(item.tool)) {
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
          <MaterialCommunityIcons name="progress-clock" size={14} color={palette.tint} />
        ) : toolStatus === 'error' ? (
          <MaterialCommunityIcons name="alert-circle-outline" size={14} color={palette.danger} />
        ) : null}
        <Text variant="bodyMedium" numberOfLines={1} style={[styles.label, { color: palette.text }]}>{label}</Text>
        {meta ? <Text variant="labelSmall" style={[styles.meta, { color: palette.muted }]}>{meta}</Text> : null}
        {secondary ? (
          <Text variant="bodySmall" numberOfLines={1} style={[styles.command, { color: command ? palette.text : palette.muted }]}>{secondary}</Text>
        ) : <View style={styles.spacer} />}
        {expandable ? <MaterialCommunityIcons name={expanded ? 'chevron-down' : 'chevron-right'} size={15} color={palette.muted} /> : null}
      </Pressable>
      {expanded ? (
        item.kind === 'patch' ? (
          <View style={styles.fileList}>
            {files.map((file) => (
              <Text key={file} selectable variant="bodySmall" style={[styles.file, { color: palette.text }]}>{file}</Text>
            ))}
          </View>
        ) : item.kind === 'tool' && isShellTool(item.tool) ? (
          <View style={[styles.shellBlock, { backgroundColor: palette.background }]}>
            <Text selectable={false} style={[styles.shellText, { color: palette.text, fontSize: Math.max(12, fontSize - 1) }]}>
              {body}
            </Text>
          </View>
        ) : (
          <View style={styles.markdownBody}>
            <MarkdownText
              codePalette={palette.code}
              color={palette.text}
              fontSize={fontSize}
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
  shellBlock: { borderRadius: 8, marginBottom: 8, marginTop: 2, padding: 10 },
  shellText: {
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
    lineHeight: 18,
  },
  fileList: { gap: 4, marginBottom: 8, marginTop: 2, paddingHorizontal: 2, paddingVertical: 4 },
  file: { fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }), fontSize: 12, lineHeight: 18 },
});
