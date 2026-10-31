import { cn } from '@/shared/ui/cn';
import { Text } from '@/shared/ui/text';
import { Spinner } from '@/shared/ui/spinner';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRecyclingState } from '@shopify/flash-list';
import * as Clipboard from '@/shared/platform/clipboard';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { ActivityDiffCard } from '@/features/chat/ui/cards/activity-diff';
import { MarkdownText } from '@/features/chat/ui/chat-markdown';
import { Colors } from '@/shared/ui/theme/theme';
import { formatDuration, isFileChangeToolName } from '@/shared/presentation/format';
import { getToolLabel } from '@/shared/presentation/format/tool-label';
import { copyHaptic } from '@/shared/platform/haptics';
import { isShellTool, type ActivityItem, type ToolDetail } from '@/shared/presentation/transcript';

type Palette = typeof Colors.light;

function basename(path: string) {
  return path.split(/[\\/]/).pop() || path;
}

// Consecutive plain reads collapse to one non-expandable line. The row shows
// filenames only: offsets, limits and file contents stay out of the timeline.
export function ActivityReadGroupRow({ palette, reads }: { palette: Palette; reads: ToolDetail[] }) {
  const { t } = useTranslation();
  const label = getToolLabel('read', t);
  const active = reads.some((read) => read.status === 'running' || read.status === 'pending');
  const names = [...new Set(reads
    .map((read) => (read.path ? basename(read.path) : read.label))
    .filter((name) => name && name.toLowerCase() !== 'read'))];

  return (
    <View className={cn(stylesClasses.row)} testID={`transcript-activity-read-${reads[0].id}`}>
      <Text numberOfLines={1} className={cn(stylesClasses.label, "text-muted-foreground")} variant="label">{label}</Text>
      {names.length > 0 ? (
        <Text numberOfLines={1} className={cn(stylesClasses.command, "text-muted-foreground")} variant="label">{names.join(', ')}</Text>
      ) : <View className={cn(stylesClasses.spacer)} />}
      {active ? <Spinner size={12} color={palette.tint} /> : null}
    </View>
  );
}

// One row inside an activity run. The row is the second collapse level: it
// stays closed while the run shows the shape of the turn, then reveals the
// thought, command output, tool body, or changed-file list on demand. Row state
// is keyed by item id so a recycled list cell cannot inherit it.
export function ActivityItemRow({ fontSize, item, palette }: { fontSize: number; item: ActivityItem; palette: Palette }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useRecyclingState(false, [item.id]);
  const [copied, setCopied] = useRecyclingState(false, [item.id]);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(timer);
  }, [copied, setCopied]);

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
    label = getToolLabel(item.tool, t);
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
    label = t('chat:diff.filesChangedSimple', { files: files.length, count: files.length });
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
          <Spinner size={12} color={palette.tint} />
        ) : toolStatus === 'error' ? (
          <MaterialCommunityIcons name="alert-circle-outline" size={14} color={palette.danger} />
        ) : null}
        <Text numberOfLines={1} className={cn(stylesClasses.label, "text-muted-foreground")} variant="label">{label}</Text>
        {secondary ? (
          <Text numberOfLines={1} className={cn(stylesClasses.command, "text-muted-foreground")} variant="label">{secondary}</Text>
        ) : null}
        {meta ? <Text className={cn(stylesClasses.meta, "text-muted-foreground")} variant="label">{meta}</Text> : null}
        {!secondary && !meta ? <View className={cn(stylesClasses.spacer)} /> : null}
        {expandable ? <MaterialCommunityIcons name={expanded ? 'chevron-down' : 'chevron-right'} size={15} color={palette.muted} /> : null}
      </Pressable>
      {expanded ? (
        item.kind === 'patch' ? (
          <View className={cn(stylesClasses.fileList)}>
            {files.map((file) => (
              <Text key={file} selectable className={cn("text-muted-foreground")} style={[styles.file]} variant="label">{file}</Text>
            ))}
          </View>
        ) : item.kind === 'tool' && isShellTool(item.tool) ? (
          <View className={cn(stylesClasses.shellBlock, "bg-background border-border")}>
            <Pressable
              accessibilityLabel={t(copied ? 'chat:cards.copied' : 'common:actions.copy')}
              accessibilityRole="button"
              hitSlop={8}
              onPress={() => void handleCopy()}
              style={styles.shellCopy}>
              <MaterialCommunityIcons name={copied ? 'check' : 'content-copy'} size={15} color={palette.muted} />
            </Pressable>
            <Text selectable style={[styles.shellText, { color: palette.muted, fontSize: Math.max(12, fontSize - 1) }]}>{body}</Text>
          </View>
        ) : (
          <View className={cn(stylesClasses.markdownBody)}>
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
  shellCopy: { position: 'absolute', right: 4, top: 4, zIndex: 1 },
  shellText: {
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
    lineHeight: 18,
    paddingRight: 20,
  },
  file: { fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }), fontSize: 12, lineHeight: 18 }
});

const stylesClasses = {
  "row": "items-center rounded-[8px] flex-row gap-2 min-h-8.5 px-0.5 py-1.25",
  "label": "shrink-0 font-semibold",
  "command": "flex-1 min-w-0",
  "spacer": "flex-1 min-w-0",
  "meta": "shrink-0",
  "fileList": "gap-1 mb-2 mt-0.5 px-0.5 py-1",
  "shellBlock": "rounded-[8px] border mb-2 mt-0.5 p-2.5 pt-3",
  "markdownBody": "pb-1.5 px-0.5 pt-0.5"
} as const;
