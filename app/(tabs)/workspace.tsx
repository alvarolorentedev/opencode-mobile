import { useState } from 'react';
import { RefreshControl, StyleSheet } from 'react-native';
import {
  Button,
  ButtonText,
  Heading,
  HStack,
  Pressable,
  ScrollView,
  Spinner,
  Text,
  VStack,
} from '@gluestack-ui/themed';
import { useRouter } from 'expo-router';

import { Colors, Fonts } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { formatRelativeTime, getSessionSubtitle } from '@/lib/opencode/format';
import { useOpencode } from '@/providers/opencode-provider';

function getProjectLabel(path: string) {
  const normalized = path.trim().replace(/\/$/, '');
  const segments = normalized.split('/').filter(Boolean);
  return segments.at(-1) || normalized || 'Project';
}

function getParentPath(path?: string) {
  if (!path) {
    return undefined;
  }

  const normalized = path.trim().replace(/\/$/, '');
  if (!normalized || normalized === '/') {
    return undefined;
  }

  const segments = normalized.split('/').filter(Boolean);
  if (segments.length <= 1) {
    return '/';
  }

  return `/${segments.slice(0, -1).join('/')}`;
}

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
  // browse server UI removed

  async function handleRefresh() {
    await Promise.all([
      refreshWorkspaceCatalog(),
      refreshSessions(),
    ]);
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
      refreshControl={
        <RefreshControl
          refreshing={isRefreshing}
          onRefresh={() => void handleRefresh()}
          tintColor={palette.tint}
        />
      }>
      <VStack style={[styles.hero, { backgroundColor: palette.card, borderColor: palette.border }]} space="md">
        <VStack space="xs">
          <Text style={[styles.eyebrow, { color: palette.accent }]}>Projects</Text>
          <Heading style={[styles.title, { color: palette.text }]}>Server-backed project contexts</Heading>
          <Text style={[styles.copy, { color: palette.muted }]}>OpenCode is the source of truth. Pick a server project or browse to a folder and use it directly as chat context.</Text>
          <Text style={[styles.connectionCopy, { color: palette.muted }]}> 
            {connection.status === 'connected'
              ? `Connected to ${connection.projectDirectory || currentProjectPath || serverRootPath || 'your OpenCode server'}`
              : connection.message}
          </Text>
        </VStack>

          <HStack style={styles.actionRow}>
            <Button
              flex={1}
              onPress={() => void refreshWorkspaceCatalog()}
              style={[styles.secondaryButton, { backgroundColor: palette.surfaceAlt, borderColor: palette.border }]}
              sx={{ ':disabled': { opacity: 0.55 } }}>
              <ButtonText style={[styles.secondaryButtonText, { color: palette.text }]}>Sync projects</ButtonText>
            </Button>
            <Button
              flex={1}
              onPress={() => void handleRefresh()}
              style={[styles.actionButton, { backgroundColor: palette.tint }]}
              sx={{ ':disabled': { opacity: 0.55 } }}>
              <ButtonText style={[styles.actionButtonText, { color: palette.background }]}>Refresh server</ButtonText>
            </Button>
          </HStack>
      </VStack>

      <VStack style={[styles.sectionCard, { backgroundColor: palette.card, borderColor: palette.border }]} space="md">
        <VStack space="xs">
          <Heading style={[styles.sectionTitle, { color: palette.text }]}>Known server projects</Heading>
          <Text style={[styles.copy, { color: palette.muted }]}>Projects returned by the SDK. Selecting one switches chat history and new sessions to that server directory.</Text>
        </VStack>

        {projects.length === 0 ? (
          <Text style={[styles.emptyCopy, { color: palette.muted }]}>No server projects available yet. Connect to OpenCode, then refresh.</Text>
        ) : null}

        {projects.map((project) => {
          const isActive = project.path === activeProject?.path;

          return (
            <Pressable
              key={project.path}
              onPress={() => selectProject(project.path)}
              style={({ pressed }) => [
                styles.projectRow,
                {
                  backgroundColor: isActive ? palette.surfaceAlt : palette.surface,
                  borderColor: isActive ? palette.tint : palette.border,
                  opacity: pressed ? 0.92 : 1,
                },
              ]}>
              <VStack space="xs" flex={1}>
                <HStack justifyContent="space-between" alignItems="center" gap={12}>
                  <Text style={[styles.projectTitle, { color: palette.text }]} numberOfLines={1}>{project.label}</Text>
                  <Text style={[styles.projectBadge, { color: isActive ? palette.tint : palette.muted }]}>
                    {isActive ? 'Active' : project.isCurrent ? 'Current' : project.source}
                  </Text>
                </HStack>
                <Text style={[styles.projectPath, { color: palette.muted }]} numberOfLines={2}>{project.path}</Text>
                {project.updatedAt ? (
                  <Text style={[styles.projectMeta, { color: palette.muted }]}>Opened {formatRelativeTime(project.updatedAt)}</Text>
                ) : null}
              </VStack>
            </Pressable>
          );
        })}
      </VStack>

        {/* Browse server folders removed: functionality was non-working and cleaned up */}

      <VStack style={[styles.sectionCard, { backgroundColor: palette.card, borderColor: palette.border }]} space="md">
        <HStack justifyContent="space-between" alignItems="center" gap={12}>
          <VStack flex={1} space="xs">
            <Heading style={[styles.sectionTitle, { color: palette.text }]}>Chats in project</Heading>
            <Text style={[styles.copy, { color: palette.muted }]}> 
              {activeProject
                ? `Showing conversations for ${activeProject.label}`
                : 'Select a project above to load its conversations.'}
            </Text>
          </VStack>
          <Button
            isDisabled={!activeProject || isCreating}
            onPress={() => void handleNewChat()}
            style={[styles.newChatButton, { backgroundColor: palette.tint }]}
            sx={{ ':disabled': { opacity: 0.55 } }}>
            {isCreating ? (
              <Spinner color={palette.background} />
            ) : (
              <ButtonText style={[styles.newChatText, { color: palette.background }]}>New chat</ButtonText>
            )}
          </Button>
        </HStack>

        {!activeProject ? (
          <Text style={[styles.emptyCopy, { color: palette.muted }]}>Pick a server project or folder to see its conversation history.</Text>
        ) : null}

        {activeProject && sessions.length === 0 ? (
          <Text style={[styles.emptyCopy, { color: palette.muted }]}>No chats in this project yet. Start one here and it will become the default chat in the `Chat` tab.</Text>
        ) : null}

        {sessions.map((session) => (
          <Pressable
            key={session.id}
            onPress={() => {
              void openSession(session.id);
              router.push('/(tabs)');
            }}
            style={({ pressed }) => [
              styles.sessionRow,
              {
                backgroundColor: palette.surface,
                borderColor: currentSessionId === session.id ? palette.tint : palette.border,
                opacity: pressed ? 0.92 : 1,
              },
            ]}>
            <HStack justifyContent="space-between" alignItems="center" gap={12}>
              <Text style={[styles.sessionTitle, { color: palette.text }]} numberOfLines={1}>{session.title || 'Untitled chat'}</Text>
              <Text style={[styles.sessionTime, { color: palette.muted }]}>{formatRelativeTime(session.time.updated)}</Text>
            </HStack>
            <Text style={[styles.sessionPreview, { color: palette.text }]} numberOfLines={2}>
              {sessionPreviewById[session.id] || getSessionSubtitle(session)}
            </Text>
            <HStack justifyContent="space-between" gap={12}>
              <Text style={[styles.sessionMeta, { color: palette.muted }]}>{getSessionSubtitle(session)}</Text>
              <Text style={[styles.sessionMeta, { color: palette.accent }]}>{sessionStatuses[session.id]?.type || 'idle'}</Text>
            </HStack>
          </Pressable>
        ))}
      </VStack>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: 16, paddingBottom: 40, gap: 14 },
  hero: { borderWidth: 1, borderRadius: 28, padding: 20 },
  eyebrow: { fontSize: 12, textTransform: 'uppercase', letterSpacing: 1, fontWeight: '700' },
  title: { fontSize: 30, lineHeight: 34, fontFamily: Fonts.display },
  copy: { fontSize: 15, lineHeight: 22 },
  connectionCopy: { fontSize: 13, lineHeight: 18 },
  actionRow: { gap: 10 },
  actionButton: { minHeight: 48, borderRadius: 18 },
  actionButtonText: { fontSize: 15, fontWeight: '700' },
  secondaryButton: { minHeight: 48, borderRadius: 18, borderWidth: 1 },
  secondaryButtonText: { fontSize: 15, fontWeight: '700' },
  sectionCard: { borderWidth: 1, borderRadius: 26, padding: 18 },
  sectionTitle: { fontSize: 22, lineHeight: 26, fontFamily: Fonts.display },
  emptyCopy: { fontSize: 15, lineHeight: 22 },
  browserPanel: { borderWidth: 1, borderRadius: 20, padding: 16 },
  browserLabel: { fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.6, fontWeight: '700' },
  browserRow: { borderWidth: 1, borderRadius: 18, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 10 },
  projectRow: { borderWidth: 1, borderRadius: 20, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 12 },
  projectTitle: { flex: 1, fontSize: 17, fontWeight: '700' },
  projectBadge: { fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6 },
  projectPath: { fontSize: 14, lineHeight: 20 },
  projectMeta: { fontSize: 13 },
  inlineButton: { minHeight: 36, borderRadius: 12, borderWidth: 1, paddingHorizontal: 12 },
  inlineButtonText: { fontSize: 13, fontWeight: '700' },
  newChatButton: { minHeight: 46, borderRadius: 16, paddingHorizontal: 16 },
  newChatText: { fontSize: 15, fontWeight: '700' },
  sessionRow: { borderWidth: 1, borderRadius: 22, padding: 16, gap: 10 },
  sessionTitle: { flex: 1, fontSize: 17, fontWeight: '700' },
  sessionTime: { fontSize: 13 },
  sessionPreview: { fontSize: 15, lineHeight: 22 },
  sessionMeta: { fontSize: 13 },
});
