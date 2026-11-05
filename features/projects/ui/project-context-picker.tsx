import { useTranslation } from 'react-i18next';

import { WorkspaceSelect } from '@/shared/ui/workspace-select';
import { useWorkspaces } from '@/runtime/workspace';
import { useWorkspaceProjects } from '@/features/projects/state/use-workspace-projects';

// Selects the inspection target used by Settings panels. The active chat
// project is deliberately not changed here.
export function ProjectContextPicker() {
  const { t } = useTranslation();
  const registry = useWorkspaces();
  const { groups } = useWorkspaceProjects();
  const target = registry.inspectionTarget ?? registry.focus;
  const selected = groups.find((entry) => entry.id === target?.connectionId);
  if (!selected) return null;
  return <WorkspaceSelect title={t('common:servers.projectContext')} value={target?.projectPath || selected.projects[0]?.path} testID="settings-project-picker"
    options={selected.projects.map((entry) => ({ value: entry.path, label: entry.label, description: entry.path }))}
    onChange={(projectPath) => { if (target) void registry.inspect({ connectionId: target.connectionId, projectPath }); }} />;
}
