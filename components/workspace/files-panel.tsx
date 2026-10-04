import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { Button, List, Text } from 'react-native-paper';

import { TextInput } from '@/components/ui/text-input';
import { usePalette } from '@/providers/theme-provider';
import type { File } from '@/lib/opencode/types';

/** Search presentation is reset by the screen's connection/workspace key. Results stay provider-owned. */
export function FilesPanel({ statuses, files, onSearch, onOpen }: {
  statuses: File[];
  files: string[];
  onSearch: (query: string) => Promise<void>;
  onOpen: (path: string) => void;
}) {
  const { t } = useTranslation();
  const palette = usePalette();
  const [query, setQuery] = useState('');
  const [submittedQuery, setSubmittedQuery] = useState<string>();
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string>();
  const inFlight = useRef(false);

  async function search(submittedValue = query) {
    const value = submittedValue.trim();
    if (!value || inFlight.current) return;
    inFlight.current = true;
    setSearching(true);
    setError(undefined);
    setSubmittedQuery(value);
    try {
      await onSearch(value);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('workspace:errors.searchFiles'));
    } finally {
      inFlight.current = false;
      setSearching(false);
    }
  }

  return <View style={{ gap: 12 }}>
    {statuses.map((file) => <List.Item key={file.path}
      title={file.path}
      titleNumberOfLines={2}
      description={file.status === 'deleted' ? `${t('workspace:files.deleted')} · ${t('workspace:files.deletedUnavailable')}` : t(`workspace:files.${file.status}`)}
      descriptionNumberOfLines={3}
      accessibilityLabel={`${file.path}. ${t(`workspace:files.${file.status}`)}${file.status === 'deleted' ? `. ${t('workspace:files.deletedUnavailable')}` : ''}`}
      disabled={file.status === 'deleted'}
      onPress={file.status === 'deleted' ? undefined : () => onOpen(file.path)}
    />)}
    <TextInput testID="workspace-file-search" mode="outlined" dense
      placeholder={t('workspace:files.searchPlaceholder')} value={query} onChangeText={setQuery}
      editable={!searching} returnKeyType="search" blurOnSubmit onSubmitEditing={(event) => void search(event.nativeEvent.text)} />
    <Button mode="contained" loading={searching} disabled={!query.trim() || searching} onPress={() => void search()}>{t('workspace:files.search')}</Button>
    <Text accessibilityLiveRegion="polite" style={{ color: error ? palette.danger : palette.muted }}>
      {error || (searching ? t('workspace:files.searching') : submittedQuery === undefined ? t('workspace:files.searchGuidance') : files.length === 0 ? t('workspace:files.noMatches', { query: submittedQuery }) : t('workspace:files.resultsFor', { query: submittedQuery }))}
    </Text>
    {!searching && !error && submittedQuery !== undefined ? files.map((path) => <List.Item key={path} title={path} titleNumberOfLines={2} onPress={() => onOpen(path)} />) : null}
  </View>;
}
