import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { cn } from '@/shared/ui/cn';
import { Button } from '@/shared/ui/button';
import { Icon } from '@/shared/ui/icon';
import { ListRow } from '@/shared/ui/list-row';
import { Spinner } from '@/shared/ui/spinner';
import { Text } from '@/shared/ui/text';
import { usePalette } from '@/shared/ui/theme/use-palette';
import { getProjectLabel } from '@/features/projects/model/project-utils';
import { useArchivedProjects } from '@/features/projects/state/use-archived-projects';

export function ArchivedProjectsSection({ connectionId, testID }: { connectionId: string; testID?: string }) {
  const { t } = useTranslation();
  const palette = usePalette();
  const { projects, loading, error, supported, restore } = useArchivedProjects(connectionId, true);
  const [busy, setBusy] = useState<string>();
  const [restoreError, setRestoreError] = useState<string>();

  if (!supported) return null;

  const runRestore = async (project: typeof projects[number]) => {
    if (busy) return;
    setBusy(project.worktree);
    setRestoreError(undefined);
    try {
      await restore(project);
    } catch (reason) {
      setRestoreError(reason instanceof Error ? reason.message : t('project:errors.restoreProject'));
    } finally {
      setBusy(undefined);
    }
  };

  return <View className={cn(stylesClasses.section)} testID={testID}>
    <View className={cn(stylesClasses.heading)}>
      <View className={cn(stylesClasses.headingText)}>
        <Text variant="title">{t('project:picker.archivedTitle')}</Text>
        <Text className={cn("text-muted-foreground")}>{t('project:picker.archivedHint')}</Text>
      </View>
      {loading ? <Spinner size="small" /> : null}
    </View>
    {error ? <Text className={cn("text-destructive")}>{t('project:errors.archivedProjects')}</Text> : null}
    {restoreError ? <Text className={cn("text-destructive")}>{restoreError}</Text> : null}
    {!loading && !error && !projects.length ? <Text className={cn("text-muted-foreground")}>{t('project:picker.archivedEmpty')}</Text> : null}
    {projects.map((project) => {
      const label = project.name || getProjectLabel(project.worktree);
      return <View key={project.id} className={cn(stylesClasses.row, "border-border")}>
        <ListRow title={label} description={project.worktree} className={cn("flex-1 min-w-0")} left={(props) => <Icon {...props} name="archive-outline" />} style={{ paddingHorizontal: 0 }} />
        <Button testID={`project-restore-${project.id}`} disabled={Boolean(busy)} onPress={() => void runRestore(project)} variant="outline" size="sm">
          {busy === project.worktree ? <Spinner size="small" /> : <Icon name="restore" size={18} color={palette.tint} />}
          <Text>{t('project:picker.restore')}</Text>
        </Button>
      </View>;
    })}
  </View>;
}

const stylesClasses = {
  "section": "gap-2.5 border-t border-border pt-3",
  "heading": "flex-row items-center justify-between gap-2",
  "headingText": "flex-1 gap-1",
  "row": "flex-row items-center gap-2 border-b pb-2"
} as const;
