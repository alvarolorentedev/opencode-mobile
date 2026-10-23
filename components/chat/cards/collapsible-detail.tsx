import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';

import { MarkdownText } from '@/components/chat/chat-markdown';
import { Colors } from '@/constants/theme';
import { isShellTool, type DetailGroup, type ToolDetail } from '@/lib/opencode/transcript';

type Palette = typeof Colors.light;

// Tool calls and reasoning are timeline events, not chat messages: render them
// as flat, collapsed rows rather than bubbles. Contiguous calls of the same tool
// accumulate into one group; the shell variant renders commands and output as a
// single raw bash block. Local state keeps expansion independent per row.
export function CollapsibleDetail({ group, flat = false, fontSize, palette }: { group: DetailGroup; flat?: boolean; fontSize: number; palette: Palette }) {
  const [expanded, setExpanded] = useState(false);
  let shellDetails: ToolDetail[] = [];
  if (group.kind === 'tool' && isShellTool(group.tool)) {
    shellDetails = group.details;
  }
  const shell = shellDetails.length > 0;
  const first = group.details[0];
  const current = shell ? shellDetails.find((detail) => detail.status === 'running') ?? shellDetails[shellDetails.length - 1] : undefined;
  const command = current?.command;
  const label = shell
    ? `Running ${command || first.label}`
    : group.details.length > 1 ? `${first.label} ×${group.details.length}` : first.label;

  let status: string | undefined;
  if (group.kind === 'tool') {
    const failed = group.details.find((detail) => detail.status === 'error');
    const running = group.details.find((detail) => detail.status === 'running');
    status = failed ? 'error' : running ? 'running' : undefined;
  }
  const accent = status === 'error' ? palette.danger : status === 'running' ? palette.tint : palette.muted;
  const icon = group.kind === 'reasoning' ? 'brain' : shell ? 'console' : 'wrench-outline';
  const shellText = shell
    ? shellDetails.map((detail) => {
        const commandText = detail.command?.trim() || detail.label;
        const result = detail.body;
        const running = detail.status === 'running' || detail.status === 'pending';
        const output = result && result.trim() && !(running && result === 'No output') ? result : undefined;
        return output ? `$ ${commandText}\n${output}` : `$ ${commandText}`;
      }).join('\n\n')
    : '';

  return (
    <View style={[styles.container, !flat && styles.containerAssistant, { borderColor: palette.border, backgroundColor: palette.surface }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={label}
        onPress={() => setExpanded((current) => !current)}
        style={styles.header}
        testID={`transcript-detail-${group.key}`}>
        <MaterialCommunityIcons name={icon} size={15} color={accent} />
        <Text numberOfLines={1} variant="labelMedium" style={[styles.label, { color: palette.text }]}>{label}</Text>
        <MaterialCommunityIcons name={expanded ? 'chevron-up' : 'chevron-down'} size={16} color={palette.muted} />
      </Pressable>
      {expanded ? (
        shell ? (
          <View style={[styles.shellBlock, { backgroundColor: palette.background }]}>
            <Text selectable={false} style={[styles.shellText, { color: palette.text, fontSize: Math.max(12, fontSize - 1) }]}>
              {shellText}
            </Text>
          </View>
        ) : (
          <View style={styles.markdownStack}>
            {group.details.map((detail) => (
              <MarkdownText
                codePalette={palette.code}
                color={palette.text}
                fontSize={fontSize}
                key={detail.id}
                mutedColor={palette.muted}
                text={detail.body || detail.label}
              />
            ))}
          </View>
        )
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignSelf: 'stretch', borderLeftWidth: 2, borderRadius: 10, overflow: 'hidden' },
  containerAssistant: { marginLeft: 8, marginRight: '8%' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 10, paddingVertical: 8 },
  label: { flex: 1 },
  shellBlock: { borderRadius: 8, marginBottom: 10, marginHorizontal: 10, padding: 10 },
  shellText: {
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
    lineHeight: 18,
  },
  markdownStack: { gap: 10, paddingBottom: 10, paddingHorizontal: 12 },
});
