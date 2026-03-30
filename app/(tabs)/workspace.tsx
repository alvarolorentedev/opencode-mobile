import { useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import {
  ActivityIndicator,
  Button,
  Card,
  Divider,
  List,
  Surface,
  Text,
} from 'react-native-paper';

import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { formatRelativeTime, getSessionSubtitle } from '@/lib/opencode/format';
import { useOpencode } from '@/providers/opencode-provider';

export default function WorkspaceScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const {
    activeProject,
    connection,
    createSession,
    currentProjectPath,
    currentSessionId,
    isRefreshingSessions,
    isRefreshingWorkspaceCatalog,
    openSession,
    projects,
    refreshSessions,
    refreshWorkspaceCatalog,
    selectProject,
    serverRootPath,
    sessionPreviewById,
    sessionStatuses,
    sessions,
  } = useOpencode();
  const [isCreating, setIsCreating] = useState(false);

  const isRefreshing = isRefreshingSessions || isRefreshingWorkspaceCatalog;

  async function handleRefresh() {
    await Promise.all([refreshWorkspaceCatalog(), refreshSessions()]);
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
          <Button mode="outlined" onPress={() => void refreshWorkspaceCatalog()}>Sync</Button>
          <Button mode="contained" onPress={() => void handleRefresh()}>Refresh</Button>
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
                      {isActive ? 'Active' : project.isCurrent ? 'Current' : project.source}
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
            isCreating ? <ActivityIndicator style={styles.headerAction} color={palette.tint} /> : <Button onPress={() => void handleNewChat()} disabled={!activeProject}>New</Button>
          }
        />
        <Card.Content style={styles.listContent}>
          {!activeProject ? <Text style={{ color: palette.muted }}>Select a project first.</Text> : null}
          {activeProject && sessions.length === 0 ? <Text style={{ color: palette.muted }}>No chats in this workspace yet.</Text> : null}
          {sessions.map((session, index) => (
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
                  </View>
                )}
              />
              {index < sessions.length - 1 ? <Divider /> : null}
            </View>
          ))}
        </Card.Content>
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: 16, gap: 16, paddingBottom: 28 },
  hero: { padding: 16, borderRadius: 16, gap: 12 },
  actions: { flexDirection: 'row', gap: 12 },
  card: { borderRadius: 16 },
  listContent: { paddingHorizontal: 0 },
  headerAction: { marginRight: 16, alignSelf: 'center' },
  sessionMeta: { alignItems: 'flex-end', justifyContent: 'center', gap: 4 },
});
