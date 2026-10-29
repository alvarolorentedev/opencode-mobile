import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Icon, IconButton, Searchbar, Text } from 'react-native-paper';

import { ControlSize, Shape, Spacing } from '@/constants/design-tokens';
import { usePalette } from '@/hooks/use-palette';
import { ServerContextPicker } from './server-context-picker';
import type { SettingsSection } from './settings-section-registry';
import { searchSettings, type SettingsTarget } from './settings-search';

export function SettingsHome({ sections, onOpen }: {
  sections: SettingsSection[];
  onOpen: (section: SettingsSection, target?: SettingsTarget) => void;
}) {
  const { t } = useTranslation();
  const palette = usePalette();
  const [query, setQuery] = useState('');
  const search = useRef<React.ComponentRef<typeof Searchbar>>(null);
  const results = searchSettings(sections, query);
  const searching = Boolean(query.trim());
  return <ScrollView keyboardShouldPersistTaps="handled" style={{ backgroundColor: palette.background }} contentContainerStyle={styles.content}>
    <Text variant="bodyMedium" style={{ color: palette.muted }}>{t('settings:screen.intro')}</Text>
    <Searchbar ref={search} testID="settings-search" placeholder={t('settings:screen.search.placeholder')}
      accessibilityLabel={t('settings:screen.search.placeholder')} clearAccessibilityLabel={t('settings:screen.search.clear')}
      right={({ color }) => query ? <IconButton icon="close" iconColor={color} accessibilityLabel={t('settings:screen.search.clear')} onPress={() => setQuery('')} /> : null}
      value={query} onChangeText={setQuery} style={[styles.search, { backgroundColor: palette.surface }]} />
    {searching ? <View style={styles.group}>
      <Text accessibilityLiveRegion="polite" variant="bodyMedium" style={{ color: palette.muted }}>
        {results.length ? t('settings:screen.search.results', { count: results.length }) : t('settings:screen.search.empty')}
      </Text>
      {results.map(({ section, target }) => <Pressable key={`${section.id}:${target?.group ?? ''}:${target?.label ?? ''}`} accessibilityRole="button"
        accessibilityLabel={`${target?.label ?? section.title}. ${section.title}${target?.path ? ` · ${target.path}` : ''}`} onPress={() => { search.current?.blur(); onOpen(section, target); }}
        style={({ pressed }) => [styles.result, { backgroundColor: pressed ? palette.surfaceAlt : palette.surface, borderColor: palette.border }]}>
        <View style={styles.rowText}><Text variant="titleSmall" style={{ color: palette.text }}>{target?.label ?? section.title}</Text>
          <Text variant="bodyMedium" style={{ color: palette.muted }}>{section.title}{target?.path ? ` · ${target.path}` : ''}</Text></View>
        <Icon source="arrow-top-right" size={20} color={palette.muted} />
      </Pressable>)}
    </View> : (['app', 'connections', 'server'] as const).map((group) => <View key={group} style={styles.group}>
      <Text accessibilityRole="header" variant="titleSmall" style={{ color: palette.muted }}>{t(`settings:screen.groups.${group}`)}</Text>
      {group === 'server' ? <ServerContextPicker /> : null}
      <View style={[styles.categoryGroup, { backgroundColor: palette.surface, borderColor: palette.border }]}>
        {sections.filter((section) => section.group === group).map((section, index) => <Pressable key={section.id}
          testID={`settings-category-${section.id}`} accessibilityRole="button" accessibilityLabel={`${section.title}. ${section.summary}`}
          onPress={() => onOpen(section)} style={({ pressed }) => [styles.category, index > 0 && { borderTopColor: palette.border, borderTopWidth: StyleSheet.hairlineWidth }, pressed && { backgroundColor: palette.surfaceAlt }]}>
          <View style={[styles.icon, { backgroundColor: palette.surfaceAlt }]}><MaterialCommunityIcons name={section.icon} size={22} color={palette.tint} /></View>
          <View style={styles.rowText}><Text variant="titleMedium" style={{ color: palette.text }}>{section.title}</Text>
            <Text variant="bodyMedium" style={{ color: palette.muted }}>{section.summary}</Text></View>
          <Icon source="chevron-right" size={20} color={palette.muted} />
        </Pressable>)}
      </View>
    </View>)}
  </ScrollView>;
}

const styles = StyleSheet.create({
  content: { padding: Spacing.lg, paddingBottom: Spacing.xxl, gap: Spacing.xl, width: '100%', maxWidth: ControlSize.contentWidth, alignSelf: 'center' },
  search: { borderRadius: Shape.control, elevation: 0 },
  group: { gap: Spacing.md },
  categoryGroup: { borderRadius: Shape.group, borderWidth: 1, overflow: 'hidden' },
  category: { minHeight: ControlSize.row, padding: Spacing.lg, flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  icon: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  rowText: { flex: 1, minWidth: 0, gap: Spacing.xs },
  result: { minHeight: ControlSize.row, padding: Spacing.lg, flexDirection: 'row', alignItems: 'center', gap: Spacing.md, borderRadius: Shape.control, borderWidth: 1 },
});
