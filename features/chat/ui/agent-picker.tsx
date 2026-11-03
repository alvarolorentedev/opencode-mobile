import { cn } from '@/shared/ui/cn';
import { Icon } from '@/shared/ui/icon';
import { OverlaySheet } from '@/shared/ui/overlay-sheet';
import { Text } from '@/shared/ui/text';
import { useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Fonts } from '@/shared/ui/theme/theme';
import { usePalette } from '@/shared/ui/theme/use-palette';
import { withAlpha } from '@/shared/ui/theme/color';
import type { AgentOption } from '@/shared/contracts/model-options';
import { agentDescriptionKey, orderAgentsForPicker } from '@/features/chat/ui/agent-picker-utils';

export function AgentPicker({ agents, onClose, onSelect, selectedValue, visible, loading = false }: {
  agents: AgentOption[];
  onClose: () => void;
  onSelect: (value: string) => void;
  selectedValue?: string;
  loading?: boolean;
  visible: boolean;
}) {
  const { t } = useTranslation();
  const palette = usePalette();
  const orderedAgents = useMemo(() => orderAgentsForPicker(agents), [agents]);

  return (
    <OverlaySheet visible={visible} title={t('chat:composer.chooseAgent')} onClose={onClose} fitContent testID="chat-agent-picker">
      {orderedAgents.length === 0 ? <Text accessibilityRole="alert" className="text-muted-foreground">{t(loading ? 'chat:composer.loadingAgents' : 'chat:composer.noEligibleAgent')}</Text> : null}
      {orderedAgents.map((agent) => {
        const selected = agent.id === selectedValue;
        const descriptionKey = agentDescriptionKey(agent.id);
        const description = agent.description || (descriptionKey ? t(descriptionKey) : undefined);
        return (
          <Pressable
            key={agent.id}
            accessibilityRole="radio"
            accessibilityLabel={agent.label}
            accessibilityState={{ checked: selected }}
            aria-checked={selected}
            onPress={() => onSelect(agent.id)}
            testID={`chat-agent-option-${agent.id}`}
            style={({ pressed }) => [
              styles.option,
              {
                backgroundColor: selected ? withAlpha(palette.tint, 0x12 / 255) : palette.background,
                borderColor: selected ? palette.tint : palette.border,
                opacity: pressed ? 0.82 : 1,
              },
            ]}>
            <View className={cn(stylesClasses.optionText)}>
              <Text className={cn("text-foreground")} style={[styles.optionLabel]}>{agent.label}</Text>
              {description ? <Text numberOfLines={2} ellipsizeMode="tail" className={cn("text-muted-foreground")} style={[styles.optionDescription]}>{description}</Text> : null}
            </View>
            {selected ? <Icon name="check" size={20} color={palette.tint} /> : null}
          </Pressable>
        );
      })}
    </OverlaySheet>
  );
}

const styles = StyleSheet.create({
  option: { alignItems: 'center', borderRadius: 16, borderWidth: 1, flexDirection: 'row', gap: 12, minHeight: 56, paddingHorizontal: 14, paddingVertical: 10 },
  optionLabel: { fontFamily: Fonts.sans, fontSize: 16, fontWeight: '600' },
  optionDescription: { fontFamily: Fonts.sans, fontSize: 13 }
});

const stylesClasses = {
  "optionText": "flex-1 gap-0.5 min-w-0"
} as const;
