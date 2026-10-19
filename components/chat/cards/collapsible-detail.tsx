import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';

import { Colors } from '@/constants/theme';
import type { TranscriptDetail } from '@/lib/opencode/format';

type Palette = typeof Colors.light;

const ICONS: Record<string, keyof typeof MaterialCommunityIcons.glyphMap> = {
  tool: 'wrench-outline',
  reasoning: 'brain',
  subtask: 'source-branch',
  step: 'flag-outline',
  agent: 'robot-outline',
};

// Tool calls and reasoning are timeline events, not chat messages: render them
// as flat, collapsed rows rather than bubbles. Local state keeps expansion
// independent per row and out of the provider.
export function CollapsibleDetail({ detail, palette }: { detail: TranscriptDetail; palette: Palette }) {
  const [expanded, setExpanded] = useState(false);
  const icon = ICONS[detail.kind] ?? 'chevron-right';
  const status = 'status' in detail ? detail.status : undefined;
  const accent = status === 'error' ? palette.danger : status === 'running' ? palette.tint : palette.muted;

  return (
    <View style={[styles.container, { borderColor: palette.border, backgroundColor: palette.surface }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={detail.label}
        onPress={() => setExpanded((current) => !current)}
        style={styles.header}
        testID={`transcript-detail-${detail.id}`}>
        <MaterialCommunityIcons name={icon} size={15} color={accent} />
        <Text numberOfLines={1} variant="labelMedium" style={[styles.label, { color: palette.text }]}>{detail.label}</Text>
        <MaterialCommunityIcons name={expanded ? 'chevron-up' : 'chevron-down'} size={16} color={palette.muted} />
      </Pressable>
      {expanded ? (
        <Text selectable variant="bodySmall" style={[styles.body, { color: palette.muted }]}>
          {detail.body || detail.label}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignSelf: 'stretch', borderLeftWidth: 2, borderRadius: 10, marginLeft: 8, marginRight: 8, overflow: 'hidden' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 10, paddingVertical: 8 },
  label: { flex: 1 },
  body: { paddingHorizontal: 12, paddingBottom: 10, lineHeight: 18 },
});
