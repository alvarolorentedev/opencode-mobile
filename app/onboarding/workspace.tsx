import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { ActivityIndicator, Button, Text } from 'react-native-paper';

import { OnboardingStep } from '@/components/onboarding/onboarding-step';
import { ProjectOptions } from '@/components/onboarding/project-options';
import { TextInput } from '@/components/ui/text-input';
import { usePalette } from '@/providers/theme-provider';
import { useWorkspace } from '@/providers/opencode-contexts';

export default function OnboardingWorkspaceScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const palette = usePalette();
  const {
    projects,
    activeProjectPath,
    selectProject,
    addWorkspace,
    isRefreshingWorkspaceCatalog,
    refreshWorkspaceCatalog,
  } = useWorkspace();

  const [adding, setAdding] = useState(false);
  const [directory, setDirectory] = useState('');
  const [addError, setAddError] = useState<string>();
  const [isAdding, setIsAdding] = useState(false);

  const activeProject = projects.find((project) => project.path === activeProjectPath);

  function choose(path: string) {
    // Persists through the existing active-project mechanism.
    selectProject(path);
    router.push('/onboarding/preferences');
  }

  async function submitAdd() {
    if (!directory.trim()) {
      return;
    }
    setIsAdding(true);
    setAddError(undefined);
    try {
      await addWorkspace(directory);
      router.push('/onboarding/preferences');
    } catch (reason) {
      setAddError(reason instanceof Error ? reason.message : t('workspace:errors.addWorkspace'));
    } finally {
      setIsAdding(false);
    }
  }

  return (
    <OnboardingStep
      step={3}
      totalSteps={6}
      title={t('onboarding:workspace.title')}
      subtitle={t('onboarding:workspace.subtitle')}
      testID="onboarding-workspace"
      footerSingleLine
      onBack={() => router.back()}
      footer={
        <>
          <Button
            mode="text"
            style={{ marginRight: 'auto' }}
            testID="onboarding-workspace-skip"
            disabled={isRefreshingWorkspaceCatalog || isAdding}
            onPress={() => router.push('/onboarding/preferences')}>
            {t('onboarding:workspace.skip')}
          </Button>
          <Button
            mode="outlined"
            testID="onboarding-workspace-refresh"
            loading={isRefreshingWorkspaceCatalog}
            disabled={isRefreshingWorkspaceCatalog || isAdding}
            onPress={() => void refreshWorkspaceCatalog()}>
            {t('common:actions.refresh')}
          </Button>
          {activeProject ? (
            <Button
              mode="contained"
              testID="onboarding-workspace-continue"
              onPress={() => choose(activeProject.path)}>
              {t('onboarding:workspace.continue')}
            </Button>
          ) : null}
        </>
      }>
      {isRefreshingWorkspaceCatalog && projects.length === 0 ? (
        <View style={styles.loading}>
          <ActivityIndicator />
          <Text style={{ color: palette.muted }}>{t('onboarding:workspace.loading')}</Text>
        </View>
      ) : null}

      {!isRefreshingWorkspaceCatalog && projects.length === 0 ? (
        <Text style={{ color: palette.muted }}>{t('onboarding:workspace.empty')}</Text>
      ) : null}

      <ProjectOptions activePath={activeProjectPath} onSelect={choose} projects={projects} />

      {adding ? (
        <View style={[styles.addForm, { borderColor: palette.border }]}>
          <Text style={{ color: palette.muted }}>{t('workspace:picker.enterPath')}</Text>
          <TextInput
            mode="outlined"
            testID="onboarding-workspace-directory"
            label={t('workspace:picker.serverDirectory')}
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
              testID="onboarding-workspace-add-submit"
              loading={isAdding}
              disabled={isAdding || !directory.trim()}
              onPress={() => void submitAdd()}>
              {t('workspace:picker.add')}
            </Button>
          </View>
        </View>
      ) : (
        <Button
          mode="outlined"
          icon="plus"
          testID="onboarding-workspace-add"
          onPress={() => setAdding(true)}>
          {t('workspace:picker.add')}
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
