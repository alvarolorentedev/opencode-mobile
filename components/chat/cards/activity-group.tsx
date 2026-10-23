import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Text } from 'react-native-paper';

import { ActivityItemRow } from '@/components/chat/cards/activity-item';
import { Colors } from '@/constants/theme';
import { getToolDisplayName } from '@/lib/opencode/format';
import type { ActivityGroup } from '@/lib/opencode/transcript';

type Palette = typeof Colors.light;

// A contiguous run of reasoning/tool/patch activity between message bubbles.
// The header is the first collapse level. A run with active work opens itself;
// once the user toggles it, the explicit choice wins for the life of the key.
export function ActivityGroupRow({ flat = false, fontSize, group, palette }: { flat?: boolean; fontSize: number; group: ActivityGroup; palette: Palette }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState<boolean | undefined>(undefined);
  const isExpanded = expanded ?? group.status === 'running';
  const running = group.status === 'running';

  const tools = group.tools.map((tool) => getToolDisplayName(tool.name)).join(', ');
  const label = group.callCount > 0
    ? t('chat:activity.used', { count: group.callCount, tools })
    : group.items.length > 1
      ? t('chat:activity.thoughtCount', { count: group.items.length })
      : t('chat:activity.thought');
  const actionLabel = t(isExpanded ? 'chat:activity.collapseActivity' : 'chat:activity.expandActivity');

  return (
    <View style={[styles.container, !flat && styles.containerAssistant]}>
      <Pressable
        accessibilityLabel={`${label}. ${actionLabel}`}
        accessibilityRole="button"
        accessibilityState={{ expanded: isExpanded }}
        onPress={() => setExpanded((value) => !(value ?? running))}
        style={({ pressed }) => [styles.header, pressed ? { backgroundColor: palette.surfaceAlt } : null]}
        testID={`transcript-activity-${group.key}`}>
        <Text variant="bodyMedium" numberOfLines={1} style={[styles.label, { color: palette.muted }]}>{label}</Text>
        <View style={styles.spacer} />
        {group.status === 'error' ? <MaterialCommunityIcons name="alert-circle-outline" size={15} color={palette.danger} /> : null}
        {running ? <ActivityIndicator size={12} color={palette.tint} /> : null}
        <MaterialCommunityIcons name={isExpanded ? 'chevron-down' : 'chevron-right'} size={16} color={palette.muted} />
      </Pressable>
      {isExpanded ? (
        <View style={styles.items}>
          {group.items.map((item) => (
            <ActivityItemRow fontSize={fontSize} item={item} key={item.id} palette={palette} />
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
