import { cn } from '@/shared/ui/cn';
import { Button } from '@/shared/ui/button';
import { Icon } from '@/shared/ui/icon';
import { ScreenHeader } from '@/shared/ui/screen-header';
import { Text } from '@/shared/ui/text';
import { Spinner } from '@/shared/ui/spinner';
import { Feedback } from '@/shared/ui/feedback';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, View } from 'react-native';

import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { WorkspaceBreadcrumb } from '@/features/projects/ui/workspace-breadcrumb';
import { FilesPanel } from '@/features/projects/ui/files-panel';
import { FilePreview } from '@/features/projects/ui/file-preview';
import { usePalette } from '@/shared/ui/theme/use-palette';
import { useRetainedState } from '@/runtime/workspace';
import { getConnectionUiScope } from '@/shared/contracts/connection-scope';
import { useConnection } from '@/features/connections/context';
import { usePreferences } from '@/shared/preferences/context';
import { useProjects, useProjectFiles } from '@/features/projects/context';

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
    <ScreenHeader style={{ backgroundColor: palette.surface, paddingTop: insets.top, height: (slim ? 52 : 64) + insets.top }} safeArea={false}><View className={cn(stylesClasses.breadcrumbHeader)}>
        <WorkspaceBreadcrumb compact={slim} testIDPrefix="projects-workspace" />
      </View><Button testID="project-refresh-button" disabled={refreshing || connection.status !== 'connected'} accessibilityLabel={t('project:screen.refreshProject')} onPress={() => void refresh()} variant="ghost" size="icon"><Icon name={"refresh"} size={24} /></Button></ScreenHeader>
    {ready ? <FilesPanel key={scope} browser={browser} projectLabel={activeProject!.label} statuses={serverCapabilities.fileStatus ? projectFileStatuses : []}
      contentStyle={[styles.content, slim && { padding: 10 }]}
      header={<Text className={cn("font-bold text-foreground")} variant="display">{t('project:screen.filesTab')}</Text>}
      onOpen={(path) => { void projectFile.open(path).then(() => setFileVisible(true)).catch((reason) => setError(reason instanceof Error ? reason.message : t('project:errors.openFile'))); }} />
      : <ScrollView className={cn("flex-1 bg-background")} contentContainerStyle={[styles.content, slim && { padding: 10 }]}
        keyboardDismissMode="on-drag" keyboardShouldPersistTaps="handled">
        <Text className={cn("font-bold text-foreground")} variant="display">{t('project:screen.filesTab')}</Text>
      <View className={cn("gap-3")}>
        <Text className={cn("text-muted-foreground")}>{connection.status !== 'connected' ? connection.message : t('project:picker.empty')}</Text>
        {connection.status !== 'connected' ? <Button onPress={() => {
          void connect().catch((reason) => setError(reason instanceof Error ? reason.message : t('project:errors.refreshProject')));
        }} variant="outline">{connection.status === 'connecting' ? <Spinner size="small" /> : null}<Text>{t('common:actions.reconnect')}</Text></Button> : null}
      </View>
      </ScrollView>}
    {ready && fileVisible && projectFile.selected ? <FilePreview key={`${scope}:${projectFile.selected.path}`} file={projectFile.selected}
      projectPath={activeProject!.path} branch={vcsInfo?.branch} canSave={serverCapabilities.fileSave} slim={slim}
      onClose={() => { projectFile.close(); setFileVisible(false); }} onSave={projectFile.save} onDownload={projectFile.download} /> : null}
    <Feedback  open={Boolean(error)} onOpenChange={() => (() => setError(undefined))()}>{error}</Feedback>
  </>;
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 12, paddingBottom: 28, width: '100%', maxWidth: 1100, alignSelf: 'center' }
});

const stylesClasses = {
  "breadcrumbHeader": "flex-1 justify-center min-w-0 px-4"
} as const;
