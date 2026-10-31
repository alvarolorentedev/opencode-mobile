import { cn } from '@/shared/ui/cn';
import { TextField } from '@/shared/ui/text-field';
import { Button } from '@/shared/ui/button';
import { Icon } from '@/shared/ui/icon';
import { Text } from '@/shared/ui/text';
import { Spinner } from '@/shared/ui/spinner';
import { ListRow } from '@/shared/ui/list-row';
import { Separator } from '@/shared/ui/separator';
import { Feedback } from '@/shared/ui/feedback';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { FlashList } from '@shopify/flash-list';
import { useTranslation } from 'react-i18next';
import { View, type StyleProp, type ViewStyle } from 'react-native';

import { SwipeRow } from '@/shared/ui/swipe-row';
import { EntryActionSheet } from '@/features/projects/ui/entry-action-sheet';
import { FileClipboardStrip } from '@/features/projects/ui/file-clipboard-strip';
import { useConfirmation } from '@/shared/ui/use-confirmation';
import { longPressHaptic } from '@/shared/platform/haptics';
import type { ProjectFileEntry } from '@/shared/protocol/opencode/project';

import type { File } from '@/shared/protocol/opencode/types';
import type { ProjectFilesContextValue } from '@/features/projects/model/types';
import { usePalette } from '@/shared/ui/theme/use-palette';

