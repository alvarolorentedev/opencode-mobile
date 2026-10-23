import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Appbar, Button, Snackbar, Text } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ProjectPicker } from '@/components/ui/project-picker';
import { FilesPanel } from '@/components/project/files-panel';
import { FilePreview } from '@/components/project/file-preview';
import { Colors, Fonts } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useRetainedState } from '@/components/ui/use-retained-state';
import { getConnectionUiScope } from '@/lib/connection-scope';
import { useConnection, usePreferences, useProjects, useProjectFiles } from '@/providers/opencode-contexts';

export default function ProjectsScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const palette = Colors[useColorScheme() ?? 'light'];
  const { connection, serverCapabilities, settings, connect } = useConnection();
  const { chatPreferences } = usePreferences();
  const slim = chatPreferences.slimInterface === true;
  const { activeProject, refreshProjectCatalog, refreshProjectStatus } = useProjects();
  const { browser, openProjectFile, projectFileStatuses, selectedProjectFile, saveProjectFile, vcsInfo } = useProjectFiles();
  const [pickerVisible, setPickerVisible] = useState(false);

  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string>();
  const scope = JSON.stringify([getConnectionUiScope(settings), activeProject?.path]);
  const [fileVisible, setFileVisible] = useRetainedState(`file-visible:${scope}`, false);
  const ready = connection.status === 'connected' && Boolean(activeProject);
  async function refresh() {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await Promise.all([refreshProjectCatalog(), refreshProjectStatus(), ready ? browser.query ? browser.search(browser.query) : browser.openDirectory(browser.path) : Promise.resolve()]);
    } catch (reason) { setError(reason instanceof Error ? reason.message : t('project:errors.refreshProject')); }
    finally { setRefreshing(false); }
  }
  return <>
    <Appbar.Header statusBarHeight={0} style={{ backgroundColor: palette.surface, paddingTop: insets.top, height: (slim ? 52 : 64) + insets.top }}>
      <Pressable accessibilityRole="button" accessibilityLabel={t('project:picker.changeProject')} onPress={() => setPickerVisible(true)} style={styles.selector}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} variant="titleMedium" style={{ color: palette.text, fontFamily: Fonts.display, fontWeight: '700' }}>{activeProject?.label || t('common:tabs.projects')}</Text>
          <Text numberOfLines={1} variant="bodySmall" style={{ color: palette.muted }}>{connection.status === 'connected' ? activeProject?.path : connection.message}</Text>
        </View>
        <MaterialCommunityIcons name="chevron-down" size={20} color={palette.muted} />
      </Pressable>
      <Appbar.Action testID="project-refresh-button" icon="refresh" disabled={refreshing || connection.status !== 'connected'} accessibilityLabel={t('project:screen.refreshProject')} onPress={() => void refresh()} />
    </Appbar.Header>
    {pickerVisible ? <ProjectPicker visible testID="project-picker" activePath={activeProject?.path} onClose={() => setPickerVisible(false)} /> : null}
    {ready ? <FilesPanel key={scope} browser={browser} projectLabel={activeProject!.label} statuses={serverCapabilities.fileStatus ? projectFileStatuses : []}
      contentStyle={[styles.content, slim && { padding: 10 }]}
      header={<>
        <Text variant="headlineMedium" style={{ fontWeight: '700', color: palette.text }}>{t('project:screen.filesTab')}</Text>
        {vcsInfo?.branch ? <Text style={{ color: palette.muted }}>{t('project:files.branch', { branch: vcsInfo.branch })}</Text> : null}
      </>}
      onOpen={(path) => { void openProjectFile(path).then(() => setFileVisible(true)).catch((reason) => setError(reason instanceof Error ? reason.message : t('project:errors.openFile'))); }} />
      : <ScrollView style={{ flex: 1, backgroundColor: palette.background }} contentContainerStyle={[styles.content, slim && { padding: 10 }]}
        keyboardDismissMode="on-drag" keyboardShouldPersistTaps="handled">
        <Text variant="headlineMedium" style={{ fontWeight: '700', color: palette.text }}>{t('project:screen.filesTab')}</Text>
      <View style={{ gap: 12 }}>
        <Text style={{ color: palette.muted }}>{connection.status !== 'connected' ? connection.message : t('project:picker.empty')}</Text>
        <Button mode="outlined" loading={connection.status === 'connecting'} onPress={() => {
          if (connection.status === 'connected') setPickerVisible(true);
          else void connect().catch((reason) => setError(reason instanceof Error ? reason.message : t('project:errors.refreshProject')));
        }}>{connection.status !== 'connected' ? t('common:actions.reconnect') : t('project:picker.title')}</Button>
      </View>
      </ScrollView>}
    {ready && fileVisible && selectedProjectFile ? <FilePreview key={`${scope}:${selectedProjectFile.path}`} file={selectedProjectFile}
      projectPath={activeProject!.path} branch={vcsInfo?.branch} canSave={serverCapabilities.fileSave} slim={slim}
      onClose={() => setFileVisible(false)} onSave={saveProjectFile} /> : null}
    <Snackbar visible={Boolean(error)} onDismiss={() => setError(undefined)}>{error}</Snackbar>
  </>;
}

const styles = StyleSheet.create({
  selector: { flex: 1, flexDirection: 'row', gap: 8, alignItems: 'center', paddingHorizontal: 16, minHeight: 48, minWidth: 0 },
  content: { padding: 16, gap: 12, paddingBottom: 28, width: '100%', maxWidth: 1100, alignSelf: 'center' },
});
