import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { cn } from '@/shared/ui/cn';
import { Button } from '@/shared/ui/button';
import { Icon } from '@/shared/ui/icon';
import { ListRow } from '@/shared/ui/list-row';
import { Spinner } from '@/shared/ui/spinner';
import { Text } from '@/shared/ui/text';
import { childDirectory, parentDirectory } from '@/features/projects/model/project-directory';

export function ProjectDirectoryPicker({ startPath, loadDirectories, onSelect, onCancel, testID }: {
  startPath: string;
  loadDirectories: (path: string, signal?: AbortSignal) => Promise<string[]>;
  onSelect: (path: string) => void;
  onCancel: () => void;
  testID?: string;
}) {
  const { t } = useTranslation();
  const [path, setPath] = useState(startPath);
  const [entries, setEntries] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  // The caller may inline the loader; only a folder change should refetch.
  const loadRef = useRef(loadDirectories);
  useLayoutEffect(() => { loadRef.current = loadDirectories; });

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- navigating resets the loading state for the new folder.
    setLoading(true);
    setError(undefined);
    void loadRef.current(path, controller.signal)
      .then((directories) => { if (!cancelled) setEntries(directories); })
      .catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : t('project:errors.listDirectory')); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; controller.abort(); };
  }, [path, t]);

  const parent = parentDirectory(path);
  const canGoUp = parent !== path;

  return <View className={cn(stylesClasses.root)} testID={testID}>
    <View className={cn(stylesClasses.pathRow, "border-border")}>
      <Button testID="project-directory-up" disabled={!canGoUp} onPress={() => setPath(parent)} variant="ghost" size="icon" accessibilityLabel={t('project:picker.up')}>
        <Icon name="arrow-up" size={20} />
      </Button>
      <Text testID="project-directory-path" numberOfLines={2} className={cn(stylesClasses.path, "text-foreground")}>{path}</Text>
    </View>
    <Text className={cn("text-muted-foreground")}>{t('project:picker.browseHint')}</Text>
    {loading ? <View className={cn(stylesClasses.state)}><Spinner size="small" /></View> : null}
    {!loading && error ? <Text className={cn("text-destructive")}>{error}</Text> : null}
    {!loading && !error && !entries.length ? <Text className={cn("text-muted-foreground")}>{t('project:picker.browseEmpty')}</Text> : null}
    {!loading && !error ? entries.map((name) => <ListRow key={name} title={name} left={(props) => <Icon {...props} name="folder-outline" />}
      right={(props) => <Icon {...props} name="chevron-right" />}
      testID={`project-directory-entry-${name}`}
      onPress={() => setPath(childDirectory(path, name))} />) : null}
    <View className={cn(stylesClasses.actions)}>
      <Button testID="project-directory-manual" onPress={onCancel} variant="ghost"><Text>{t('project:picker.enterPathManually')}</Text></Button>
      <Button testID="project-directory-select" disabled={loading || Boolean(error)} onPress={() => onSelect(path)} variant="default"><Text>{t('project:picker.selectFolder')}</Text></Button>
    </View>
  </View>;
}

const stylesClasses = {
  "root": "gap-2.5",
  "pathRow": "flex-row items-center gap-2 border-b pb-2",
  "path": "flex-1 text-[15px] font-semibold",
  "state": "items-center py-2",
  "actions": "flex-row flex-wrap justify-end gap-2 pt-1"
} as const;
