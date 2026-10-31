import { cn } from '@/shared/ui/cn';
import { Text } from '@/shared/ui/text';
import { Icon } from '@/shared/ui/icon';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { usePalette } from '@/shared/ui/theme/use-palette';
import type { ComposerSuggestion, ComposerSuggestionGroup, ComposerSuggestionKind } from '@/features/chat/ui/composer-suggestion-types';

const ICONS: Record<ComposerSuggestionKind, string> = {
  command: 'slash-forward',
  agent: 'robot-outline',
  skill: 'book-open-variant',
  file: 'file-outline',
  reference: 'bookmark-outline',
};

const KEYCAPS: Record<ComposerSuggestionKind, string> = {
  command: '/',
  agent: '@',
  skill: '@',
  file: '@',
  reference: '@',
};

const TITLES: Record<ComposerSuggestionKind, string> = {
  command: 'chat:composer.suggestions.commands',
  agent: 'chat:composer.suggestions.agents',
  skill: 'chat:composer.suggestions.skills',
  file: 'chat:composer.suggestions.files',
  reference: 'chat:composer.suggestions.references',
};

function suggestionTestID(suggestion: ComposerSuggestion) {
  return `composer-suggestion-${suggestion.kind}-${suggestion.label.slice(1).replace(/[^a-zA-Z0-9_.-]+/g, '-')}`;
}

export function ComposerSuggestions({
  groups,
  searching,
  error,
  onSelect,
}: {
  groups: ComposerSuggestionGroup[];
  searching: boolean;
  error?: string;
  onSelect: (suggestion: ComposerSuggestion) => void;
}) {
  const { t } = useTranslation();
  const palette = usePalette();
  const empty = groups.length === 0 && !searching && !error;

  return (
    <View testID="chat-composer-suggestions" className={cn(stylesClasses.panel, "bg-surface border-border")}>
      <ScrollView keyboardShouldPersistTaps="handled" nestedScrollEnabled className={cn(stylesClasses.scroll)} contentContainerStyle={styles.content}>
        {groups.map((group) => (
          <View key={group.kind} className={cn(stylesClasses.group)}>
            <Text className={cn("text-muted-foreground")} style={[styles.groupTitle]} variant="label">{t(TITLES[group.kind])}</Text>
            {group.items.map((suggestion) => (
              <Pressable
                key={suggestion.key}
                accessibilityRole="button"
                accessibilityLabel={suggestion.description ? `${suggestion.label}, ${suggestion.description}` : suggestion.label}
                testID={suggestionTestID(suggestion)}
                onPress={() => onSelect(suggestion)}
                style={({ pressed }) => [styles.row, pressed && { backgroundColor: palette.surfaceAlt }]}>
                <View className={cn(stylesClasses.iconWrap, "bg-surface-alt")}>
                  <Icon size={18} color={palette.muted} name={ICONS[suggestion.kind]}></Icon>
                </View>
                <View className={cn(stylesClasses.copy)}>
                  <Text numberOfLines={1} className={cn("text-foreground")} style={[styles.label]}>{suggestion.label}</Text>
                  {suggestion.description ? (
                    <Text numberOfLines={2} className={cn(stylesClasses.description, "text-muted-foreground")}>{suggestion.description}</Text>
                  ) : null}
                </View>
                <Text className={cn(stylesClasses.keycap, "text-muted-foreground border-border")}>{KEYCAPS[suggestion.kind]}</Text>
              </Pressable>
            ))}
          </View>
        ))}
        {searching ? <Text className={cn(stylesClasses.status, "text-muted-foreground")}>{t('chat:composer.suggestions.searching')}</Text> : null}
        {error ? <Text accessibilityRole="alert" className={cn(stylesClasses.status, "text-destructive")}>{error}</Text> : null}
        {empty ? <Text className={cn(stylesClasses.status, "text-muted-foreground")}>{t('chat:composer.suggestions.empty')}</Text> : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { paddingVertical: 6 },
  groupTitle: {
    fontWeight: '700',
    letterSpacing: 0.4,
    paddingHorizontal: 12,
    paddingVertical: 4,
    textTransform: 'uppercase',
  },
  row: {
    alignItems: 'center',
    borderRadius: 10,
    flexDirection: 'row',
    gap: 10,
    marginHorizontal: 6,
    minHeight: 46,
    paddingHorizontal: 6,
    paddingVertical: 6,
  },
  label: { fontFamily: 'monospace', fontSize: 14, fontWeight: '600' }
});

const stylesClasses = {
  "panel": "border rounded-[14px] mb-2 max-h-72 overflow-hidden",
  "scroll": "grow-0",
  "group": "py-0.5",
  "iconWrap": "items-center rounded-[8px] h-7.5 justify-center w-7.5",
  "copy": "flex-1 min-w-0",
  "description": "text-[12px] mt-0.25",
  "keycap": "rounded-[6px] border text-[11px] font-bold min-w-5.5 px-1.25 py-0.5 text-center",
  "status": "text-[12px] px-3 py-2.5"
} as const;
