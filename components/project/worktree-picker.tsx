import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { ActivityIndicator, Button, Divider, IconButton, List, Text } from 'react-native-paper';

import { TextInput } from '@/components/ui/text-input';
import { confirmAction } from '@/lib/confirm-action';
import { useConnection, useProjects, useProjectFiles } from '@/providers/opencode-contexts';
import { usePalette } from '@/hooks/use-palette';

export function WorktreePicker({ visible, onSelect }: { visible: boolean; onSelect: (path: string) => void }) {
  const { t } = useTranslation();
  const palette = usePalette();
  const { connection } = useConnection();
  const { activeProjectPath } = useProjects();
  const { worktrees, refreshWorktrees, createWorktree, removeWorktree } = useProjectFiles();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState<string>();
  const [menu, setMenu] = useState<string>();
  const [error, setError] = useState<string>();
  const ready = connection.status === 'connected' && Boolean(activeProjectPath);
  useEffect(() => { if (visible && ready) void refreshWorktrees(); }, [visible, ready, refreshWorktrees]);
  function remove(directory: string) {
    setMenu(undefined);
    confirmAction(t('project:worktrees.removeTitle'),
      t('project:worktrees.removeMessage', { directory }),
      t('common:actions.remove'), t('common:actions.cancel'), () => {
        setBusy(directory); setError(undefined);
        void removeWorktree(directory)
          .catch((reason) => setError(reason instanceof Error ? reason.message : t('project:errors.removeWorktree')))
          .finally(() => setBusy(undefined));
      });
  }
  if (!ready) return null;
  return <View style={{ gap: 8 }}>
    <Divider />
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      <Text variant="titleSmall" style={{ flex: 1 }}>{t('project:worktrees.groupTitle', { project: worktrees.project?.label || '' })}</Text>
      <IconButton icon="refresh" accessibilityLabel={t('project:worktrees.refresh')} disabled={worktrees.loading || Boolean(busy)} onPress={() => void refreshWorktrees()} />
    </View>
    {error || worktrees.error ? <Text accessibilityLiveRegion="polite" style={{ color: palette.danger }}>{error || worktrees.error}</Text> : null}
    {worktrees.loading ? <ActivityIndicator /> : null}
    {creating ? <View style={{ gap: 8 }}>
      <TextInput testID="project-worktree-name" mode="outlined" label={t('project:worktrees.nameLabel')} value={name} onChangeText={setName} autoCapitalize="none" autoCorrect={false} editable={!busy} />
      <View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}>
        <Button disabled={Boolean(busy)} onPress={() => setCreating(false)}>{t('common:actions.cancel')}</Button>
        <Button testID="project-worktree-create" mode="contained" loading={busy === 'create'} disabled={Boolean(busy)} onPress={() => {
          setBusy('create'); setError(undefined);
          void createWorktree(name).then(() => { setCreating(false); setName(''); })
            .catch((reason) => setError(reason instanceof Error ? reason.message : t('project:errors.createWorktree'))).finally(() => setBusy(undefined));
        }}>{t('project:worktrees.create')}</Button>
      </View>
    </View> : <>
      <Text style={{ color: palette.muted }}>{t('project:worktrees.selectGuidance')}</Text>
      {!worktrees.loading && !worktrees.error && !worktrees.entries.length ? <Text style={{ color: palette.muted }}>{t('project:worktrees.empty')}</Text> : null}
      {worktrees.entries.filter((entry) => entry.directory !== worktrees.project?.root).map((entry) => {
        const protectedDirectory = entry.directory === activeProjectPath;
        return <View key={entry.directory}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <List.Item accessibilityRole="button" style={{ flex: 1 }} title={entry.name} titleNumberOfLines={2} description={entry.branch ? `${entry.branch} · ${entry.directory}` : entry.directory} descriptionNumberOfLines={2}
              accessibilityLabel={t('project:picker.selectLabel', { name: entry.name })}
              left={(props) => <List.Icon {...props} color={protectedDirectory ? palette.tint : palette.muted} icon={protectedDirectory ? 'check-circle' : 'source-branch'} />}
              disabled={Boolean(busy)} onPress={() => onSelect(entry.directory)} />
            <IconButton icon="dots-vertical" accessibilityLabel={t('project:worktrees.manage', { name: entry.name })} accessibilityState={{ expanded: menu === entry.directory }}
              disabled={protectedDirectory || Boolean(busy)} onPress={() => setMenu(menu === entry.directory ? undefined : entry.directory)} />
          </View>
          {menu === entry.directory ? <View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}>
            <Button textColor={palette.danger} onPress={() => remove(entry.directory)}>{t('common:actions.remove')}</Button>
          </View> : null}
          <Divider />
        </View>;
      })}
      <Button testID="project-worktree-add" icon="plus" mode="outlined" disabled={Boolean(busy) || worktrees.loading} onPress={() => { setCreating(true); setError(undefined); }}>{t('project:worktrees.create')}</Button>
    </>}
  </View>;
}
