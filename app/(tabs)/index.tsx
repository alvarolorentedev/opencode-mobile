import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { ActivityIndicator, Surface, Text } from 'react-native-paper';

import { ChatView } from '@/components/chat/chat-view';
import { useChat, useConnection, useCurrentSession, useOnboarding, useProjects } from '@/providers/opencode-contexts';
import { usePalette } from '@/hooks/use-palette';

export default function ChatLandingScreen() {
  const { t } = useTranslation();
  const palette = usePalette();
  const { activeProject } = useProjects();
  const { connection } = useConnection();
  const { currentSessionId, ensureActiveSession } = useCurrentSession();
  const { isBootstrappingChat } = useChat();
  const { isHydrated } = useOnboarding();

  useEffect(() => {
    if (!isHydrated || !activeProject || connection.status !== 'connected' || isBootstrappingChat || currentSessionId) {
      return;
    }

    void ensureActiveSession();
  }, [activeProject, connection.status, currentSessionId, ensureActiveSession, isBootstrappingChat, isHydrated]);

  if (currentSessionId || (isHydrated && activeProject && connection.status === 'connected')) {
    return <ChatView />;
  }

  if (!activeProject) {
    return (
      <View style={[styles.center, { backgroundColor: palette.background }]}>
        <Surface style={[styles.panel, { backgroundColor: palette.surface }]} elevation={1}>
          <Text variant="headlineSmall" style={[styles.title, { color: palette.text }]}>{t('chat:session.chooseProject')}</Text>
          <Text variant="bodyMedium" style={[styles.copy, { color: palette.muted }]}>{t('chat:session.selectProject')}</Text>
        </Surface>
      </View>
    );
  }

  return (
    <View style={[styles.center, { backgroundColor: palette.background }]}>
      <Surface style={[styles.panel, { backgroundColor: palette.surface }]} elevation={1}>
        <ActivityIndicator size="large" color={palette.tint} />
        <Text variant="headlineSmall" style={[styles.title, { color: palette.text }]}>{t('chat:session.opening')}</Text>
        <Text variant="bodyMedium" style={[styles.copy, { color: palette.muted }]}>
          {connection.status === 'error' ? connection.message : t('chat:session.loading')}
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
