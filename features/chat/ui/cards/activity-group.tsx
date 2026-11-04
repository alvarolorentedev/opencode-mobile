import { cn } from '@/shared/ui/cn';
import { Text } from '@/shared/ui/text';
import { Spinner } from '@/shared/ui/spinner';
import { Icon } from '@/shared/ui/icon';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';

import { ActivityItemRow, ActivityReadGroupRow } from '@/features/chat/ui/cards/activity-item';
import { Colors } from '@/shared/ui/theme/theme';
import { getToolLabel } from '@/shared/presentation/format/tool-label';
import { buildActivityChildRows, type ActivityGroup } from '@/shared/presentation/transcript';

type Palette = typeof Colors.light;

// A contiguous run of reasoning/tool/patch activity between message bubbles.
// The header is the first collapse level. Expansion is owned by the transcript
// list so it survives recycling and a pinned header can share it. Active work
// only changes the progress affordance, never the collapse state, so a run
// cannot open and close on its own while it streams. `statusLabel` renders a
// transient live-status row with the same footprint when no real activity run
// exists; it is not expandable and has no chevron.
export function ActivityGroupRow({
  expanded,
  flat = false,
  fontSize,
  group,
  headerOnly = false,
  onExpandedChange,
  palette,
  pinned = false,
  sessionRunning = false,
  statusLabel,
}: {
  expanded: boolean;
  flat?: boolean;
  fontSize: number;
  group: ActivityGroup;
  headerOnly?: boolean;
  onExpandedChange: (expanded: boolean) => void;
  palette: Palette;
  pinned?: boolean;
  sessionRunning?: boolean;
  statusLabel?: string;
}) {
  const { t } = useTranslation();
  const statusOnly = statusLabel !== undefined;
  const running = group.status === 'running';
  const showProgress = running || sessionRunning;

  const childRows = useMemo(() => buildActivityChildRows(group.items), [group.items]);
  const reasoningCount = useMemo(() => group.items.filter((item) => item.kind === 'reasoning').length, [group.items]);
  const types = useMemo(() => {
    const names: string[] = [];
    const add = (name: string) => {
      if (!names.includes(name)) names.push(name);
    };

    for (const row of childRows) {
      if (row.kind === 'read') {
        add(getToolLabel('read', t));
      } else if (row.item.kind === 'tool') {
        add(getToolLabel(row.item.tool, t));
      } else if (row.item.kind === 'patch') {
        add(getToolLabel('patch', t));
      }
    }

    if (reasoningCount > 0) add(t('chat:activity.thought'));
    return names;
  }, [childRows, reasoningCount, t]);
  const hasToolType = childRows.some((row) => row.kind === 'read' || row.item.kind === 'tool' || row.item.kind === 'patch');
  const label = statusLabel ?? (hasToolType && group.callCount > 0
    ? t('chat:activity.used', { count: group.callCount, tools: types.join(', ') })
    : reasoningCount > 0
      ? t('chat:activity.thoughtCount', { count: reasoningCount })
      : types.join(', '));
  const actionLabel = t(expanded ? 'chat:activity.collapseActivity' : 'chat:activity.expandActivity');
  const testID = pinned ? `transcript-sticky-activity-${group.key}` : `transcript-activity-${group.key}`;
  const header = (
    <>
      <Text numberOfLines={2} className={cn(stylesClasses.label, "text-muted-foreground")} variant="description">{label}</Text>
      <View className={cn(stylesClasses.spacer)} />
      {group.status === 'error' ? <MaterialCommunityIcons name="alert-circle-outline" size={15} color={palette.danger} /> : null}
      {showProgress ? <Spinner size={12} color={palette.tint} /> : null}
      {statusOnly ? null : <Icon name={expanded ? 'chevron-down' : 'chevron-right'} size={16} color={palette.muted} />}
    </>
  );

  return (
    <View className={cn(stylesClasses.container, !flat && stylesClasses.containerAssistant)}>
      {statusOnly ? (
        <View
          accessible
          accessibilityLabel={label}
          accessibilityLiveRegion="polite"
          className={cn(stylesClasses.header)}
          testID={testID}>
          {header}
        </View>
      ) : (
        <Pressable
          accessibilityLabel={`${label}. ${actionLabel}`}
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          onPress={() => onExpandedChange(!expanded)}
          style={({ pressed }) => [
            styles.header,
            pinned ? { backgroundColor: palette.background } : null,
            pressed ? { backgroundColor: palette.surfaceAlt } : null,
          ]}
          testID={testID}>
          {header}
        </Pressable>
      )}
      {!statusOnly && expanded && !headerOnly ? (
        <View className={cn(stylesClasses.items)}>
          {childRows.map((row) => (
            row.kind === 'read'
              ? <ActivityReadGroupRow key={row.key} palette={palette} reads={row.reads} />
              : <ActivityItemRow fontSize={fontSize} item={row.item} key={row.key} palette={palette} />
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { alignItems: 'center', borderRadius: 8, flexDirection: 'row', gap: 8, minHeight: 34, paddingHorizontal: 2, paddingVertical: 3 }
});

const stylesClasses = {
  "label": "shrink",
  "spacer": "flex-1 min-w-0",
  "container": "self-stretch",
  "containerAssistant": "ml-2 mr-[8%]",
  "header": "items-center rounded-[8px] flex-row gap-2 min-h-8.5 px-0.5 py-0.75",
  "items": "pt-0.25"
} as const;
