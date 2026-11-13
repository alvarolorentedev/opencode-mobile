import { cn } from '@/shared/ui/cn';
import { Text } from '@/shared/ui/text';
import { Spinner } from '@/shared/ui/spinner';
import { Icon } from '@/shared/ui/icon';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet } from 'react-native';

import { Colors } from '@/shared/ui/theme/theme';
import type { SubagentDetail } from '@/shared/presentation/transcript';

type Palette = typeof Colors.light;

const STATUS_ICONS = {
  completed: { name: 'check-circle-outline' as const, tone: 'tint' as const },
  failed: { name: 'alert-circle-outline' as const, tone: 'danger' as const },
  cancelled: { name: 'close-circle-outline' as const, tone: 'muted' as const },
};

// A subagent runs in a child session, so its main-chat representation is a chip
// that opens that chat rather than an activity row buried in the collapsible run.
export function SubagentRow({ detail, flat = false, onPress, palette }: {
  detail: SubagentDetail;
  flat?: boolean;
  onPress: (sessionID: string) => void;
  palette: Palette;
}) {
  const { t } = useTranslation();
  const description = detail.description?.trim();
  const agent = detail.agent?.trim();
  const label = description || agent || t('chat:tools.subagent');
  const showAgent = Boolean(agent && description && agent !== description);
  const status = t(`chat:subagent.${detail.status}`);
  const open = t('chat:subagent.open');
  const icon = detail.status === 'running' ? undefined : STATUS_ICONS[detail.status];
  const iconColor = icon?.tone === 'danger' ? palette.danger : icon?.tone === 'muted' ? palette.muted : palette.tint;

  return (
    <Pressable
      accessibilityLabel={`${label}${showAgent ? `, ${agent}` : ''}. ${status}. ${open}`}
      accessibilityRole="button"
      accessibilityState={{ busy: detail.status === 'running' }}
      className={cn(stylesClasses.chip, !flat && stylesClasses.inset)}
      onPress={() => onPress(detail.sessionID)}
      style={({ pressed }) => [
        styles.chip,
        { backgroundColor: pressed ? palette.surface : palette.surfaceAlt, borderColor: palette.border },
      ]}
      testID={`transcript-subagent-${detail.sessionID}`}>
      {detail.status === 'running' ? (
        <Spinner size={14} color={palette.tint} />
      ) : icon ? (
        <MaterialCommunityIcons name={icon.name} size={16} color={iconColor} />
      ) : null}
      <Text className={cn(stylesClasses.label, 'text-foreground')} numberOfLines={1} variant="description">{label}</Text>
      {showAgent ? <Text className={cn(stylesClasses.agent, 'text-muted-foreground')} numberOfLines={1} variant="label">{agent}</Text> : null}
      <Icon name="chevron-right" size={16} color={palette.muted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 8,
    minHeight: 38,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
});

const stylesClasses = {
  chip: 'items-center rounded-[14px] border flex-row gap-2 min-h-9.5 px-2.5 py-1.75',
  inset: 'ml-2 mr-[8%]',
  label: 'flex-1 min-w-0 font-semibold',
  agent: 'shrink-0',
} as const;
