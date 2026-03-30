import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { ActivityIndicator, Surface, Text } from 'react-native-paper';

import { ChatView } from '@/components/chat/chat-view';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useOpencode } from '@/providers/opencode-provider';

export default function ChatLandingScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const {
    activeProject,
    connection,
    currentSessionId,
    ensureActiveSession,
    isBootstrappingChat,
    isHydrated,
  } = useOpencode();

  useEffect(() => {
    if (!isHydrated || !activeProject || connection.status !== 'connected' || isBootstrappingChat || currentSessionId) {
      return;
    }

    void ensureActiveSession();
  }, [activeProject, connection.status, currentSessionId, ensureActiveSession, isBootstrappingChat, isHydrated]);

  if (currentSessionId) {
    return <ChatView />;
  }

  if (!activeProject) {
    return (
      <View style={[styles.center, { backgroundColor: palette.background }]}>
        <Surface style={[styles.panel, { backgroundColor: palette.surface }]} elevation={1}>
          <Text variant="headlineSmall" style={[styles.title, { color: palette.text }]}>Choose a workspace</Text>
          <Text variant="bodyMedium" style={[styles.copy, { color: palette.muted }]}>Select a project in the Workspaces tab to open its chat context.</Text>
        </Surface>
      </View>
    );
  }

  return (
    <View style={[styles.center, { backgroundColor: palette.background }]}>
      <Surface style={[styles.panel, { backgroundColor: palette.surface }]} elevation={1}>
        <ActivityIndicator size="large" color={palette.tint} />
        <Text variant="headlineSmall" style={[styles.title, { color: palette.text }]}>Opening chat</Text>
        <Text variant="bodyMedium" style={[styles.copy, { color: palette.muted }]}>
          {connection.status === 'error' ? connection.message : 'Loading the latest session for this workspace.'}
        </Text>
      </Surface>
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  panel: {
    width: '100%',
    padding: 24,
    gap: 12,
    borderRadius: 16,
  },
  title: {
    textAlign: 'center',
    fontWeight: '600',
  },
  copy: {
    textAlign: 'center',
    lineHeight: 22,
  },
});
