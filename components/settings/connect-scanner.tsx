import { CameraView, useCameraPermissions } from 'expo-camera';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AppState, Platform, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Button, HelperText, Text } from 'react-native-paper';

import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export function ConnectScanner({ onScan, enabled, hint }: { onScan: (link: string) => void; enabled: boolean; hint?: string }) {
  const { t } = useTranslation();
  const palette = Colors[useColorScheme() ?? 'light'];
  const [permission] = useCameraPermissions();
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
  // Permission is owned by ConnectCameraGate; this surface only previews once
  // it is already granted.
  if (!permission?.granted) return null;
  if (cameraError) return <View style={styles.screen}>
    <HelperText testID="connect-camera-error" type="error">{t('settings:connect.cameraUnavailable')}</HelperText>
    <Button onPress={() => { setReady(false); setCameraError(false); }}>{t('common:actions.retry')}</Button>
  </View>;
  if (!active) return null;
  return (
    <View style={StyleSheet.absoluteFill}>
      <CameraView ref={camera} style={StyleSheet.absoluteFill} facing="back" barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onCameraReady={() => {
        if (Platform.OS !== 'ios') { setReady(true); return; }
        // iOS can report ready even without a capture device.
        void camera.current?.getAvailableLensesAsync().then((lenses) => {
          setCameraError(lenses.length === 0);
          setReady(lenses.length > 0);
        }).catch(() => setCameraError(true));
      }} onMountError={() => setCameraError(true)} onBarcodeScanned={({ data }) => { if (!enabled || scanned.current) return; scanned.current = true; onScan(data); }} />
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        <View style={styles.scrim} />
        <View style={styles.middle}>
          <View style={styles.scrim} />
          <View style={[styles.frame, { borderColor: palette.tint }]} />
          <View style={styles.scrim} />
        </View>
        <View style={styles.scrim} />
        <Text style={styles.hint}>{hint ?? t('settings:connect.scanHint')}</Text>
      </View>
      {!ready ? <View style={styles.loading} pointerEvents="none"><ActivityIndicator accessibilityLabel={t('settings:connect.cameraLoading')} /></View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, justifyContent: 'center', padding: 24, gap: 12 },
  scrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' },
  middle: { flexDirection: 'row', height: 260 },
  frame: { width: 260, height: 260, borderWidth: 2, borderRadius: 24 },
  hint: { position: 'absolute', left: 24, right: 24, bottom: 48, textAlign: 'center', color: '#FFFFFF' },
  loading: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
});
