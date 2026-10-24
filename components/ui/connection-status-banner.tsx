import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';

import { useConnection, useDiagnostics } from '@/providers/opencode-contexts';
import { usePalette } from '@/hooks/use-palette';

// A compact, non-blocking transport notice. It never replaces a populated
// transcript with an error card; it only explains why fresh data or a send is
// delayed, which is the part a 4G user cannot infer from a spinner.
export function ConnectionStatusBanner() {
  const { t } = useTranslation();
  const palette = usePalette();
  const { connection } = useConnection();
  const { eventStreamStatus, transport } = useDiagnostics();
  const retryAt = transport.reconnect.retryAt;

  const message = !transport.network.online
    ? t('chat:connectionStatus.offline')
    : retryAt
      ? t('chat:connectionStatus.retrying')
      : connection.status === 'error'
        ? t('chat:connectionStatus.error')
        : connection.status === 'connecting'
          ? t('chat:connectionStatus.connecting')
          : connection.status === 'connected' && eventStreamStatus !== 'connected'
            ? t('chat:connectionStatus.polling')
            : transport.network.constrained
              ? t('chat:connectionStatus.slow')
              : undefined;

  if (!message) return null;
  const tone = !transport.network.online || connection.status === 'error'
    ? palette.danger
    : connection.status === 'connecting' || retryAt || transport.network.constrained
      ? palette.warning
      : palette.muted;
  return (
    <View testID="connection-status-banner" accessible accessibilityLiveRegion="polite" style={[styles.banner, { backgroundColor: palette.surfaceAlt, borderColor: palette.border }]}>
      <View style={[styles.dot, { backgroundColor: tone }]} />
      <Text variant="labelMedium" style={{ color: palette.text }}>{message}</Text>
      <Text variant="labelSmall" style={{ color: palette.muted }}>
        {transport.network.type}{transport.network.generation ? ` · ${transport.network.generation}` : ''}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: { flexDirection: 'row', alignItems: 'center', gap: 8, borderBottomWidth: StyleSheet.hairlineWidth, paddingHorizontal: 12, paddingVertical: 6 },
  dot: { width: 8, height: 8, borderRadius: 4 },
});
