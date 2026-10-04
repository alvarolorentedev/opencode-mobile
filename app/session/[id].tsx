import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { ActivityIndicator, Button, Surface, Text } from 'react-native-paper';

import { useAppTheme } from '@/providers/theme-provider';
import { useOnboarding, useSessions } from '@/providers/opencode-contexts';

export default function SessionDeepLinkScreen() {
  const { t } = useTranslation();
  const { palette } = useAppTheme();
  const router = useRouter();
  const params = useLocalSearchParams();
  const { isHydrated } = useOnboarding();
  const { openDeepLinkSession } = useSessions();
  const rawSessionId = Array.isArray(params.id) ? params.id[0] : params.id;
  const sessionId = rawSessionId?.trim();
  const rawProject = Array.isArray(params.project) ? params.project[0] : params.project;
  const projectPath = rawProject?.trim() || undefined;
  const [error, setError] = useState<string>();
  const missingSessionIdError = sessionId ? undefined : t('chat:deepLink.missingSessionId');
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
        if (isActive) setError(t('chat:deepLink.couldNotOpen'));
      });

    return () => {
      isActive = false;
      controller.abort();
    };
  }, [isHydrated, openDeepLinkSession, projectPath, router, sessionId, t]);

  const title = displayError ? t('chat:deepLink.errorTitle') : t('chat:deepLink.openingTitle');
  const copy = displayError
    ? displayError
    : t('chat:deepLink.loading');

  return (
    <View style={[styles.center, { backgroundColor: palette.background }]}>
      <Surface style={[styles.panel, { backgroundColor: palette.surface }]} elevation={1}>
        {!displayError && <ActivityIndicator size="large" color={palette.tint} />}
        <Text variant="headlineSmall" style={[styles.title, { color: palette.text }]}>{title}</Text>
        <Text variant="bodyMedium" style={[styles.copy, { color: palette.muted }]}>{copy}</Text>
        {displayError && (
          <Button mode="contained" onPress={() => router.replace('/(tabs)')} style={styles.button}>
            {t('chat:deepLink.backToChat')}
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
