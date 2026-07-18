import * as Clipboard from 'expo-clipboard';
import { useState } from 'react';
import { Alert, Platform, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import {
  ActivityIndicator,
  Button,
  Card,
  Divider,
  List,
  Surface,
  Text,
  TextInput,
} from 'react-native-paper';

import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { formatRelativeTime, getSessionSubtitle } from '@/lib/opencode/format';
import type { Session } from '@/lib/opencode/types';
import { useOpencode } from '@/providers/opencode-provider';

export default function WorkspaceScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const {
    activeProject,
    connection,
    createSession,
    deleteSession,
    currentProjectPath,
    currentSessionId,
    isRefreshingSessions,
    isRefreshingWorkspaceCatalog,
    openSession,
    projects,
    refreshSessions,
    refreshWorkspaceCatalog,
    refreshWorkspaceStatus,
    renameSession,
    selectProject,
    serverRootPath,
    sessionPreviewById,
    sessionStatuses,
    sessions,
    shareSession,
    unshareSession,
    searchWorkspaceFiles,
    openWorkspaceFile,
    workspaceFiles,
    workspaceFileStatuses,
    selectedWorkspaceFile,
    vcsInfo,
  } = useOpencode();
  const [isCreating, setIsCreating] = useState(false);
  const [updatingSessionId, setUpdatingSessionId] = useState<string | undefined>();
  const [renamingSessionId, setRenamingSessionId] = useState<string>();
  const [renameValue, setRenameValue] = useState('');
  const [fileQuery, setFileQuery] = useState('');

  const isRefreshing = isRefreshingSessions || isRefreshingWorkspaceCatalog;

  async function handleRefresh() {
    await Promise.all([refreshWorkspaceCatalog(), refreshSessions(), refreshWorkspaceStatus()]);
  }

  async function handleNewChat() {
    setIsCreating(true);
    try {
      const session = await createSession();
      await openSession(session.id);
      router.push('/(tabs)');
    } finally {
      setIsCreating(false);
    }
  }

  async function handleDelete(sessionId: string) {
    setUpdatingSessionId(sessionId);
    try {
      await deleteSession(sessionId);
    } finally {
      setUpdatingSessionId(undefined);
    }
  }

  function confirmDelete(session: Session) {
    const message = `“${session.title || 'Untitled chat'}” and all of its data will be permanently deleted.`;
    if (Platform.OS === 'web') {
      if (globalThis.confirm(`Delete session?\n\n${message}`)) void handleDelete(session.id);
      return;
    }
    Alert.alert('Delete session?', message, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => void handleDelete(session.id) },
    ]);
  }

  async function handleShare(session: Session) {
    setUpdatingSessionId(session.id);
    try {
      if (session.share?.url) {
        await unshareSession(session.id);
      } else {
        const shared = await shareSession(session.id);
        if (shared.share?.url) await Clipboard.setStringAsync(shared.share.url);
      }
    } finally {
      setUpdatingSessionId(undefined);
    }
  }

  function confirmShare(session: Session) {
    if (session.share?.url) {
      void handleShare(session);
      return;
    }
    const message = 'Anyone with the generated link may be able to view this session.';
    if (Platform.OS === 'web') {
      if (globalThis.confirm(`Share session publicly?\n\n${message}`)) void handleShare(session);
      return;
    }
    Alert.alert('Share session publicly?', message, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Share', onPress: () => void handleShare(session) },
    ]);
  }

  function renderSessionItem(session: Session, index: number, total: number) {
    return (
      <View key={session.id}>
        <List.Item
          title={session.title || 'Untitled chat'}
          description={sessionPreviewById[session.id] || getSessionSubtitle(session)}
          onPress={() => {
            void openSession(session.id);
            router.push('/(tabs)');
          }}
          titleStyle={{ color: palette.text, fontWeight: currentSessionId === session.id ? '700' : '500' }}
          descriptionStyle={{ color: palette.muted }}
          right={() => (
            <View style={styles.sessionMeta}>
              <Text style={{ color: palette.muted }}>{formatRelativeTime(session.time.updated)}</Text>
               <Text style={{ color: palette.tint }}>{sessionStatuses[session.id]?.type || 'idle'}</Text>
               <View style={styles.inlineActions}>
                 <Button compact onPress={() => { setRenamingSessionId(session.id); setRenameValue(session.title || ''); }}>Rename</Button>
                 <Button compact onPress={() => confirmShare(session)}>{session.share?.url ? 'Unshare' : 'Share'}</Button>
               </View>
               <Button
                compact
                mode="text"
                loading={updatingSessionId === session.id}
                disabled={updatingSessionId === session.id}
                textColor={palette.danger}
                onPress={() => confirmDelete(session)}>
                Delete
              </Button>
            </View>
          )}
        />
        {renamingSessionId === session.id ? (
          <View style={styles.renameRow}>
            <TextInput testID="workspace-session-title-input" mode="outlined" dense value={renameValue} onChangeText={setRenameValue} style={styles.renameInput} />
            <Button mode="contained" onPress={() => void renameSession(session.id, renameValue).then(() => setRenamingSessionId(undefined))}>Save</Button>
            <Button onPress={() => setRenamingSessionId(undefined)}>Cancel</Button>
          </View>
        ) : null}
        {index < total - 1 ? <Divider /> : null}
      </View>
    );
  }

  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: palette.background }]}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={() => void handleRefresh()} tintColor={palette.tint} />}>
      <Surface style={[styles.hero, { backgroundColor: palette.surface }]} elevation={1}>
        <Text variant="headlineSmall" style={{ color: palette.text }}>Workspaces</Text>
        <Text variant="bodyMedium" style={{ color: palette.muted }}>
          {connection.status === 'connected'
            ? `Connected to ${connection.projectDirectory || currentProjectPath || serverRootPath || 'your OpenCode server'}`
            : connection.message}
        </Text>
        <View style={styles.actions}>
          <Button testID="workspace-sync-button" mode="outlined" onPress={() => void refreshWorkspaceCatalog()}>Sync</Button>
          <Button testID="workspace-refresh-button" mode="contained" onPress={() => void handleRefresh()}>Refresh</Button>
        </View>
      </Surface>

      <Card mode="contained" style={[styles.card, { backgroundColor: palette.surface }]}>
        <Card.Title title="Projects" subtitle="Pick the workspace that should back the chat." />
        <Card.Content style={styles.listContent}>
          {projects.length === 0 ? <Text style={{ color: palette.muted }}>No projects available yet.</Text> : null}
          {projects.map((project, index) => {
            const isActive = project.path === activeProject?.path;

            return (
              <View key={project.path}>
                <List.Item
                  title={project.label}
                  description={project.path}
                  onPress={() => selectProject(project.path)}
                  titleStyle={{ color: palette.text, fontWeight: isActive ? '700' : '500' }}
                  descriptionStyle={{ color: palette.muted }}
                  right={() => (
                    <Text style={{ color: isActive ? palette.tint : palette.muted, alignSelf: 'center' }}>
                      {isActive ? 'Active' : project.isCurrent ? 'Current' : 'Server'}
                    </Text>
                  )}
                />
                {index < projects.length - 1 ? <Divider /> : null}
              </View>
            );
          })}
        </Card.Content>
      </Card>

      <Card mode="contained" style={[styles.card, { backgroundColor: palette.surface }]}> 
        <Card.Title
          title="Chats"
          subtitle={activeProject ? `Showing chats for ${activeProject.label}` : 'Choose a project to load chats.'}
          right={() =>
                    isCreating ? <ActivityIndicator style={styles.headerAction} color={palette.tint} /> : <Button testID="workspace-new-chat-button" onPress={() => void handleNewChat()} disabled={!activeProject}>New</Button>
          }
        />
        <Card.Content style={styles.listContent}>
          {!activeProject ? <Text style={{ color: palette.muted }}>Select a project first.</Text> : null}
          {activeProject && sessions.length === 0 ? (
            <Text style={{ color: palette.muted }}>No chats in this workspace yet.</Text>
          ) : null}
          {sessions.map((session, index) => renderSessionItem(session, index, sessions.length))}
        </Card.Content>
      </Card>

      <Card mode="contained" style={[styles.card, { backgroundColor: palette.surface }]}>
        <Card.Title title="Workspace files" subtitle={vcsInfo?.branch ? `Branch: ${vcsInfo.branch}` : 'Search and inspect files'} />
        <Card.Content style={styles.fileSection}>
          <View style={styles.renameRow}>
            <TextInput testID="workspace-file-search" mode="outlined" dense placeholder="Search files" value={fileQuery} onChangeText={setFileQuery} style={styles.renameInput} />
            <Button mode="contained" onPress={() => void searchWorkspaceFiles(fileQuery)}>Search</Button>
          </View>
          {workspaceFileStatuses.length > 0 ? <Text style={{ color: palette.muted }}>{workspaceFileStatuses.length} changed files</Text> : null}
          {workspaceFiles.map((path) => <List.Item key={path} title={path} onPress={() => void openWorkspaceFile(path)} />)}
          {selectedWorkspaceFile ? (
            <View style={[styles.filePreview, { borderColor: palette.border, backgroundColor: palette.background }]}>
              <Text variant="labelLarge" style={{ color: palette.text }}>{selectedWorkspaceFile.path}</Text>
              <Text selectable style={[styles.code, { color: palette.text }]}>{selectedWorkspaceFile.content.content}</Text>
            </View>
          ) : null}
        </Card.Content>
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: 16, paddingTop: 28, gap: 16, paddingBottom: 28 },
  hero: { padding: 16, borderRadius: 16, gap: 12 },
  actions: { flexDirection: 'row', gap: 12 },
  card: { borderRadius: 16 },
  listContent: { paddingHorizontal: 0 },
  filterRow: { paddingHorizontal: 16, paddingBottom: 8, alignItems: 'flex-start' },
  headerAction: { marginRight: 16, alignSelf: 'center' },
  sessionMeta: { alignItems: 'flex-end', justifyContent: 'center', gap: 4 },
  inlineActions: { flexDirection: 'row' },
  renameRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingBottom: 8 },
  renameInput: { flex: 1 },
  fileSection: { gap: 8, paddingHorizontal: 0 },
  filePreview: { margin: 16, padding: 12, borderWidth: 1, borderRadius: 12, gap: 8 },
  code: { fontFamily: 'monospace', fontSize: 12 },
});
