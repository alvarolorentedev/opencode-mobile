import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';

import { cn } from '@/shared/ui/cn';
import { Button } from '@/shared/ui/button';
import { Icon } from '@/shared/ui/icon';
import { ListRow } from '@/shared/ui/list-row';
import { Spinner } from '@/shared/ui/spinner';
import { Text } from '@/shared/ui/text';
import { TextField } from '@/shared/ui/text-field';
import { childDirectory, parentDirectory } from '@/features/projects/model/project-directory';

export function ProjectDirectoryPicker({ startPath, loadDirectories, onConfirm, busy = false, scrollable = true, testID }: {
  startPath: string;
  loadDirectories: (path: string, signal?: AbortSignal) => Promise<string[]>;
  onConfirm: (path: string) => void;
  busy?: boolean;
  scrollable?: boolean;
  testID?: string;
}) {
  const { t } = useTranslation();
  const [path, setPath] = useState(startPath);
  // Typing only changes the field; the list follows an explicit navigation.
  const [browsePath, setBrowsePath] = useState(startPath.trim());
  const [entries, setEntries] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  // The caller may inline the loader; only a folder change should refetch.
  const loadRef = useRef(loadDirectories);
  useLayoutEffect(() => { loadRef.current = loadDirectories; });

  useEffect(() => {
    if (!browsePath) return;
    const controller = new AbortController();
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- navigating resets the loading state for the new folder.
    setLoading(true);
    setError(undefined);
    void loadRef.current(browsePath, controller.signal)
      .then((directories) => { if (!cancelled) setEntries(directories); })
      .catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : t('project:errors.listDirectory')); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; controller.abort(); };
  }, [browsePath, t]);

  const parent = parentDirectory(path);
  const canGoUp = Boolean(path.trim()) && parent !== path;
  // A typed path is not listed until Enter, so never show another folder's entries.
  const listing = path.trim() === browsePath;
  const navigate = (next: string) => { setPath(next); setBrowsePath(next); };
  const confirm = () => { const value = path.trim(); if (value && !busy) onConfirm(value); };

  const list = <>
    {browsePath && listing ? <Text className={cn("text-muted-foreground")}>{t('project:picker.browseHint')}</Text> : null}
    {!listing ? null : <>
      {loading ? <View className={cn(stylesClasses.state)}><Spinner size="small" /></View> : null}
      {!loading && error ? <Text className={cn("text-destructive")}>{error}</Text> : null}
      {!loading && !error && browsePath && !entries.length ? <Text className={cn("text-muted-foreground")}>{t('project:picker.browseEmpty')}</Text> : null}
      {!loading && !error ? entries.map((name) => <ListRow key={name} title={name} left={(props) => <Icon {...props} name="folder-outline" />}
        right={(props) => <Icon {...props} name="chevron-right" />}
        testID={`project-directory-entry-${name}`}
        onPress={() => navigate(childDirectory(browsePath, name))} />) : null}
    </>}
  </>;

  return <View className={cn(stylesClasses.root, scrollable && "flex-1")} testID={testID}>
    <View className={cn(stylesClasses.pathRow, "border-border")}>
      <Button testID="project-directory-up" disabled={!canGoUp} onPress={() => navigate(parent)} variant="ghost" size="icon" accessibilityLabel={t('project:picker.up')}>
        <Icon name="arrow-up" size={20} />
      </Button>
      <TextField testID="project-directory-path" className={cn("flex-1")} value={path}
        onChangeText={setPath}
        onSubmitEditing={() => { const next = path.trim(); if (next) setBrowsePath(next); }}
        placeholder={t('project:picker.serverDirectory')} accessibilityLabel={t('project:picker.serverDirectory')}
        autoCapitalize="none" autoCorrect={false} returnKeyType="go"
        endAdornment={<Button testID="project-directory-add" disabled={!path.trim() || busy} onPress={confirm} variant="default" size="icon" accessibilityLabel={t('project:picker.add')}>
          {busy ? <Spinner size="small" /> : <Icon name="check" size={20} />}
        </Button>} />
    </View>
    {scrollable
      ? <ScrollView className={cn("flex-1")} contentContainerStyle={{ gap: 10 }} keyboardShouldPersistTaps="handled">{list}</ScrollView>
      : list}
  </View>;
}

const stylesClasses = {
  "root": "gap-2.5",
  "pathRow": "flex-row items-center gap-2 border-b pb-2",
  "state": "items-center py-2"
} as const;
