import { View } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { WorkspaceSelect } from '@/components/ui/workspace-select';
import { useWorkspaces } from '@/providers/workspace-context';
import { useWorkspaceProjects } from '@/providers/use-workspace-projects';
export function ServerContextPicker({ project = false, server = true }: { project?: boolean; server?: boolean }) {
  const { t } = useTranslation();
  const registry = useWorkspaces();
  const { groups } = useWorkspaceProjects();
  const multipleServers = groups.length > 1;
  const target = registry.inspectionTarget ?? registry.focus;
  const selected = groups.find((entry) => entry.id === target?.connectionId);
  const showServer = server && multipleServers;
  if (!showServer && !project && !multipleServers) return null;
  return <View style={{ gap: 10, paddingVertical: 12 }}>
    {showServer ? <WorkspaceSelect title={t('common:servers.server')} value={selected?.id} testID="settings-server-picker"
      options={groups.map((entry) => ({ value: entry.id, label: entry.name, description: t(`common:servers.status.${entry.status}`) }))}
      onChange={(connectionId) => { const group = groups.find((entry) => entry.id === connectionId); void registry.inspect({ connectionId, projectPath: group?.projects[0]?.path ?? '' }); }} /> : null}
    {project && selected ? <WorkspaceSelect title={t('common:servers.projectContext')} value={target?.projectPath || selected.projects[0]?.path} testID="settings-project-picker"
      options={selected.projects.map((entry) => ({ value: entry.path, label: entry.label, description: entry.path }))}
      onChange={(projectPath) => { if (target) void registry.inspect({ connectionId: target.connectionId, projectPath }); }} /> : null}
    {multipleServers && selected ? <Text variant="bodySmall">{t('common:servers.forServer', { name: selected.name })}</Text> : null}
  </View>;
}
