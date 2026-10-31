import { cn } from '@/shared/ui/cn';
import { Spinner } from '@/shared/ui/spinner';
import { Text } from '@/shared/ui/text';
import { Button } from '@/shared/ui/button';
import { TextField } from '@/shared/ui/text-field';
import { Icon } from '@/shared/ui/icon';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { useOnboardingNavigation } from '@/features/onboarding/ui/use-onboarding-navigation';
import { OnboardingStep } from '@/features/onboarding/ui/onboarding-step';
import { ProjectOptions } from '@/features/projects/index';

import { useProjects } from '@/features/projects/context';

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

  const [adding, setAdding] = useState(false);
  const [directory, setDirectory] = useState('');
  const [addError, setAddError] = useState<string>();
  const [isAdding, setIsAdding] = useState(false);

  const activeProject = projects.find((project) => project.path === activeProjectPath);

  function choose(path: string) {
    // Persists through the existing active-project mechanism.
    selectProject(path);
    navigation.next();
  }

  async function submitAdd() {
    if (!directory.trim()) {
      return;
    }
    setIsAdding(true);
    setAddError(undefined);
    try {
      await addProject(directory);
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

      <ProjectOptions activePath={activeProjectPath} onSelect={choose} projects={projects} />

      {adding ? (
        <View className={cn(stylesClasses.addForm, "border-border")}>
          <Text className={cn("text-muted-foreground")}>{t('project:picker.enterPath')}</Text>
          <TextField testID="onboarding-project-directory" label={t('project:picker.serverDirectory')} value={directory} onChangeText={setDirectory} autoCapitalize="none" autoCorrect={false}></TextField>
          {addError ? <Text className={cn("text-destructive")}>{addError}</Text> : null}
          <View className={cn(stylesClasses.addActions)}>
            <Button disabled={isAdding} onPress={() => { setAdding(false); setAddError(undefined); }} variant="ghost"><Text>{t('common:actions.cancel')}</Text></Button>
            <Button testID="onboarding-project-add-submit" disabled={isAdding || !directory.trim()} onPress={() => void submitAdd()} variant="default">{isAdding ? <Spinner size="small" /> : null}<Text>{t('project:picker.add')}</Text></Button>
          </View>
        </View>
      ) : (
        <Button testID="onboarding-project-add" onPress={() => setAdding(true)} variant="outline"><Icon name={"plus"} size={20} /><Text>{t('project:picker.add')}</Text></Button>
      )}
    </OnboardingStep>
  );
}

const stylesClasses = {
  "loading": "items-center gap-2.5 py-6",
  "addForm": "border rounded-[16px] gap-2.5 p-3.5",
  "addActions": "flex-row flex-wrap gap-2 justify-end"
} as const;