export function FilesPanel({ statuses, browser, projectLabel, onOpen, header, contentStyle }: {
  header?: ReactNode;
  contentStyle?: StyleProp<ViewStyle>;
  statuses: File[];
  browser: ProjectFilesContextValue['browser'];
  projectLabel: string;
  onOpen: (path: string) => void;
}) {
  const { confirmAction, confirmation } = useConfirmation();
  const { t } = useTranslation();
  const palette = usePalette();
  const [query, setQuery] = useState(browser.query || '');
  const { initialized, openDirectory, actions } = browser;
  const [selection, setSelection] = useState<{ entry: ProjectFileEntry; mode: 'actions' | 'rename' }>();
  const probe = actions?.probe;
  useEffect(() => { if (probe) void probe(); }, [probe]);
  const show = (entry: ProjectFileEntry, mode: 'actions' | 'rename') => {
    actions?.clearFeedback(); setSelection({ entry, mode });
  };
  async function paste(path: string) {
    const expected = await actions.inspectPaste(path);
    if (!expected) return;
    const run = () => { void actions.paste(path, expected).then((ok) => { if (ok) setSelection(undefined); }); };
    if (expected === 'missing') run();
    else confirmAction(t('project:files.actions.replaceTitle'), t('project:files.actions.replaceMessage', { name: actions.clipboard?.path.split('/').pop() }),
      t('project:files.actions.replace'), t('common:actions.cancel'), run);
  }
  useEffect(() => { if (!initialized) void openDirectory(''); }, [initialized, openDirectory]);
  const busy = browser.loading || browser.searching;
  const crumbs = browser.path ? browser.path.split('/') : [];
  const search = () => { if (query.trim() && !busy) void browser.search(query); };
  const entries = useMemo(() => browser.query ? browser.results.map((path) => ({ path, name: path, type: 'file' as const })) : browser.entries, [browser.query, browser.results, browser.entries]);

  const listHeader = <View className={cn("gap-3")}>
    {header}
    <TextField testID="project-file-search" accessibilityLabel={t('project:files.searchPlaceholder')} placeholder={t('project:files.searchPlaceholder')} value={query} onChangeText={(value) => {
        setQuery(value);
        if (!value.trim()) void browser.search('');
      }} autoCapitalize="none" autoCorrect={false} returnKeyType="search" blurOnSubmit onSubmitEditing={search} endAdornment={<Button accessibilityLabel={t('project:files.search')} disabled={busy || !query.trim()} onPress={search} variant={"ghost"} size="icon"><Icon name={"magnify"} size={24} /></Button>} startAdornment={query ? <Button accessibilityLabel={t('project:files.clearSearch')} onPress={() => { setQuery(''); void browser.search(''); }} variant={"ghost"} size="icon"><Icon name={"close"} size={24} /></Button> : undefined}></TextField>
    <Text className={cn("text-muted-foreground")}>{t('project:files.searchScope', { project: projectLabel })}</Text>
    <View className={cn("flex-row flex-wrap items-center")}>
      <Button onPress={() => { setQuery(''); void openDirectory(''); }} variant={"ghost"}><Icon name={"folder-outline"} size={20} /><Text>{projectLabel}</Text></Button>
      {crumbs.map((crumb, index) => <View key={index} className={cn("flex-row items-center")}>
        <Text className={cn("text-muted-foreground")}>›</Text>
        <Button onPress={() => { setQuery(''); void openDirectory(crumbs.slice(0, index + 1).join('/')); }} variant={"ghost"}><Text>{crumb}</Text></Button>
      </View>)}
    </View>
    {actions?.clipboard ? <FileClipboardStrip entry={actions.clipboard} busy={actions.busy} available={actions.available} onPaste={() => void paste(browser.path)} onClear={actions.clear} /> : null}
    {actions ? <Text className={cn("text-muted-foreground")}>{t('project:files.actions.swipeHint')}</Text> : null}
    {actions?.error ? <Text accessibilityRole="alert" className={cn("text-destructive")}>{actions.error}</Text> : null}
    {busy ? <Spinner accessibilityLabel={t('project:files.loading')} /> : null}
    <Text accessibilityLiveRegion="polite" style={{ color: browser.error ? palette.danger : palette.muted }}>{browser.error || (browser.searching ? t('project:files.searching') : browser.query ? entries.length ? t('project:files.resultsFor', { query: browser.query }) : t('project:files.noMatches', { query: browser.query }) : !browser.loading && initialized && !entries.length ? t('project:files.emptyFolder') : '')}</Text>
    {browser.error ? <Button onPress={() => { if (browser.query) void browser.search(browser.query); else void openDirectory(browser.path); }} variant={"ghost"}><Text>{t('common:actions.retry')}</Text></Button> : null}
  </View>;
  const rows = useMemo(() => [
    ...(!busy && !browser.error ? entries.map((entry) => ({ kind: 'entry' as const, entry })) : []),
    ...(statuses.length ? [{ kind: 'heading' as const }] : []),
    ...statuses.map((file) => ({ kind: 'changed' as const, file })),
  ], [browser.error, busy, entries, statuses]);
  return <>{confirmation}{<><FlashList style={{ flex: 1, backgroundColor: palette.background }} contentContainerStyle={contentStyle}
    data={rows} extraData={actions} ListHeaderComponent={listHeader} keyboardDismissMode="on-drag" keyboardShouldPersistTaps="handled"
    maintainVisibleContentPosition={{ disabled: true }}
    keyExtractor={(row) => row.kind === 'entry' ? `entry:${row.entry.path}` : row.kind === 'changed' ? `changed:${row.file.path}` : 'changed-heading'}
    getItemType={(row) => row.kind} renderItem={({ item }) => {
      if (item.kind === 'heading') return <Text style={{ marginVertical: 12 }} variant="description">{t('project:files.changedFiles', { value: statuses.length })}</Text>;
      if (item.kind === 'changed') {
        const file = item.file;
        return <ListRow title={file.path} description={file.status === 'deleted' ? `${t('project:files.deleted')} · ${t('project:files.deletedUnavailable')}` : t(`project:files.${file.status}`)} accessibilityRole="button" accessibilityState={{ disabled: file.status === 'deleted' }} disabled={file.status === 'deleted'} onPress={file.status === 'deleted' ? undefined : () => onOpen(file.path)}></ListRow>;
      }
      const entry = item.entry;
      return <View>
        <SwipeRow key={entry.path} title={entry.name} actions={actions ? [
          { label: t('project:files.actions.copyPath'), icon: 'link-variant', disabled: actions.busy, onPress: () => void actions.copyPath(entry), testID: `project-entry-copy-path-${entry.path}` },
          { label: t('project:files.actions.rename'), icon: 'pencil-outline', disabled: actions.busy || !actions.available, onPress: () => show(entry, 'rename'), testID: `project-entry-rename-${entry.path}` },
          { label: t('project:files.actions.more'), icon: 'dots-horizontal', disabled: actions.busy, onPress: () => show(entry, 'actions'), testID: `project-entry-more-${entry.path}` },
        ] : []}>
        <ListRow accessibilityRole="button" testID={`project-entry-${entry.path}`} title={entry.name} accessibilityLabel={t(entry.type === 'directory' ? 'project:files.openFolder' : 'project:files.openFile', { path: entry.path })} accessibilityHint={t('project:files.actions.swipeHint')} accessibilityActions={[{ name: 'longpress', label: t('project:files.actions.more') }]} onAccessibilityAction={() => show(entry, 'actions')} onLongPress={() => { longPressHaptic(); show(entry, 'actions'); }} left={(props) => <Icon {...props} color={entry.type === 'directory' ? palette.tint : palette.muted} name={entry.type === 'directory' ? 'folder-outline' : 'file-document-outline'}></Icon>} right={entry.type === 'directory' ? (props) => <Icon {...props} name={"chevron-right"}></Icon> : undefined} onPress={() => { if (entry.type === 'directory') { setQuery(''); void openDirectory(entry.path); } else onOpen(entry.path); }}></ListRow>
        </SwipeRow>
        <Separator></Separator>
      </View>;
    }} />
    <Feedback duration={2500} open={Boolean(actions?.notice)} onOpenChange={() => (() => actions?.clearFeedback())()}>{actions?.notice || ''}</Feedback>
    {selection && actions ? <EntryActionSheet key={`${selection.entry.path}:${selection.mode}`} entry={selection.entry} mode={selection.mode} projectLabel={projectLabel}
      busy={actions.busy} available={actions.available} reason={actions.reason} error={actions.error} canPaste={Boolean(actions.clipboard)}
      onClose={() => setSelection(undefined)}
      onCopyPath={() => { void actions.copyPath(selection.entry); setSelection(undefined); }}
      onRename={(name) => { if (name === undefined) show(selection.entry, 'rename'); else void actions.rename(selection.entry, name).then((ok) => { if (ok) setSelection(undefined); }); }}
      onSelect={(mode) => { actions.select(selection.entry, mode); setSelection(undefined); }} onPaste={() => void paste(selection.entry.path)} /> : null}
  </>}</>;
}
