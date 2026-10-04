import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, KeyboardAvoidingView, Modal, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  ActivityIndicator,
  Appbar,
  Button,
  Card,
  Divider,
  IconButton,
  Snackbar,
  Text,
} from 'react-native-paper';

import { FilesPanel } from '@/components/workspace/files-panel';
import { getConnectionScope } from '@/lib/connection-scope';
import { Fonts } from '@/constants/theme';
import { TextInput } from '@/components/ui/text-input';
import { TopTab } from '@/components/chat/chat-controls';
import { WorkspacePicker } from '@/components/ui/workspace-picker';
import { useAppTheme } from '@/providers/theme-provider';
import { useConnection, usePreferences, useWorkspace } from '@/providers/opencode-contexts';

export default function WorkspaceScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const compact = width < 700;
  const { palette } = useAppTheme();
  const { connection, serverCapabilities, settings } = useConnection();
  const { chatPreferences } = usePreferences();
  const slim = chatPreferences.slimInterface === true;
  const {
    activeProject,
    addWorkspace,
    currentProjectPath,
    isRefreshingWorkspaceCatalog,
    projects,
    refreshWorkspaceCatalog,
    refreshWorkspaceStatus,
    selectProject,
    serverRootPath,
    searchWorkspaceFiles,
    openWorkspaceFile,
    workspaceFiles,
    workspaceFileStatuses,
    selectedWorkspaceFile,
    saveWorkspaceFile,
    vcsInfo,
    worktrees,
    refreshWorktrees,
    createWorktree,
    resetWorktree,
    removeWorktree,
  } = useWorkspace();
  const [activePanel, setActivePanel] = useState<'files' | 'tools'>('files');
  const [workspacePickerVisible, setWorkspacePickerVisible] = useState(false);
  const [fileDetailsOpen, setFileDetailsOpen] = useState(false);
  const [editingFile, setEditingFile] = useState<{ path: string; original: string; value: string }>();
  const [isSavingFile, setIsSavingFile] = useState(false);
  const [worktreeName, setWorktreeName] = useState('');
  const [worktreeStartCommand, setWorktreeStartCommand] = useState('');
  const [isCreatingWorktree, setIsCreatingWorktree] = useState(false);
  const [isRefreshingWorktrees, setIsRefreshingWorktrees] = useState(false);
  const [updatingWorktree, setUpdatingWorktree] = useState<string>();
  const [error, setError] = useState<string>();

  const isRefreshing = isRefreshingWorkspaceCatalog;
  async function handleRefresh() {
    await Promise.all([refreshWorkspaceCatalog(), refreshWorkspaceStatus()])
      .catch((reason) => setError(reason instanceof Error ? reason.message : t('workspace:errors.refreshWorkspace')));
  }

  function confirmDestructive(title: string, message: string, actionLabel: string, action: () => void) {
    if (Platform.OS === 'web') {
      if (globalThis.confirm(`${title}\n\n${message}`)) action();
      return;
    }
    Alert.alert(title, message, [
      { text: t('common:actions.cancel'), style: 'cancel' },
      { text: actionLabel, style: 'destructive', onPress: action },
    ]);
  }

  return (
    <>
      <Appbar.Header
        style={[styles.header, { backgroundColor: palette.surface, paddingTop: insets.top, height: (slim ? 52 : 64) + insets.top }]}
        statusBarHeight={0}
        elevated>
        <View style={styles.headerMain}>
          <Pressable accessibilityRole="button" accessibilityLabel={t('workspace:picker.changeWorkspace')} onPress={() => setWorkspacePickerVisible(true)} style={({ pressed }) => [styles.headerSelector, pressed && styles.headerSelectorPressed]}>
            <View style={styles.headerCopy}>
              <Text numberOfLines={1} variant="titleMedium" style={[styles.headerTitle, { color: palette.text }]}>{activeProject?.label || t('common:tabs.workspace')}</Text>
              <Text numberOfLines={1} variant="bodySmall" style={{ color: palette.muted }}>{connection.status === 'connected' ? activeProject?.path || currentProjectPath || serverRootPath : connection.message}</Text>
            </View>
            <MaterialCommunityIcons name="chevron-down" size={20} color={palette.muted} />
          </Pressable>
        </View>
        <View style={styles.headerActions}>
          <Appbar.Action testID="workspace-sync-button" icon="sync" accessibilityLabel={t('workspace:screen.syncProjects')} onPress={() => void refreshWorkspaceCatalog()} />
          <Appbar.Action testID="workspace-refresh-button" icon="refresh" accessibilityLabel={t('workspace:screen.refreshWorkspace')} onPress={() => void handleRefresh()} />
        </View>
      </Appbar.Header>
      <WorkspacePicker visible={workspacePickerVisible} testID="workspace-picker" projects={projects} activePath={activeProject?.path} onClose={() => setWorkspacePickerVisible(false)} onSelect={selectProject} onAdd={addWorkspace} />
      <View style={[styles.tabsRow, { backgroundColor: palette.surface, borderBottomColor: palette.border }]}>
        <TopTab active={activePanel === 'files'} label={t('workspace:screen.filesTab')} onPress={() => setActivePanel('files')} slim={slim} />
        <TopTab active={activePanel === 'tools'} label={t('workspace:screen.worktreesTab')} onPress={() => setActivePanel('tools')} slim={slim} />
      </View>
      <ScrollView
        style={[styles.screen, { backgroundColor: palette.background }]}
        contentContainerStyle={[styles.content, styles.centeredContent, slim && { padding: 10, gap: 10 }]}
        keyboardDismissMode="on-drag"
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={() => void handleRefresh()} tintColor={palette.tint} />}>
      {activePanel === 'files' ? <Card mode="contained" style={styles.panel}>
        <Card.Title title={t('workspace:files.title')} subtitle={vcsInfo?.branch ? t('workspace:files.branch', { branch: vcsInfo.branch }) : t('workspace:files.searchAndInspect')} />
        <Card.Content style={styles.fileSection}>
          <FilesPanel
            key={`${getConnectionScope(settings)}:${activeProject?.path}`}
            statuses={serverCapabilities.fileStatus ? workspaceFileStatuses : []}
            files={workspaceFiles}
            onSearch={searchWorkspaceFiles}
            onOpen={(path) => { void openWorkspaceFile(path).then(() => { setEditingFile(undefined); setFileDetailsOpen(true); }).catch((reason) => setError(reason instanceof Error ? reason.message : t('workspace:errors.openFile'))); }}
          />
          {selectedWorkspaceFile ? (
            <Modal visible={fileDetailsOpen} animationType="slide" presentationStyle="fullScreen" onRequestClose={() => setFileDetailsOpen(false)}>
              <KeyboardAvoidingView style={{ flex: 1, backgroundColor: palette.background }} behavior="padding">
                <Appbar.Header statusBarHeight={0} style={{ backgroundColor: palette.surface, paddingTop: insets.top, height: 64 + insets.top }}>
                  <Appbar.BackAction accessibilityLabel={t('workspace:files.close')} onPress={() => setFileDetailsOpen(false)} />
                  <Appbar.Content title={selectedWorkspaceFile.path.split('/').pop() || selectedWorkspaceFile.path} subtitle={selectedWorkspaceFile.path} />
                </Appbar.Header>
                <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: slim ? 10 : 16, paddingBottom: Math.max(insets.bottom, slim ? 10 : 16) + (slim ? 10 : 16) }}>
            <View style={[styles.filePreview, slim && { margin: 10, padding: 8 }, { borderColor: palette.border, backgroundColor: palette.surface }]}>
              <Text variant="labelLarge" style={{ color: palette.text }}>{selectedWorkspaceFile.path}</Text>
              {editingFile?.path === selectedWorkspaceFile.path ? (
                <>
                  <Text style={{ color: palette.warning }}>{t('workspace:files.savingNotice')}</Text>
                  <TextInput
                    testID="workspace-file-editor"
                    mode="outlined"
                    multiline
                    value={editingFile.value}
                    onChangeText={(value) => setEditingFile({ ...editingFile, value })}
                    style={[styles.fileEditor, styles.code]}
                  />
                  <View style={styles.inlineActions}>
                    <Button
                      testID="workspace-file-save-button"
                      mode="contained"
                      loading={isSavingFile}
                      disabled={isSavingFile || editingFile.value === editingFile.original}
                      onPress={() => {
                        setIsSavingFile(true);
                        void saveWorkspaceFile(editingFile.path, editingFile.original, editingFile.value)
                          .then(() => setEditingFile(undefined))
                          .catch((reason) => setError(reason instanceof Error ? reason.message : t('workspace:errors.saveFile')))
                          .finally(() => setIsSavingFile(false));
                      }}>
                      {t('workspace:files.savePatch')}
                    </Button>
                    <Button disabled={isSavingFile} onPress={() => setEditingFile(undefined)}>{t('common:actions.cancel')}</Button>
                  </View>
                </>
              ) : (
                <>
                  <Text selectable style={[styles.code, { color: palette.text }]}>{selectedWorkspaceFile.content.content}</Text>
                  {serverCapabilities.fileSave ? (
                    <Button
                      mode="outlined"
                      style={styles.selfStart}
                      onPress={() => setEditingFile({
                        path: selectedWorkspaceFile.path,
                        original: selectedWorkspaceFile.content.content,
                        value: selectedWorkspaceFile.content.content,
                      })}>
                      {t('common:actions.edit')}
                    </Button>
                  ) : (
                    <Text style={{ color: palette.muted }}>{t('workspace:files.editingUnavailable')}</Text>
                  )}
                </>
              )}
            </View>
                </ScrollView>
              </KeyboardAvoidingView>
            </Modal>
          ) : null}
        </Card.Content>
      </Card> : null}

      {activePanel === 'tools' ? <Card mode="contained" style={styles.panel}>
        <Card.Title
          title={t('workspace:worktrees.title')}
          subtitle={t('workspace:worktrees.subtitle')}
          right={() => (
            isRefreshingWorktrees
              ? <ActivityIndicator style={styles.headerAction} color={palette.tint} />
              : <IconButton
                  icon="refresh"
                  accessibilityLabel={t('workspace:worktrees.refresh')}
                  disabled={!activeProject}
                  onPress={() => {
                    setIsRefreshingWorktrees(true);
                    void refreshWorktrees()
                      .catch((reason) => setError(reason instanceof Error ? reason.message : t('workspace:errors.refreshWorktrees')))
                      .finally(() => setIsRefreshingWorktrees(false));
                  }}
                />
          )}
        />
        <Card.Content style={styles.worktreeSection}>
          <View style={[styles.worktreeForm, compact && styles.compactFormRow]}>
            <TextInput testID="workspace-worktree-name" mode="outlined" dense label={t('workspace:worktrees.nameLabel')} value={worktreeName} onChangeText={setWorktreeName} style={styles.renameInput} />
            <TextInput testID="workspace-worktree-command" mode="outlined" dense label={t('workspace:worktrees.startCommandLabel')} value={worktreeStartCommand} onChangeText={setWorktreeStartCommand} style={styles.renameInput} />
            <Button
              testID="workspace-worktree-create"
              mode="contained"
              loading={isCreatingWorktree}
              disabled={!activeProject || isCreatingWorktree}
              onPress={() => {
                setIsCreatingWorktree(true);
                void createWorktree(worktreeName, worktreeStartCommand)
                  .then(() => { setWorktreeName(''); setWorktreeStartCommand(''); })
                  .catch((reason) => setError(reason instanceof Error ? reason.message : t('workspace:errors.createWorktree')))
                  .finally(() => setIsCreatingWorktree(false));
              }}>
              {t('common:actions.create')}
            </Button>
          </View>
          {worktrees.length === 0 ? <Text style={{ color: palette.muted }}>{t('workspace:worktrees.empty')}</Text> : null}
          {worktrees.map((worktree, index) => {
            const directory = typeof worktree === 'string' ? worktree : worktree.directory;
            const title = typeof worktree === 'string' ? directory.split('/').filter(Boolean).pop() || directory : worktree.name;
            const detail = typeof worktree === 'string' || !worktree.branch ? directory : `${worktree.branch} · ${directory}`;
            return (
              <View key={directory}>
                <View style={[styles.archiveRow, compact && styles.compactArchiveRow]}>
                  <View style={styles.archiveCopy}>
                    <Text variant="titleMedium" style={{ color: palette.text }}>{title}</Text>
                    <Text selectable style={{ color: palette.muted }}>{detail}</Text>
                  </View>
                  <View style={styles.iconActions}>
                    {serverCapabilities.worktreeReset ? (
                      <IconButton
                        icon="backup-restore"
                        accessibilityLabel={t('workspace:worktrees.resetLabel', { name: title })}
                        loading={updatingWorktree === directory}
                        disabled={updatingWorktree === directory}
                        iconColor={palette.danger}
                        onPress={() => confirmDestructive(
                          t('workspace:worktrees.resetTitle'),
                          t('workspace:worktrees.resetMessage', { directory }),
                          t('workspace:worktrees.resetAction'),
                          () => {
                            setUpdatingWorktree(directory);
                            void resetWorktree(directory)
                              .catch((reason) => setError(reason instanceof Error ? reason.message : t('workspace:errors.resetWorktree')))
                              .finally(() => setUpdatingWorktree(undefined));
                          },
                        )}
                      />
                    ) : null}
                    <IconButton
                      icon="delete-outline"
                      accessibilityLabel={t('workspace:worktrees.removeLabel', { name: title })}
                      disabled={updatingWorktree === directory}
                      iconColor={palette.danger}
                      onPress={() => confirmDestructive(
                        t('workspace:worktrees.removeTitle'),
                        t('workspace:worktrees.removeMessage', { directory }),
                        t('common:actions.remove'),
                        () => {
                          setUpdatingWorktree(directory);
                          void removeWorktree(directory)
                            .catch((reason) => setError(reason instanceof Error ? reason.message : t('workspace:errors.removeWorktree')))
                            .finally(() => setUpdatingWorktree(undefined));
                        },
                      )}
                    />
                  </View>
                </View>
                {index < worktrees.length - 1 ? <Divider /> : null}
              </View>
            );
          })}
        </Card.Content>
      </Card> : null}
      </ScrollView>
      <Snackbar visible={Boolean(error)} onDismiss={() => setError(undefined)}>{error}</Snackbar>
    </>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: 16, gap: 16, paddingBottom: 28, width: '100%' },
  centeredContent: { maxWidth: 1100, alignSelf: 'center' },
  header: { elevation: 0 },
  headerMain: { alignSelf: 'stretch', flex: 1, justifyContent: 'center', minWidth: 0 },
  headerActions: { alignItems: 'center', flexDirection: 'row', flexShrink: 0 },
  headerSelector: { alignItems: 'center', alignSelf: 'stretch', borderRadius: 14, flexDirection: 'row', gap: 8, justifyContent: 'center', marginRight: 8, minHeight: 48, paddingRight: 4 },
  headerSelectorPressed: { opacity: 0.82 },
  headerCopy: { flex: 1, minWidth: 0 },
  headerTitle: { fontFamily: Fonts.display, fontWeight: '700' },
  tabsRow: { flexDirection: 'row', borderBottomWidth: 1 },
  actions: { flexDirection: 'row', gap: 12 },
  panel: { backgroundColor: 'transparent', borderRadius: 0 },
  listContent: { paddingHorizontal: 0 },
  filterRow: { paddingHorizontal: 16, paddingBottom: 8, alignItems: 'flex-start' },
  headerAction: { marginRight: 16, alignSelf: 'center' },
  sessionMeta: { alignItems: 'flex-end', justifyContent: 'center', gap: 4 },
  compactSessionMeta: { paddingHorizontal: 16, paddingBottom: 8, alignItems: 'flex-start' },
  sessionDetails: { flexDirection: 'row', gap: 8 },
  inlineActions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' },
  iconActions: { flexDirection: 'row', alignItems: 'center' },
  renameRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingBottom: 8 },
  compactFormRow: { flexDirection: 'column', alignItems: 'stretch' },
  renameInput: { flex: 1 },
  emptyText: { paddingHorizontal: 16, paddingBottom: 8 },
  archiveRow: { padding: 16, flexDirection: 'row', alignItems: 'center', gap: 12 },
  compactArchiveRow: { alignItems: 'flex-start', flexDirection: 'column' },
  archiveCopy: { flex: 1, minWidth: 0 },
  fileSection: { gap: 8, paddingHorizontal: 0 },
  filePreview: { margin: 16, padding: 12, borderWidth: 1, borderRadius: 12, gap: 8 },
  fileEditor: { minHeight: 240 },
  selfStart: { alignSelf: 'flex-start' },
  worktreeSection: { gap: 8 },
  worktreeForm: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  code: { fontFamily: 'monospace', fontSize: 12 },
  favoritesBar: { borderBottomWidth: StyleSheet.hairlineWidth, paddingHorizontal: 8, paddingVertical: 6 },
  favoritesScroll: { alignItems: 'center', gap: 6, paddingHorizontal: 8 },
  favoriteChip: { alignItems: 'center', borderRadius: 999, borderWidth: 1, flexDirection: 'row', paddingLeft: 12 },
  favoriteChipBody: { paddingVertical: 6, paddingRight: 4, maxWidth: 160 },
  favoriteChipBodyPressed: { opacity: 0.72 },
});
