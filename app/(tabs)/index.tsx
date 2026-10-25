import { useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { ActivityIndicator, Button, Surface, Text } from 'react-native-paper';

import { ChatView } from '@/components/chat/chat-view';
import { ProjectPicker } from '@/components/ui/project-picker';
import { useChat, useConnection, useCurrentSession, useOnboarding, useProjects } from '@/providers/opencode-contexts';
import { usePalette } from '@/hooks/use-palette';

export default function ChatLandingScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const palette = usePalette();
  const { activeProject } = useProjects();
  const { connection, connect } = useConnection();
  const { currentSessionId, ensureActiveSession } = useCurrentSession();
  const { isBootstrappingChat } = useChat();
  const { isHydrated } = useOnboarding();
  const [pickerVisible, setPickerVisible] = useState(false);
  const [isReconnecting, setIsReconnecting] = useState(false);

  useEffect(() => {
    if (!isHydrated || !activeProject || connection.status !== 'connected' || isBootstrappingChat || currentSessionId) {
      return;
    }

    void ensureActiveSession();
  }, [activeProject, connection.status, currentSessionId, ensureActiveSession, isBootstrappingChat, isHydrated]);

  async function reconnect() {
    setIsReconnecting(true);
    try {
      await connect();
    } finally {
      setIsReconnecting(false);
    }
  }

  if (!isHydrated) {
    return (
      <View style={[styles.center, { backgroundColor: palette.background }]}>
        <Surface style={[styles.panel, { backgroundColor: palette.surface }]} elevation={1}>
          <ActivityIndicator size="large" color={palette.tint} />
          <Text variant="headlineSmall" style={[styles.title, { color: palette.text }]}>{t('chat:session.opening')}</Text>
          <Text variant="bodyMedium" style={[styles.copy, { color: palette.muted }]}>{t('chat:session.loading')}</Text>
        </Surface>
      </View>
    );
  }

  if (currentSessionId || (activeProject && connection.status === 'connected')) {
    return <ChatView />;
  }

  if (connection.status === 'connecting') {
    return (
      <View style={[styles.center, { backgroundColor: palette.background }]}>
        <Surface style={[styles.panel, { backgroundColor: palette.surface }]} elevation={1}>
          <ActivityIndicator size="large" color={palette.tint} />
          <Text variant="headlineSmall" style={[styles.title, { color: palette.text }]}>{t('chat:session.opening')}</Text>
          <Text variant="bodyMedium" style={[styles.copy, { color: palette.muted }]}>{t('chat:connectionStatus.connecting')}</Text>
        </Surface>
      </View>
    );
  }

  if (connection.status !== 'connected') {
    return (
      <View style={[styles.center, { backgroundColor: palette.background }]}>
        <Surface style={[styles.panel, { backgroundColor: palette.surface }]} elevation={1}>
          <Text variant="headlineSmall" style={[styles.title, { color: palette.text }]}>{t('chat:session.connectTitle')}</Text>
          <Text variant="bodyMedium" style={[styles.copy, { color: palette.muted }]}>{connection.message}</Text>
          <Button
            mode="contained"
            loading={isReconnecting}
            disabled={isReconnecting}
            onPress={() => {
              if (connection.status === 'error') void reconnect();
              else router.push('/(tabs)/settings');
            }}>
            {connection.status === 'error' ? t('common:actions.reconnect') : t('common:actions.openSettings')}
          </Button>
          {connection.status === 'error' ? (
            <Button onPress={() => router.push('/(tabs)/settings')}>{t('chat:session.connectionSettings')}</Button>
          ) : null}
        </Surface>
      </View>
    );
  }

  return (
    <>
      <View style={[styles.center, { backgroundColor: palette.background }]}>
        <Surface style={[styles.panel, { backgroundColor: palette.surface }]} elevation={1}>
          <Text variant="headlineSmall" style={[styles.title, { color: palette.text }]}>{t('chat:session.chooseProject')}</Text>
          <Text variant="bodyMedium" style={[styles.copy, { color: palette.muted }]}>{t('chat:session.selectProject')}</Text>
          <Button mode="contained" icon="folder-open-outline" onPress={() => setPickerVisible(true)}>
            {t('chat:session.openProject')}
          </Button>
        </Surface>
      </View>
      <ProjectPicker visible={pickerVisible} onClose={() => setPickerVisible(false)} testID="chat-landing-project-picker" />
    </>
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
