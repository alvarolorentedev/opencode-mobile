import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Linking from 'expo-linking';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AppState, Platform, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Button, HelperText, Text } from 'react-native-paper';

import { usePalette } from '@/providers/theme-provider';
export function ConnectScanner({ onScan }: { onScan: (link: string) => void }) {
  const { t } = useTranslation();
  const palette = usePalette();
  const [permission, requestPermission] = useCameraPermissions();
  const [cameraError, setCameraError] = useState(false);
  const [ready, setReady] = useState(false);
  const camera = useRef<CameraView>(null);
  const scanned = useRef(false);
  const [active, setActive] = useState(AppState.currentState === 'active');
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      setActive(state === 'active');
      if (state !== 'active') setReady(false);
    });
    return () => subscription.remove();
  }, []);
  useEffect(() => {
    if (!permission?.granted || !active || ready || cameraError) return;
    // Some devices (including iOS Simulator) never emit a mount error when
    // no camera is available. Keep the deep-link recovery path reachable.
    const timer = setTimeout(() => setCameraError(true), 15_000);
    return () => clearTimeout(timer);
  }, [active, cameraError, permission?.granted, ready]);
  return (
    <View style={styles.screen}>
      {!permission ? <ActivityIndicator accessibilityLabel={t('settings:connect.cameraLoading')} /> : !permission.granted ? (
        <>
          <Text style={{ color: palette.text }}>{t('settings:connect.cameraPermission')}</Text>
          <Button onPress={() => permission.canAskAgain ? void requestPermission() : void Linking.openSettings()}>{permission.canAskAgain ? t('settings:connect.allowCamera') : t('settings:connect.openSettings')}</Button>
        </>
      ) : cameraError ? <>
        <HelperText testID="connect-camera-error" type="error">{t('settings:connect.cameraUnavailable')}</HelperText>
        <Button onPress={() => { setReady(false); setCameraError(false); }}>{t('common:actions.retry')}</Button>
      </> : active ? (
        <View style={StyleSheet.absoluteFill}>
          <CameraView ref={camera} style={StyleSheet.absoluteFill} facing="back" barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onCameraReady={() => {
            if (Platform.OS !== 'ios') { setReady(true); return; }
            // iOS can report ready even without a capture device.
            void camera.current?.getAvailableLensesAsync().then((lenses) => {
              setCameraError(lenses.length === 0);
              setReady(lenses.length > 0);
            }).catch(() => setCameraError(true));
          }} onMountError={() => setCameraError(true)} onBarcodeScanned={({ data }) => { if (!scanned.current) { scanned.current = true; onScan(data); } }} />
          {!ready ? <ActivityIndicator accessibilityLabel={t('settings:connect.cameraLoading')} /> : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({ screen: { flex: 1, justifyContent: 'center', padding: 24, gap: 12 } });
