import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { ActivityIndicator, Button, Text } from 'react-native-paper';

import { OnboardingStep } from '@/components/onboarding/onboarding-step';
import { ProjectOptions } from '@/components/onboarding/project-options';
import { TextInput } from '@/components/ui/text-input';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useProjects } from '@/providers/opencode-contexts';

export default function OnboardingProjectScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const palette = Colors[useColorScheme() ?? 'light'];
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
    router.push('/onboarding/ready');
  }

  async function submitAdd() {
    if (!directory.trim()) {
      return;
    }
    setIsAdding(true);
    setAddError(undefined);
    try {
      await addProject(directory);
      router.push('/onboarding/ready');
    } catch (reason) {
      setAddError(reason instanceof Error ? reason.message : t('project:errors.addProject'));
    } finally {
      setIsAdding(false);
    }
  }

  return (
    <OnboardingStep
      step={4}
      totalSteps={5}
      title={t('onboarding:project.title')}
      subtitle={t('onboarding:project.subtitle')}
      testID="onboarding-project"
      footerSingleLine
      onBack={() => router.back()}
      footer={
        <>
          <Button
            mode="text"
            style={{ marginRight: 'auto' }}
            testID="onboarding-project-skip"
            disabled={isRefreshingProjectCatalog || isAdding}
            onPress={() => router.push('/onboarding/ready')}>
            {t('onboarding:project.skip')}
          </Button>
          <Button
            mode="outlined"
            testID="onboarding-project-refresh"
            loading={isRefreshingProjectCatalog}
            disabled={isRefreshingProjectCatalog || isAdding}
            onPress={() => void refreshProjectCatalog()}>
            {t('common:actions.refresh')}
          </Button>
          {activeProject ? (
            <Button
              mode="contained"
              testID="onboarding-project-continue"
              onPress={() => choose(activeProject.path)}>
              {t('onboarding:project.continue')}
            </Button>
          ) : null}
        </>
      }>
      {isRefreshingProjectCatalog && projects.length === 0 ? (
        <View style={styles.loading}>
          <ActivityIndicator />
          <Text style={{ color: palette.muted }}>{t('onboarding:project.loading')}</Text>
        </View>
      ) : null}

      {!isRefreshingProjectCatalog && projects.length === 0 ? (
        <Text style={{ color: palette.muted }}>{t('onboarding:project.empty')}</Text>
      ) : null}

      <ProjectOptions activePath={activeProjectPath} onSelect={choose} projects={projects} />

      {adding ? (
        <View style={[styles.addForm, { borderColor: palette.border }]}>
          <Text style={{ color: palette.muted }}>{t('project:picker.enterPath')}</Text>
          <TextInput
            mode="outlined"
            testID="onboarding-project-directory"
            label={t('project:picker.serverDirectory')}
            value={directory}
            onChangeText={setDirectory}
            autoCapitalize="none"
            autoCorrect={false}
          />
          {addError ? <Text style={{ color: palette.danger }}>{addError}</Text> : null}
          <View style={styles.addActions}>
            <Button disabled={isAdding} onPress={() => { setAdding(false); setAddError(undefined); }}>
              {t('common:actions.cancel')}
            </Button>
            <Button
              mode="contained"
              testID="onboarding-project-add-submit"
              loading={isAdding}
              disabled={isAdding || !directory.trim()}
              onPress={() => void submitAdd()}>
              {t('project:picker.add')}
            </Button>
          </View>
        </View>
      ) : (
        <Button
          mode="outlined"
          icon="plus"
          testID="onboarding-project-add"
          onPress={() => setAdding(true)}>
          {t('project:picker.add')}
        </Button>
      )}
    </OnboardingStep>
  );
}

const styles = StyleSheet.create({
  loading: { alignItems: 'center', gap: 10, paddingVertical: 24 },
  addForm: { borderWidth: 1, borderRadius: 16, gap: 10, padding: 14 },
  addActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'flex-end' },
});
