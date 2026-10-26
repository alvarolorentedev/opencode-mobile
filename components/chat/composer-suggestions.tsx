import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Icon, Text } from 'react-native-paper';

import { usePalette } from '@/hooks/use-palette';
import type { ComposerSuggestion, ComposerSuggestionGroup, ComposerSuggestionKind } from './composer-suggestion-types';

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
    <View testID="chat-composer-suggestions" style={[styles.panel, { backgroundColor: palette.surface, borderColor: palette.border }]}>
      <ScrollView keyboardShouldPersistTaps="handled" nestedScrollEnabled style={styles.scroll} contentContainerStyle={styles.content}>
        {groups.map((group) => (
          <View key={group.kind} style={styles.group}>
            <Text variant="labelSmall" style={[styles.groupTitle, { color: palette.muted }]}>{t(TITLES[group.kind])}</Text>
            {group.items.map((suggestion) => (
              <Pressable
                key={suggestion.key}
                accessibilityRole="button"
                accessibilityLabel={suggestion.description ? `${suggestion.label}, ${suggestion.description}` : suggestion.label}
                testID={suggestionTestID(suggestion)}
                onPress={() => onSelect(suggestion)}
                style={({ pressed }) => [styles.row, pressed && { backgroundColor: palette.surfaceAlt }]}>
                <View style={[styles.iconWrap, { backgroundColor: palette.surfaceAlt }]}>
                  <Icon source={ICONS[suggestion.kind]} size={18} color={palette.muted} />
                </View>
                <View style={styles.copy}>
                  <Text numberOfLines={1} style={[styles.label, { color: palette.text }]}>{suggestion.label}</Text>
                  {suggestion.description ? (
                    <Text numberOfLines={2} style={[styles.description, { color: palette.muted }]}>{suggestion.description}</Text>
                  ) : null}
                </View>
                <Text style={[styles.keycap, { color: palette.muted, borderColor: palette.border }]}>{KEYCAPS[suggestion.kind]}</Text>
              </Pressable>
            ))}
          </View>
        ))}
        {searching ? <Text style={[styles.status, { color: palette.muted }]}>{t('chat:composer.suggestions.searching')}</Text> : null}
        {error ? <Text accessibilityRole="alert" style={[styles.status, { color: palette.danger }]}>{error}</Text> : null}
        {empty ? <Text style={[styles.status, { color: palette.muted }]}>{t('chat:composer.suggestions.empty')}</Text> : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    borderWidth: 1,
    borderRadius: 14,
    marginBottom: 8,
    maxHeight: 288,
    overflow: 'hidden',
  },
  scroll: { flexGrow: 0 },
  content: { paddingVertical: 6 },
  group: { paddingVertical: 2 },
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
  iconWrap: {
    alignItems: 'center',
    borderRadius: 8,
    height: 30,
    justifyContent: 'center',
    width: 30,
  },
  copy: { flex: 1, minWidth: 0 },
  label: { fontFamily: 'monospace', fontSize: 14, fontWeight: '600' },
  description: { fontSize: 12, marginTop: 1 },
  keycap: {
    borderRadius: 6,
    borderWidth: 1,
    fontSize: 11,
    fontWeight: '700',
    minWidth: 22,
    paddingHorizontal: 5,
    paddingVertical: 2,
    textAlign: 'center',
  },
  status: { fontSize: 12, paddingHorizontal: 12, paddingVertical: 10 },
});
