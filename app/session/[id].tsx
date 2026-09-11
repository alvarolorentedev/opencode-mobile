import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
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
  const targetKey = JSON.stringify([sessionId, projectPath]);
  const [error, setError] = useState<string>();
  const startedTargetRef = useRef<string | undefined>(undefined);
  const activeTargetRef = useRef(targetKey);
  activeTargetRef.current = targetKey;

  useEffect(() => {
    if (!sessionId) {
      setError('This session link is missing a session ID.');
      return;
    }

    if (startedTargetRef.current === targetKey || !isHydrated) {
      return;
    }

    startedTargetRef.current = targetKey;
    setError(undefined);
    void openDeepLinkSession({ sessionId, projectPath })
      .then((result) => {
        if (activeTargetRef.current !== targetKey) return;
        if (result.ok) {
          router.replace('/(tabs)');
          return;
        }
        setError(result.error);
      })
      .catch(() => {
        if (activeTargetRef.current === targetKey) setError('Could not open this session link.');
      });
  }, [isHydrated, openDeepLinkSession, projectPath, router, sessionId, targetKey]);

  const title = error ? 'Could not open session' : 'Opening session';
  const copy = error
    ? error
    : 'Loading this session from your OpenCode server.';

  return (
    <View style={[styles.center, { backgroundColor: palette.background }]}>
      <Surface style={[styles.panel, { backgroundColor: palette.surface }]} elevation={1}>
        {!error && <ActivityIndicator size="large" color={palette.tint} />}
        <Text variant="headlineSmall" style={[styles.title, { color: palette.text }]}>{title}</Text>
        <Text variant="bodyMedium" style={[styles.copy, { color: palette.muted }]}>{copy}</Text>
        {error && (
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
