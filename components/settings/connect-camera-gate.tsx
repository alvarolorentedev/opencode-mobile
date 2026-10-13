import { useCameraPermissions } from 'expo-camera';
import { useEffect, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, StyleSheet, View } from 'react-native';
import { ActivityIndicator } from 'react-native-paper';

/**
 * Resolves camera permission before a requested scanner renders. Denial returns
 * to the caller's previous surface. Web never requests camera permission.
 */
export function ConnectCameraGate({ onCancel, children }: { onCancel: () => void; children: ReactNode }) {
  const { t } = useTranslation();
  const native = Platform.OS === 'ios' || Platform.OS === 'android';
  const [permission] = useCameraPermissions({ request: native });
  useEffect(() => {
    if (native && permission && !permission.granted) onCancel();
  }, [native, onCancel, permission]);
  if (!native || permission?.granted) return <>{children}</>;
  return <View style={styles.screen}><ActivityIndicator accessibilityLabel={t('settings:connect.cameraLoading')} /></View>;
}

const styles = StyleSheet.create({ screen: { flex: 1, alignItems: 'center', justifyContent: 'center' } });
