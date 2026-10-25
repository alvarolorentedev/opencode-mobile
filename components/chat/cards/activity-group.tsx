import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRecyclingState } from '@shopify/flash-list';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Text } from 'react-native-paper';

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
export function ActivityGroupRow({ flat = false, fontSize, group, palette, sessionRunning = false }: { flat?: boolean; fontSize: number; group: ActivityGroup; palette: Palette; sessionRunning?: boolean }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useRecyclingState(false, [group.key]);
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
  const label = hasToolType && group.callCount > 0
    ? t('chat:activity.used', { count: group.callCount, tools: types.join(', ') })
    : reasoningCount > 0
      ? t('chat:activity.thoughtCount', { count: reasoningCount })
      : types.join(', ');
  const actionLabel = t(expanded ? 'chat:activity.collapseActivity' : 'chat:activity.expandActivity');

  return (
    <View style={[styles.container, !flat && styles.containerAssistant]}>
      <Pressable
        accessibilityLabel={`${label}. ${actionLabel}`}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        onPress={() => setExpanded((value) => !value)}
        style={({ pressed }) => [styles.header, pressed ? { backgroundColor: palette.surfaceAlt } : null]}
        testID={`transcript-activity-${group.key}`}>
        <Text variant="bodyMedium" numberOfLines={2} style={[styles.label, { color: palette.muted }]}>{label}</Text>
        <View style={styles.spacer} />
        {group.status === 'error' ? <MaterialCommunityIcons name="alert-circle-outline" size={15} color={palette.danger} /> : null}
        {showProgress ? <ActivityIndicator size={12} color={palette.tint} /> : null}
        <MaterialCommunityIcons name={expanded ? 'chevron-down' : 'chevron-right'} size={16} color={palette.muted} />
      </Pressable>
      {expanded ? (
        <View style={styles.items}>
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
  container: { alignSelf: 'stretch' },
  containerAssistant: { marginLeft: 8, marginRight: '8%' },
  header: { alignItems: 'center', borderRadius: 8, flexDirection: 'row', gap: 8, minHeight: 34, paddingHorizontal: 2, paddingVertical: 3 },
  label: { flexShrink: 1 },
  spacer: { flex: 1, minWidth: 0 },
  items: { paddingTop: 1 },
});
