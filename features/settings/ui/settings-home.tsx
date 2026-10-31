import { cn } from '@/shared/ui/cn';
import { TextField } from '@/shared/ui/text-field';
import { Text } from '@/shared/ui/text';
import { Button } from '@/shared/ui/button';
import { Icon } from '@/shared/ui/icon';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ControlSize, Shape, Spacing } from '@/shared/ui/theme/design-tokens';
import { usePalette } from '@/shared/ui/theme/use-palette';
import { ServerContextPicker } from '@/features/settings/ui/server-context-picker';
import type { SettingsSection } from '@/features/settings/ui/settings-section-registry';
import { searchSettings } from '@/features/settings/ui/settings-search';
import type { SettingsTarget } from '@/shared/ui/settings/target';

export function SettingsHome({ sections, onOpen }: {
  sections: SettingsSection[];
  onOpen: (section: SettingsSection, target?: SettingsTarget) => void;
}) {
  const { t } = useTranslation();
  const palette = usePalette();
  const [query, setQuery] = useState('');
  const search = useRef<React.ComponentRef<typeof TextField>>(null);
  const results = searchSettings(sections, query);
  const searching = Boolean(query.trim());
  return <ScrollView keyboardShouldPersistTaps="handled" className={cn("bg-background")} contentContainerStyle={styles.content}>
    <Text className={cn("text-muted-foreground")} variant="description">{t('settings:screen.intro')}</Text>
    <TextField ref={search} testID="settings-search" placeholder={t('settings:screen.search.placeholder')} accessibilityLabel={t('settings:screen.search.placeholder')} value={query} onChangeText={setQuery} className={cn("bg-surface")} style={[styles.search, undefined]} endAdornment={query ? <Button accessibilityLabel={t('settings:screen.search.clear')} onPress={() => setQuery('')} variant="ghost" size="icon"><Icon name={"close"} size={24} color={palette.muted} /></Button> : null}></TextField>
    {searching ? <View className={cn(stylesClasses.group)}>
      <Text accessibilityLiveRegion="polite" className={cn("text-muted-foreground")} variant="description">{results.length ? t('settings:screen.search.results', { count: results.length }) : t('settings:screen.search.empty')}</Text>
      {results.map(({ section, target }) => <Pressable key={`${section.id}:${target?.group ?? ''}:${target?.label ?? ''}`} accessibilityRole="button"
        accessibilityLabel={`${target?.label ?? section.title}. ${section.title}${target?.path ? ` · ${target.path}` : ''}`} onPress={() => { search.current?.blur(); onOpen(section, target); }}
        style={({ pressed }) => [styles.result, { backgroundColor: pressed ? palette.surfaceAlt : palette.surface, borderColor: palette.border }]}>
        <View className={cn(stylesClasses.rowText)}><Text className={cn("text-foreground")} variant="description">{target?.label ?? section.title}</Text>
          <Text className={cn("text-muted-foreground")} variant="description">{section.title}{target?.path ? ` · ${target.path}` : ''}</Text></View>
        <Icon size={20} color={palette.muted} name={"arrow-top-right"}></Icon>
      </Pressable>)}
    </View> : (['app', 'connections', 'server'] as const).map((group) => <View key={group} className={cn(stylesClasses.group)}>
      <Text accessibilityRole="header" className={cn("text-muted-foreground")} variant="description">{t(`settings:screen.groups.${group}`)}</Text>
      {group === 'server' ? <ServerContextPicker /> : null}
      <View className={cn(stylesClasses.categoryGroup, "bg-surface border-border")}>
        {sections.filter((section) => section.group === group).map((section, index) => <Pressable key={section.id}
          testID={`settings-category-${section.id}`} accessibilityRole="button" accessibilityLabel={`${section.title}. ${section.summary}`}
          onPress={() => onOpen(section)} style={({ pressed }) => [styles.category, index > 0 && { borderTopColor: palette.border, borderTopWidth: StyleSheet.hairlineWidth }, pressed && { backgroundColor: palette.surfaceAlt }]}>
          <View className={cn(stylesClasses.icon, "bg-surface-alt")}><MaterialCommunityIcons name={section.icon} size={22} color={palette.tint} /></View>
          <View className={cn(stylesClasses.rowText)}><Text className={cn("text-foreground")} variant="title">{section.title}</Text>
            <Text className={cn("text-muted-foreground")} variant="description">{section.summary}</Text></View>
          <Icon size={20} color={palette.muted} name={"chevron-right"}></Icon>
        </Pressable>)}
      </View>
    </View>)}
  </ScrollView>;
}

const styles = StyleSheet.create({
  content: { padding: Spacing.lg, paddingBottom: Spacing.xxl, gap: Spacing.xl, width: '100%', maxWidth: ControlSize.contentWidth, alignSelf: 'center' },
  search: { borderRadius: Shape.control, elevation: 0 },
  category: { minHeight: ControlSize.row, padding: Spacing.lg, flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  result: { minHeight: ControlSize.row, padding: Spacing.lg, flexDirection: 'row', alignItems: 'center', gap: Spacing.md, borderRadius: Shape.control, borderWidth: 1 }
});

const stylesClasses = {
  "group": "gap-md",
  "rowText": "flex-1 min-w-0 gap-xs",
  "categoryGroup": "rounded-group border overflow-hidden",
  "icon": "w-9 h-9 rounded-[10px] items-center justify-center"
} as const;
