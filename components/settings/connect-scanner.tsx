import { cn } from '@/lib/utils';
import { FieldDescription } from '@/components/ui/text-field';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { Spinner } from '@/components/ui/spinner';

import { CameraView, useCameraPermissions } from 'expo-camera';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AppState, Platform, StyleSheet, View } from 'react-native';




export function ConnectScanner({ onScan, enabled, hint }: { onScan: (link: string) => void; enabled: boolean; hint?: string }) {
  const { t } = useTranslation();

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
  if (cameraError) return <View className={cn(stylesClasses.screen)}>
    <FieldDescription testID="connect-camera-error" invalid={true}>{t('settings:connect.cameraUnavailable')}</FieldDescription>
    <Button onPress={() => { setReady(false); setCameraError(false); }} variant="ghost"><Text>{t('common:actions.retry')}</Text></Button>
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
        <View className={cn(stylesClasses.middle)}>
          <View style={styles.scrim} />
          <View className={cn(stylesClasses.frame, "border-primary")} />
          <View style={styles.scrim} />
        </View>
        <View style={styles.scrim} />
        <Text style={styles.hint}>{hint ?? t('settings:connect.scanHint')}</Text>
      </View>
      {!ready ? <View className={cn(stylesClasses.loading)} pointerEvents="none"><Spinner accessibilityLabel={t('settings:connect.cameraLoading')} /></View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' },
  hint: { position: 'absolute', left: 24, right: 24, bottom: 48, textAlign: 'center', color: '#FFFFFF' }
});

const stylesClasses = {
  "screen": "flex-1 justify-center p-6 gap-3",
  "middle": "flex-row h-65",
  "frame": "w-65 h-65 border-[2px] rounded-[24px]",
  "loading": "absolute top-0 left-0 right-0 bottom-0 items-center justify-center"
} as const;
