import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Appbar, Button, Snackbar, Text } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { WorkspaceBreadcrumb } from '@/components/ui/workspace-breadcrumb';
import { FilesPanel } from '@/components/project/files-panel';
import { FilePreview } from '@/components/project/file-preview';
import { usePalette } from '@/hooks/use-palette';
import { useRetainedState } from '@/components/ui/use-retained-state';
import { getConnectionUiScope } from '@/lib/connection-scope';
import { useConnection, usePreferences, useProjects, useProjectFiles } from '@/providers/opencode-contexts';

export default function ProjectsScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const palette = usePalette();
  const { connection, serverCapabilities, settings, connect } = useConnection();
  const { chatPreferences } = usePreferences();
  const slim = chatPreferences.slimInterface === true;
  const { activeProject, refreshProjectCatalog, refreshProjectStatus } = useProjects();
  const { browser, projectFile, projectFileStatuses, vcsInfo } = useProjectFiles();

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
      <View style={styles.breadcrumbHeader}>
        <WorkspaceBreadcrumb compact={slim} testIDPrefix="projects-workspace" />
      </View>
      <Appbar.Action testID="project-refresh-button" icon="refresh" disabled={refreshing || connection.status !== 'connected'} accessibilityLabel={t('project:screen.refreshProject')} onPress={() => void refresh()} />
    </Appbar.Header>
    {ready ? <FilesPanel key={scope} browser={browser} projectLabel={activeProject!.label} statuses={serverCapabilities.fileStatus ? projectFileStatuses : []}
      contentStyle={[styles.content, slim && { padding: 10 }]}
      header={<>
        <Text variant="headlineMedium" style={{ fontWeight: '700', color: palette.text }}>{t('project:screen.filesTab')}</Text>
        {vcsInfo?.branch ? <Text style={{ color: palette.muted }}>{t('project:files.branch', { branch: vcsInfo.branch })}</Text> : null}
      </>}
      onOpen={(path) => { void projectFile.open(path).then(() => setFileVisible(true)).catch((reason) => setError(reason instanceof Error ? reason.message : t('project:errors.openFile'))); }} />
      : <ScrollView style={{ flex: 1, backgroundColor: palette.background }} contentContainerStyle={[styles.content, slim && { padding: 10 }]}
        keyboardDismissMode="on-drag" keyboardShouldPersistTaps="handled">
        <Text variant="headlineMedium" style={{ fontWeight: '700', color: palette.text }}>{t('project:screen.filesTab')}</Text>
      <View style={{ gap: 12 }}>
        <Text style={{ color: palette.muted }}>{connection.status !== 'connected' ? connection.message : t('project:picker.empty')}</Text>
        {connection.status !== 'connected' ? <Button mode="outlined" loading={connection.status === 'connecting'} onPress={() => {
          void connect().catch((reason) => setError(reason instanceof Error ? reason.message : t('project:errors.refreshProject')));
        }}>{t('common:actions.reconnect')}</Button> : null}
      </View>
      </ScrollView>}
    {ready && fileVisible && projectFile.selected ? <FilePreview key={`${scope}:${projectFile.selected.path}`} file={projectFile.selected}
      projectPath={activeProject!.path} branch={vcsInfo?.branch} canSave={serverCapabilities.fileSave} slim={slim}
      onClose={() => { projectFile.close(); setFileVisible(false); }} onSave={projectFile.save} onDownload={projectFile.download} /> : null}
    <Snackbar visible={Boolean(error)} onDismiss={() => setError(undefined)}>{error}</Snackbar>
  </>;
}

const styles = StyleSheet.create({
  breadcrumbHeader: { flex: 1, justifyContent: 'center', minWidth: 0, paddingHorizontal: 16 },
  content: { padding: 16, gap: 12, paddingBottom: 28, width: '100%', maxWidth: 1100, alignSelf: 'center' },
});
