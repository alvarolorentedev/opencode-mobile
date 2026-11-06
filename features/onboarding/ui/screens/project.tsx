import { cn } from '@/shared/ui/cn';
import { Spinner } from '@/shared/ui/spinner';
import { Text } from '@/shared/ui/text';
import { Button } from '@/shared/ui/button';
import { TextField } from '@/shared/ui/text-field';
import { Icon } from '@/shared/ui/icon';
import { useRef, useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { useOnboardingNavigation } from '@/features/onboarding/ui/use-onboarding-navigation';
import { OnboardingStep } from '@/features/onboarding/ui/onboarding-step';
import { ProjectDirectoryPicker, ProjectOptions, useWorkspaceProjects } from '@/features/projects/index';

import { useProjects } from '@/features/projects/context';
import { useWorkspaces } from '@/runtime/workspace';

export default function OnboardingProjectScreen() {
  const { t } = useTranslation();
  const navigation = useOnboardingNavigation('project');

  const {
    projects,
    activeProjectPath,
    selectProject,
    addProject,
    isRefreshingProjectCatalog,
    refreshProjectCatalog,
  } = useProjects();

  const registry = useWorkspaces();
  const { groups, listDirectories } = useWorkspaceProjects();
  const connectionId = registry.focus?.connectionId ?? groups[0]?.id;
  const startPath = activeProjectPath || projects[0]?.path;

  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState('');
  const [addError, setAddError] = useState<string>();
  const [isAdding, setIsAdding] = useState(false);
  // Keep one location for the add session; the first listed path seeds it when
  // the server has no projects yet.
  const browseBase = useRef({ connectionId: '', path: '' });

  const activeProject = projects.find((project) => project.path === activeProjectPath);
  const visibleProjects = useMemo(() => {
    const term = query.trim().toLocaleLowerCase();
    return term
      ? projects.filter((project) => `${project.label} ${project.path}`.toLocaleLowerCase().includes(term))
      : projects;
  }, [projects, query]);

  function choose(path: string) {
    // Persists through the existing active-project mechanism.
    selectProject(path);
    navigation.next();
  }

  async function submitAdd(path: string) {
    if (!path.trim()) {
      return;
    }
    setIsAdding(true);
    setAddError(undefined);
    try {
      const location = await addProject(path);
      if (connectionId) registry.restoreProject({ connectionId, projectPath: location });
      navigation.next();
    } catch (reason) {
      setAddError(reason instanceof Error ? reason.message : t('project:errors.addProject'));
    } finally {
      setIsAdding(false);
    }
  }

  return (
    <OnboardingStep
      step="project"
      title={t('onboarding:project.title')}
      subtitle={t('onboarding:project.subtitle')}
      testID="onboarding-project"
      footerSingleLine
      footer={
        <>
          <Button testID="onboarding-project-skip" disabled={isRefreshingProjectCatalog || isAdding} onPress={navigation.next} variant="ghost" className={cn("mr-auto")} ><Text>{t('onboarding:project.skip')}</Text></Button>
          {activeProject ? (
            <Button testID="onboarding-project-continue" onPress={() => choose(activeProject.path)} variant="default"><Text>{t('onboarding:project.continue')}</Text></Button>
          ) : null}
        </>
      }>
      {isRefreshingProjectCatalog && projects.length === 0 ? (
        <View className={cn(stylesClasses.loading)}>
          <Spinner />
          <Text className={cn("text-muted-foreground")}>{t('onboarding:project.loading')}</Text>
        </View>
      ) : null}

      {!isRefreshingProjectCatalog && projects.length === 0 ? (
        <>
          <Text className={cn("text-muted-foreground")}>{t('onboarding:project.empty')}</Text>
          <Button testID="onboarding-project-retry" disabled={isAdding} onPress={() => void refreshProjectCatalog()} variant="outline"><Text>{t('common:actions.retry')}</Text></Button>
        </>
      ) : null}

      <TextField testID="onboarding-project-search" accessibilityLabel={t('common:servers.searchProjects')} placeholder={t('common:servers.searchProjects')} value={query} onChangeText={setQuery} autoCapitalize="none" autoCorrect={false}></TextField>
      <ProjectOptions activePath={activeProjectPath} onSelect={choose} projects={visibleProjects} />
      {query.trim() && visibleProjects.length === 0 ? <Text className={cn("text-muted-foreground")}>{t('onboarding:project.noMatches', { query: query.trim() })}</Text> : null}

      {adding ? (
        <View className={cn(stylesClasses.addForm, "border-border")}>
          {connectionId ? <ProjectDirectoryPicker startPath={startPath ?? ''} testID="onboarding-project-directory-picker"
            loadDirectories={(path, signal) => {
              if (browseBase.current.connectionId !== connectionId) browseBase.current = { connectionId, path: '' };
              browseBase.current.path ||= path;
              return listDirectories(connectionId, browseBase.current.path, path, signal);
            }}
            onConfirm={(path) => void submitAdd(path)}
            busy={isAdding} scrollable={false} /> : null}
          {addError ? <Text className={cn("text-destructive")}>{addError}</Text> : null}
          <View className={cn(stylesClasses.addActions)}>
            <Button disabled={isAdding} onPress={() => { setAdding(false); setAddError(undefined); }} variant="ghost"><Text>{t('common:actions.cancel')}</Text></Button>
          </View>
        </View>
      ) : (
        <Button testID="onboarding-project-add" onPress={() => { browseBase.current = { connectionId: '', path: '' }; setAddError(undefined); setAdding(true); }} variant="outline"><Icon name={"plus"} size={20} /><Text>{t('project:picker.add')}</Text></Button>
      )}
    </OnboardingStep>
  );
}

const stylesClasses = {
  "loading": "items-center gap-2.5 py-6",
  "addForm": "border rounded-[16px] gap-2.5 p-3.5",
  "addActions": "flex-row flex-wrap gap-2 justify-end"
} as const;
