import { cn } from '@/shared/ui/cn';
import { Text } from '@/shared/ui/text';
import { TextField } from '@/shared/ui/text-field';
import { Button } from '@/shared/ui/button';
import { Icon } from '@/shared/ui/icon';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, Text as NativeText, View } from 'react-native';

import { WorkspaceSelect } from '@/shared/ui/workspace-select';
import { useWorkspaces } from '@/runtime/workspace';
import { getConnectionScope } from '@/shared/contracts/connection-scope';
import { useWorkspaceProjects } from '@/features/projects/state/use-workspace-projects';
import { splitHiddenProjects } from '@/features/projects/model/hidden-projects';
import { ProjectOptions } from '@/features/projects/ui/project-options';
import { ArchivedProjectsSection } from '@/features/projects/ui/archived-projects-section';
import { ProjectDirectoryPicker } from '@/features/projects/ui/project-directory-picker';
import type { WorkspaceTarget } from '@/shared/contracts/workspace';
import { OverlaySheet } from '@/shared/ui/overlay-sheet';
import { Switch } from '@/shared/ui/switch';
import { ListRow } from '@/shared/ui/list-row';

import { usePalette } from '@/shared/ui/theme/use-palette';

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
  const palette = usePalette();
  const { groups, add, listDirectories } = useWorkspaceProjects();
  // One stable location per add session. The first listed path seeds it when
  // no project exists yet, so later navigation stays on the same location.
  const browseBase = useRef({ connectionId: '', path: '' });
  const multipleServers = groups.length > 1;
  const [server, setServer] = useState('');
  const [query, setQuery] = useState('');
  const [addServer, setAddServer] = useState('');
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [error, setError] = useState<string>();
  const focusConnectionId = groups.some((group) => group.id === registry.focus?.connectionId)
    ? registry.focus?.connectionId ?? ''
    : groups[0]?.id ?? '';
  const addTarget = multipleServers ? addServer : groups[0]?.id;
  const startPath = activePath || groups.find((group) => group.id === addTarget)?.projects[0]?.path;
  const close = () => { setAdding(false); setShowArchived(false); setError(undefined); onClose(); };
  const visibleGroups = groups.filter((group) => !multipleServers || !server || server === group.id);
  // Device-local archive works on every contract; the server-archived read is V2-only.
  const archivedCapable = visibleGroups.length > 0;
  const activate = async (target: WorkspaceTarget) => {
    await registry.activate(target);
    onSelected?.();
    close();
  };
  const matches = (path: string, label: string) => `${label} ${path}`.toLowerCase().includes(query.trim().toLowerCase());
  const hiddenPathsFor = (connectionId: string) => {
    const entry = registry.connections.find((connection) => connection.id === connectionId);
    return entry ? registry.hiddenProjects[getConnectionScope(entry.settings)] ?? [] : [];
  };
  const hiddenRows = visibleGroups.flatMap((group) => splitHiddenProjects(group.projects, hiddenPathsFor(group.id)).hidden
    .map((project) => ({ group, project })));
  const filteredHiddenRows = query.trim() ? hiddenRows.filter(({ project }) => matches(project.path, project.label)) : hiddenRows;
  return <OverlaySheet visible={visible} title={t('project:picker.title')} testID={testID} onClose={close} scrollable={false}>
    {adding ? <View className={cn(stylesClasses.addForm, "flex-1")}>
      {multipleServers ? <WorkspaceSelect title={t('common:servers.server')} value={addServer} options={groups.map((group) => ({ value: group.id, label: group.name }))} onChange={setAddServer} /> : null}
      {addTarget ? <ProjectDirectoryPicker key={`${addTarget}:${startPath}`} startPath={startPath ?? ''} testID="project-directory-picker"
        loadDirectories={(path, signal) => {
          if (browseBase.current.connectionId !== addTarget) browseBase.current = { connectionId: addTarget, path: '' };
          browseBase.current.path ||= path;
          return listDirectories(addTarget, browseBase.current.path, path, signal);
        }}
        onConfirm={(path) => {
          setSaving(true); setError(undefined);
          void add(addTarget, path).then(activate).catch((reason) => setError(reason instanceof Error ? reason.message : t('project:errors.addProject'))).finally(() => setSaving(false));
        }}
        busy={saving} /> : null}
      {error ? <Text className={cn("text-destructive")}>{error}</Text> : null}
    </View> : <>
    <TextField testID="project-search" label={t('common:servers.searchProjects')} placeholder={t('common:servers.searchProjects')} value={query} onChangeText={setQuery}></TextField>
    {multipleServers ? <WorkspaceSelect title={t('common:servers.allServers')} value={server} options={[{ value: '', label: t('common:servers.allServers') }, ...groups.map((group) => ({ value: group.id, label: group.name }))]} onChange={setServer} /> : null}
    {archivedCapable ? <View className={cn(stylesClasses.archivedToggle)}>
      <View className={cn(stylesClasses.archivedToggleText)}>
        <Text>{t('project:picker.showArchived')}</Text>
        <Text className={cn("text-muted-foreground")}>{t('project:picker.showArchivedHint')}</Text>
      </View>
      <Switch testID="project-show-archived" checked={showArchived} onCheckedChange={setShowArchived} accessibilityLabel={t('project:picker.showArchived')} />
    </View> : null}
    <ScrollView testID="project-picker-scroll" className={cn("flex-1")} contentContainerStyle={{ gap: 8 }} keyboardShouldPersistTaps="handled">
      {!groups.length ? <Text className={cn("text-muted-foreground")}>{t('project:picker.empty')}</Text> : null}
      {visibleGroups.map((group) => <View key={group.id} className={cn("gap-2.5")}>
        {multipleServers ? <Text  variant="title">{group.name}</Text> : null}
        <ProjectOptions projects={splitHiddenProjects(group.projects, hiddenPathsFor(group.id)).visible.filter((project) => matches(project.path, project.label))}
          activePath={registry.focus?.connectionId === group.id ? group.projects.find((project) => project.checkouts.some((checkout) => checkout.directory === activePath))?.path : undefined}
          onSelect={(path) => { void activate({ connectionId: group.id, projectPath: path }).catch((reason) => setError(String(reason))); }}
          onArchive={(path) => {
            const hidden = new Set(hiddenPathsFor(group.id));
            const remaining = group.projects.filter((project) => project.path !== path && !hidden.has(project.path));
            const activeProjectPath = registry.focus?.connectionId === group.id
              ? group.projects.find((project) => project.checkouts.some((checkout) => checkout.directory === activePath))?.path
              : undefined;
            registry.hideProject({ connectionId: group.id, projectPath: path });
            if (activeProjectPath === path && remaining[0]) {
              void registry.activate({ connectionId: group.id, projectPath: remaining[0].path }).catch((reason) => setError(String(reason)));
            }
          }} />
      </View>)}
      {showArchived && hiddenRows.length ? <View className={cn(stylesClasses.hiddenSection)}>
        <View className={cn(stylesClasses.archivedToggleText)}>
          <Text variant="title">{t('project:picker.hiddenTitle', { count: hiddenRows.length })}</Text>
          <Text className={cn("text-muted-foreground")}>{t('project:picker.hiddenHint')}</Text>
        </View>
        {filteredHiddenRows.map(({ group, project }) => <View key={`hidden-${group.id}-${project.path}`} className={cn(stylesClasses.hiddenRow)}>
          <ListRow title={project.label} description={multipleServers ? `${group.name} · ${project.path}` : project.path}
            className={cn("flex-1 min-w-0")}
            left={(props) => <Icon {...props} name="archive-outline" />} style={{ paddingHorizontal: 0 }} />
          <Button testID={`project-restore-hidden-${project.path}`} onPress={() => registry.restoreProject({ connectionId: group.id, projectPath: project.path })} variant="outline" size="sm">
            <Icon name="restore" size={18} color={palette.tint} />
            <Text>{t('project:picker.restore')}</Text>
          </Button>
        </View>)}
      </View> : null}
      {showArchived ? visibleGroups.filter((group) => group.contract === 'v2').map((group) => <View key={`archived-${group.id}`} className={cn("gap-2.5")}>
        {multipleServers ? <Text variant="title">{group.name}</Text> : null}
        <ArchivedProjectsSection connectionId={group.id} testID={`archived-projects-${group.id}`} />
      </View>) : null}
    </ScrollView>
    {error ? <Text className={cn("text-destructive")}>{error}</Text> : null}
    <Button testID="project-add-button" disabled={!groups.length} onPress={() => {
      const target = server || focusConnectionId;
      setAddServer(target);
      browseBase.current = { connectionId: '', path: '' };
      setError(undefined);
      setAdding(true);
    }} variant="ghost"><Icon name={"plus"} size={20} /><Text>{t('project:picker.add')}</Text></Button>
    </>}
  </OverlaySheet>;
}

const stylesClasses = {
  "button": "flex-row items-center gap-1.25 min-h-11 px-1.5",
  "addForm": "gap-3",
  "archivedToggle": "flex-row items-center gap-3",
  "archivedToggleText": "flex-1 gap-1",
  "hiddenSection": "gap-2.5 border-t border-border pt-3",
  "hiddenRow": "flex-row items-center gap-2 border-b border-border pb-2"
} as const;
