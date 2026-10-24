import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { FlashList } from '@shopify/flash-list';
import { useTranslation } from 'react-i18next';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { ActivityIndicator, Button, Divider, List, Text, TextInput as PaperTextInput } from 'react-native-paper';

import { TextInput } from '@/components/ui/text-input';
import type { File } from '@/lib/opencode/types';
import type { ProjectFilesContextValue } from '@/providers/opencode-provider-types';
import { usePalette } from '@/hooks/use-palette';

export function FilesPanel({ statuses, browser, projectLabel, onOpen, header, contentStyle }: {
  header?: ReactNode;
  contentStyle?: StyleProp<ViewStyle>;
  statuses: File[];
  browser: ProjectFilesContextValue['browser'];
  projectLabel: string;
  onOpen: (path: string) => void;
}) {
  const { t } = useTranslation();
  const palette = usePalette();
  const [query, setQuery] = useState(browser.query || '');
  const { initialized, openDirectory } = browser;
  useEffect(() => { if (!initialized) void openDirectory(''); }, [initialized, openDirectory]);
  const busy = browser.loading || browser.searching;
  const crumbs = browser.path ? browser.path.split('/') : [];
  const search = () => { if (query.trim() && !busy) void browser.search(query); };
  const entries = useMemo(() => browser.query ? browser.results.map((path) => ({ path, name: path, type: 'file' as const })) : browser.entries, [browser.query, browser.results, browser.entries]);

  const listHeader = <View style={{ gap: 12 }}>
    {header}
    <TextInput testID="project-file-search" mode="outlined" dense
      accessibilityLabel={t('project:files.searchPlaceholder')}
      placeholder={t('project:files.searchPlaceholder')} value={query} onChangeText={(value) => {
        setQuery(value);
        if (!value.trim()) void browser.search('');
      }} autoCapitalize="none" autoCorrect={false} returnKeyType="search" blurOnSubmit
      onSubmitEditing={search}
      left={query ? <PaperTextInput.Icon icon="close" accessibilityLabel={t('project:files.clearSearch')} onPress={() => { setQuery(''); void browser.search(''); }} /> : undefined}
      right={<PaperTextInput.Icon icon="magnify" accessibilityLabel={t('project:files.search')} disabled={busy || !query.trim()} onPress={search} />} />
    <Text style={{ color: palette.muted }}>{t('project:files.searchScope', { project: projectLabel })}</Text>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' }}>
      <Button compact icon="folder-outline" onPress={() => { setQuery(''); void openDirectory(''); }}>{projectLabel}</Button>
      {crumbs.map((crumb, index) => <View key={index} style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Text style={{ color: palette.muted }}>›</Text>
        <Button compact onPress={() => { setQuery(''); void openDirectory(crumbs.slice(0, index + 1).join('/')); }}>{crumb}</Button>
      </View>)}
    </View>
    {busy ? <ActivityIndicator accessibilityLabel={t('project:files.loading')} /> : null}
    <Text accessibilityLiveRegion="polite" style={{ color: browser.error ? palette.danger : palette.muted }}>
      {browser.error || (browser.searching ? t('project:files.searching') : browser.query ? entries.length ? t('project:files.resultsFor', { query: browser.query }) : t('project:files.noMatches', { query: browser.query }) : !browser.loading && initialized && !entries.length ? t('project:files.emptyFolder') : '')}
    </Text>
    {browser.error ? <Button onPress={() => { if (browser.query) void browser.search(browser.query); else void openDirectory(browser.path); }}>{t('common:actions.retry')}</Button> : null}
  </View>;
  const rows = useMemo(() => [
    ...(!busy && !browser.error ? entries.map((entry) => ({ kind: 'entry' as const, entry })) : []),
    ...(statuses.length ? [{ kind: 'heading' as const }] : []),
    ...statuses.map((file) => ({ kind: 'changed' as const, file })),
  ], [browser.error, busy, entries, statuses]);
  return <FlashList style={{ flex: 1, backgroundColor: palette.background }} contentContainerStyle={contentStyle}
    data={rows} ListHeaderComponent={listHeader} keyboardDismissMode="on-drag" keyboardShouldPersistTaps="handled"
    maintainVisibleContentPosition={{ disabled: true }}
    keyExtractor={(row) => row.kind === 'entry' ? `entry:${row.entry.path}` : row.kind === 'changed' ? `changed:${row.file.path}` : 'changed-heading'}
    getItemType={(row) => row.kind} renderItem={({ item }) => {
      if (item.kind === 'heading') return <Text variant="titleSmall" style={{ marginVertical: 12 }}>{t('project:files.changedFiles', { value: statuses.length })}</Text>;
      if (item.kind === 'changed') {
        const file = item.file;
        return <List.Item title={file.path} description={file.status === 'deleted' ? `${t('project:files.deleted')} · ${t('project:files.deletedUnavailable')}` : t(`project:files.${file.status}`)}
          accessibilityRole="button" accessibilityState={{ disabled: file.status === 'deleted' }}
          descriptionNumberOfLines={3} disabled={file.status === 'deleted'}
          onPress={file.status === 'deleted' ? undefined : () => onOpen(file.path)} />;
      }
      const entry = item.entry;
      return <View>
        <List.Item accessibilityRole="button" testID={`project-entry-${entry.path}`} title={entry.name} titleNumberOfLines={2}
          accessibilityLabel={t(entry.type === 'directory' ? 'project:files.openFolder' : 'project:files.openFile', { path: entry.path })}
          left={(props) => <List.Icon {...props} color={entry.type === 'directory' ? palette.tint : palette.muted} icon={entry.type === 'directory' ? 'folder-outline' : 'file-document-outline'} />}
          right={entry.type === 'directory' ? (props) => <List.Icon {...props} icon="chevron-right" /> : undefined}
          onPress={() => { if (entry.type === 'directory') { setQuery(''); void openDirectory(entry.path); } else onOpen(entry.path); }} />
        <Divider />
      </View>;
    }} />;
}
