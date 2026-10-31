import { cn } from '@/lib/utils';
import { Text } from '@/components/ui/text';
import { Spinner } from '@/components/ui/spinner';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRecyclingState } from '@shopify/flash-list';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';


import { ActivityItemRow, ActivityReadGroupRow } from '@/components/chat/cards/activity-item';
import { Colors } from '@/constants/theme';
import { getToolLabel } from '@/lib/opencode/format/tool-label';
import { buildActivityChildRows, type ActivityGroup } from '@/lib/opencode/transcript';

type Palette = typeof Colors.light;

// A contiguous run of reasoning/tool/patch activity between message bubbles.
// The header is the first collapse level. Runs always start collapsed:
// expansion is an explicit user action, and the keyed state keeps it for the
// life of the row. Active work only changes the progress affordance, never the
// collapse state, so a run cannot open and close on its own while it streams.
// `statusLabel` renders a transient live-status row with the same footprint
// when no real activity run exists; it is not expandable and has no chevron.
export function ActivityGroupRow({ flat = false, fontSize, group, palette, sessionRunning = false, statusLabel }: { flat?: boolean; fontSize: number; group: ActivityGroup; palette: Palette; sessionRunning?: boolean; statusLabel?: string }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useRecyclingState(false, [group.key]);
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
  const header = (
    <>
      <Text numberOfLines={2} className={cn(stylesClasses.label, "text-muted-foreground")} variant="description">{label}</Text>
      <View className={cn(stylesClasses.spacer)} />
      {group.status === 'error' ? <MaterialCommunityIcons name="alert-circle-outline" size={15} color={palette.danger} /> : null}
      {showProgress ? <Spinner size={12} color={palette.tint} /> : null}
      {statusOnly ? null : <MaterialCommunityIcons name={expanded ? 'chevron-down' : 'chevron-right'} size={16} color={palette.muted} />}
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
          testID={`transcript-activity-${group.key}`}>
          {header}
        </View>
      ) : (
        <Pressable
          accessibilityLabel={`${label}. ${actionLabel}`}
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          onPress={() => setExpanded((value) => !value)}
          style={({ pressed }) => [styles.header, pressed ? { backgroundColor: palette.surfaceAlt } : null]}
          testID={`transcript-activity-${group.key}`}>
          {header}
        </Pressable>
      )}
      {!statusOnly && expanded ? (
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
