import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text as NativeText, View } from 'react-native';
import { Button, Text } from 'react-native-paper';

import { WorkspaceSelect } from '@/components/ui/workspace-select';
import { useWorkspaces } from '@/providers/workspace-context';
import { useWorkspaceProjects } from '@/providers/use-workspace-projects';
import { ProjectOptions } from '@/components/onboarding/project-options';
import type { WorkspaceTarget } from '@/providers/workspace-types';
import { OverlaySheet } from './overlay-sheet';
import { TextInput } from './text-input';
import { usePalette } from '@/hooks/use-palette';

export function ProjectPickerButton({ onPress }: { onPress: () => void }) {
  const { t } = useTranslation();
  const palette = usePalette();
  return <Pressable testID="chat-library-project-button" accessibilityRole="button" accessibilityLabel={t('project:picker.changeProject')} onPress={onPress} style={styles.button}>
    <MaterialCommunityIcons name="folder-swap-outline" size={20} color={palette.tint} />
    <NativeText style={{ color: palette.tint }}>{t('common:tabs.projects')}</NativeText>
  </Pressable>;
}

export function ProjectPicker({ visible, onClose, activePath, onSelected, testID }: {
  visible: boolean;
  onClose: () => void;
  activePath?: string;
  onSelected?: () => void;
  testID?: string;
}) {
  const { t } = useTranslation();
  const palette = usePalette();
  const registry = useWorkspaces();
  const { groups, add, remove } = useWorkspaceProjects();
  const multipleServers = groups.length > 1;
  const [server, setServer] = useState('');
  const [query, setQuery] = useState('');
  const [addServer, setAddServer] = useState('');
  const [adding, setAdding] = useState(false);
  const [directory, setDirectory] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const focusConnectionId = groups.some((group) => group.id === registry.focus?.connectionId)
    ? registry.focus?.connectionId ?? ''
    : groups[0]?.id ?? '';
  const addTarget = multipleServers ? addServer : groups[0]?.id;
  const close = () => { setAdding(false); setDirectory(''); setError(undefined); onClose(); };
  const activate = async (target: WorkspaceTarget) => {
    await registry.activate(target);
    onSelected?.();
    close();
  };
  return <OverlaySheet visible={visible} title={t('project:picker.title')} testID={testID} onClose={close}>
    {adding ? <View style={styles.addForm}>
      <Text style={{ color: palette.muted }}>{t('project:picker.enterPath')}</Text>
      {multipleServers ? <WorkspaceSelect title={t('common:servers.server')} value={addServer} options={groups.map((group) => ({ value: group.id, label: group.name }))} onChange={setAddServer} /> : null}
      <TextInput testID="project-add-path" mode="outlined" label={t('project:picker.serverDirectory')} value={directory} onChangeText={setDirectory} autoCapitalize="none" autoCorrect={false} />
      {error ? <Text style={{ color: palette.danger }}>{error}</Text> : null}
      <View style={styles.formActions}>
        <Button disabled={saving} onPress={() => { setAdding(false); setError(undefined); }}>{t('common:actions.cancel')}</Button>
        <Button testID="project-add-submit" mode="contained" loading={saving} disabled={saving || !directory.trim() || !addTarget} onPress={() => {
          if (!addTarget) return;
          setSaving(true); setError(undefined);
          void add(addTarget, directory).then(activate).catch((reason) => setError(reason instanceof Error ? reason.message : t('project:errors.addProject'))).finally(() => setSaving(false));
        }}>{t('project:picker.add')}</Button>
      </View>
    </View> : <>
    <TextInput testID="project-search" mode="outlined" label={t('common:servers.searchProjects')} placeholder={t('common:servers.searchProjects')} value={query} onChangeText={setQuery} />
    {multipleServers ? <WorkspaceSelect title={t('common:servers.allServers')} value={server} options={[{ value: '', label: t('common:servers.allServers') }, ...groups.map((group) => ({ value: group.id, label: group.name }))]} onChange={setServer} /> : null}
    {!groups.length ? <Text style={{ color: palette.muted }}>{t('project:picker.empty')}</Text> : null}
    {groups.filter((group) => !multipleServers || !server || server === group.id).map((group) => <View key={group.id} style={{ gap: 10 }}>
      {multipleServers ? <Text variant="titleMedium">{group.name}</Text> : null}
      <ProjectOptions projects={group.projects.filter((project) => `${project.label} ${project.path}`.toLowerCase().includes(query.trim().toLowerCase()))}
        activePath={registry.focus?.connectionId === group.id ? group.projects.find((project) => project.checkouts.some((checkout) => checkout.directory === activePath))?.path : undefined}
        onSelect={(path) => { void activate({ connectionId: group.id, projectPath: path }).catch((reason) => setError(String(reason))); }}
        onRemove={(path) => { void remove({ connectionId: group.id, projectPath: path }).catch((reason) => setError(String(reason))); }} />
    </View>)}
    {error ? <Text style={{ color: palette.danger }}>{error}</Text> : null}
    <Button testID="project-add-button" icon="plus" disabled={!groups.length} onPress={() => { setAddServer(server || focusConnectionId); setAdding(true); }}>{t('project:picker.add')}</Button>
    </>}
  </OverlaySheet>;
}

const styles = StyleSheet.create({
  button: { flexDirection: 'row', alignItems: 'center', gap: 5, minHeight: 44, paddingHorizontal: 6 },
  addForm: { gap: 12 },
  formActions: { flexDirection: 'row', justifyContent: 'flex-end', flexWrap: 'wrap', gap: 8 },
});
