import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { ActivityIndicator, Button, Surface, Text } from 'react-native-paper';

import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useOpencode } from '@/providers/opencode-provider';

export default function SessionDeepLinkScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const router = useRouter();
  const params = useLocalSearchParams();
  const { isHydrated, openDeepLinkSession } = useOpencode();
  const rawSessionId = Array.isArray(params.id) ? params.id[0] : params.id;
  const sessionId = rawSessionId?.trim();
  const rawProject = Array.isArray(params.project) ? params.project[0] : params.project;
  const projectPath = rawProject?.trim() || undefined;
  const [error, setError] = useState<string>();
  const missingSessionIdError = sessionId ? undefined : 'This session link is missing a session ID.';
  const displayError = error ?? missingSessionIdError;

  useEffect(() => {
    if (!sessionId) {
      return;
    }

    if (!isHydrated) {
      return;
    }

    const controller = new AbortController();
    let isActive = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- clear the previous attempt's error before retrying.
    setError(undefined);
    void openDeepLinkSession({ sessionId, projectPath }, controller.signal)
      .then((result) => {
        if (!isActive) return;
        if (result.ok) {
          router.replace('/(tabs)');
          return;
        }
        setError(result.error);
      })
      .catch(() => {
        if (isActive) setError('Could not open this session link.');
      });

    return () => {
      isActive = false;
      controller.abort();
    };
  }, [isHydrated, openDeepLinkSession, projectPath, router, sessionId]);

  const title = displayError ? 'Could not open session' : 'Opening session';
  const copy = displayError
    ? displayError
    : 'Loading this session from your OpenCode server.';

  return (
    <View style={[styles.center, { backgroundColor: palette.background }]}>
      <Surface style={[styles.panel, { backgroundColor: palette.surface }]} elevation={1}>
        {!displayError && <ActivityIndicator size="large" color={palette.tint} />}
        <Text variant="headlineSmall" style={[styles.title, { color: palette.text }]}>{title}</Text>
        <Text variant="bodyMedium" style={[styles.copy, { color: palette.muted }]}>{copy}</Text>
        {displayError && (
          <Button mode="contained" onPress={() => router.replace('/(tabs)')} style={styles.button}>
            Back to chat
          </Button>
        )}
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
  button: {
    marginTop: 8,
  },
});
