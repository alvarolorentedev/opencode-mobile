import { cn } from '@/lib/utils';
import { Text } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { Icon } from '@/components/ui/icon';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, Text as NativeText, View } from 'react-native';


import { WorkspaceSelect } from '@/components/ui/workspace-select';
import { useWorkspaces } from '@/providers/workspace-context';
import { useWorkspaceProjects } from '@/providers/use-workspace-projects';
import { ProjectOptions } from '@/components/onboarding/project-options';
import type { WorkspaceTarget } from '@/providers/workspace-types';
import { OverlaySheet } from './overlay-sheet';

import { usePalette } from '@/hooks/use-palette';

export function ProjectPickerButton({ onPress }: { onPress: () => void }) {
  const { t } = useTranslation();
  const palette = usePalette();
  return <Pressable testID="chat-library-project-button" accessibilityRole="button" accessibilityLabel={t('project:picker.changeProject')} onPress={onPress} className={cn(stylesClasses.button)}>
    <MaterialCommunityIcons name="folder-swap-outline" size={20} color={palette.tint} />
    <NativeText className={cn("text-primary")}>{t('common:tabs.projects')}</NativeText>
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
    {adding ? <View className={cn(stylesClasses.addForm)}>
      <Text className={cn("text-muted-foreground")}>{t('project:picker.enterPath')}</Text>
      {multipleServers ? <WorkspaceSelect title={t('common:servers.server')} value={addServer} options={groups.map((group) => ({ value: group.id, label: group.name }))} onChange={setAddServer} /> : null}
      <TextField testID="project-add-path" label={t('project:picker.serverDirectory')} value={directory} onChangeText={setDirectory} autoCapitalize="none" autoCorrect={false}></TextField>
      {error ? <Text className={cn("text-destructive")}>{error}</Text> : null}
      <View className={cn(stylesClasses.formActions)}>
        <Button disabled={saving} onPress={() => { setAdding(false); setError(undefined); }} variant="ghost"><Text>{t('common:actions.cancel')}</Text></Button>
        <Button testID="project-add-submit" disabled={saving || !directory.trim() || !addTarget} onPress={() => {
          if (!addTarget) return;
          setSaving(true); setError(undefined);
          void add(addTarget, directory).then(activate).catch((reason) => setError(reason instanceof Error ? reason.message : t('project:errors.addProject'))).finally(() => setSaving(false));
        }} variant="default">{saving ? <Spinner size="small" /> : null}<Text>{t('project:picker.add')}</Text></Button>
      </View>
    </View> : <>
    <TextField testID="project-search" label={t('common:servers.searchProjects')} placeholder={t('common:servers.searchProjects')} value={query} onChangeText={setQuery}></TextField>
    {multipleServers ? <WorkspaceSelect title={t('common:servers.allServers')} value={server} options={[{ value: '', label: t('common:servers.allServers') }, ...groups.map((group) => ({ value: group.id, label: group.name }))]} onChange={setServer} /> : null}
    {!groups.length ? <Text className={cn("text-muted-foreground")}>{t('project:picker.empty')}</Text> : null}
    {groups.filter((group) => !multipleServers || !server || server === group.id).map((group) => <View key={group.id} className={cn("gap-2.5")}>
      {multipleServers ? <Text  variant="title">{group.name}</Text> : null}
      <ProjectOptions projects={group.projects.filter((project) => `${project.label} ${project.path}`.toLowerCase().includes(query.trim().toLowerCase()))}
        activePath={registry.focus?.connectionId === group.id ? group.projects.find((project) => project.checkouts.some((checkout) => checkout.directory === activePath))?.path : undefined}
        onSelect={(path) => { void activate({ connectionId: group.id, projectPath: path }).catch((reason) => setError(String(reason))); }}
        onRemove={(path) => { void remove({ connectionId: group.id, projectPath: path }).catch((reason) => setError(String(reason))); }} />
    </View>)}
    {error ? <Text className={cn("text-destructive")}>{error}</Text> : null}
    <Button testID="project-add-button" disabled={!groups.length} onPress={() => { setAddServer(server || focusConnectionId); setAdding(true); }} variant="ghost"><Icon name={"plus"} size={20} /><Text>{t('project:picker.add')}</Text></Button>
    </>}
  </OverlaySheet>;
}



const stylesClasses = {
  "button": "flex-row items-center gap-1.25 min-h-11 px-1.5",
  "addForm": "gap-3",
  "formActions": "flex-row justify-end flex-wrap gap-2"
} as const;
