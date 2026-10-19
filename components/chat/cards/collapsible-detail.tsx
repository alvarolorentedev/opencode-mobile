import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';

import { MarkdownText } from '@/components/chat/chat-markdown';
import { Colors } from '@/constants/theme';
import type { TranscriptDetail } from '@/lib/opencode/format';

type Palette = typeof Colors.light;

const ICONS: Record<string, keyof typeof MaterialCommunityIcons.glyphMap> = {
  tool: 'wrench-outline',
  reasoning: 'brain',
};

// Tool calls and reasoning are timeline events, not chat messages: render them
// as flat, collapsed rows rather than bubbles. Local state keeps expansion
// independent per row and out of the provider.
export function CollapsibleDetail({ detail, fontSize, palette }: { detail: TranscriptDetail; fontSize: number; palette: Palette }) {
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
        <View style={styles.bodyWrap}>
          <MarkdownText
            color={palette.text}
            fontSize={fontSize}
            mutedColor={palette.muted}
            text={detail.body || detail.label}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignSelf: 'stretch', borderLeftWidth: 2, borderRadius: 10, overflow: 'hidden' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 10, paddingVertical: 8 },
  label: { flex: 1 },
  bodyWrap: { paddingHorizontal: 12, paddingBottom: 10 },
});
