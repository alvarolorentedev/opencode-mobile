import { SettingButton as Button } from './sections/setting-rows';
import Constants from 'expo-constants';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Platform, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Appbar, HelperText, Text } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ConnectCameraGate } from '@/components/settings/connect-camera-gate';
import { ConnectScanner } from '@/components/settings/connect-scanner';
import type { ConnectionProfileFormValues } from '@/components/settings/connection-profile-dialog';
import { useUpdateBlocker } from '@/hooks/use-update-blocker';
import { usePalette } from '@/hooks/use-palette';
import { LocalPairingError } from '@/lib/opencode/pairing';
import { useConnection } from '@/providers/opencode-contexts';

// Local QR setup is its own flow. It never falls back to the manual address
// form: Back returns to the chooser where Manual remains available. The camera
// fills the screen like the Cloud Link scanner; instructions and recovery are
// overlaid on top instead of being boxed into a step layout.
export function ConnectionScanFlow({ onSubmit, onDismiss, onBusyChange }: {
  onSubmit: (values: ConnectionProfileFormValues) => Promise<void> | void;
  onDismiss: () => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const insets = useSafeAreaInsets();
  useUpdateBlocker(true);
  const { t } = useTranslation();
  const { connectionProfiles } = useConnection();
  const palette = usePalette();
  const native = (Platform.OS === 'ios' || Platform.OS === 'android') && !Constants.expoConfig?.extra?.foss;
  const [message, setMessage] = useState<string>();
  // Redeemed credentials survive a failed save/connect so Retry never re-pairs.
  const [redeemed, setRedeemed] = useState<ConnectionProfileFormValues>();
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState<'pair' | 'save'>();
  const working = useRef(false);
  const request = useRef(0);
  const controller = useRef<AbortController | undefined>(undefined);
  useEffect(() => () => { request.current += 1; controller.current?.abort(); }, []);
  useEffect(() => { onBusyChange?.(Boolean(busy)); }, [busy, onBusyChange]);
  const locked = busy === 'save';
  const headerHeight = 64 + insets.top;

  function dismiss() {
    request.current += 1;
    controller.current?.abort();
    working.current = false;
    setBusy(undefined);
    onBusyChange?.(false);
    onDismiss();
  }

  function rescan() {
    setMessage(undefined);
    setRedeemed(undefined);
    setAttempt((value) => value + 1);
  }

  async function submit(values: ConnectionProfileFormValues) {
    if (working.current) return;
    working.current = true;
    setBusy('save');
    setMessage(undefined);
    const current = ++request.current;
    controller.current = new AbortController();
    try {
      await onSubmit(values);
    } catch (reason) {
      if (current !== request.current) return;
      setMessage(reason instanceof Error ? reason.message : t('settings:connection.errors.save'));
    } finally {
      if (current === request.current) { working.current = false; setBusy(undefined); }
    }
  }

  async function pair(code: string) {
    if (working.current) return;
    working.current = true;
    setBusy('pair');
    setMessage(undefined);
    const current = ++request.current;
    controller.current = new AbortController();
    try {
      const paired = await connectionProfiles.pair(code, controller.current.signal);
      if (current !== request.current) return;
      const values: ConnectionProfileFormValues = { name: '', serverUrl: paired.serverUrl, username: paired.username, password: paired.password, headers: {} };
      setRedeemed(values);
      // The provider owns save/connect; keep the redeemed credential on failure.
      setBusy('save');
      await onSubmit(values);
    } catch (reason) {
      if (current !== request.current) return;
      setMessage(reason instanceof LocalPairingError
        ? t(`settings:connection.setup.pairingErrors.${reason.reason}`)
        : reason instanceof Error ? reason.message : t('settings:connection.errors.save'));
    } finally {
      if (current === request.current) { working.current = false; setBusy(undefined); }
    }
  }

  if (!native) return null;

  return (
    <Modal visible animationType="slide" presentationStyle="fullScreen" onRequestClose={locked ? undefined : dismiss}>
      <View style={[styles.screen, { backgroundColor: palette.background }]}>
        <View style={StyleSheet.absoluteFill}>
          <ConnectCameraGate onCancel={dismiss}>
            <ConnectScanner key={attempt} enabled={!busy && !message} hint={t('settings:connection.setup.scanAutomatic')} onScan={(code) => void pair(code)} />
          </ConnectCameraGate>
        </View>
        <Appbar.Header statusBarHeight={0} style={{ backgroundColor: palette.surface, paddingTop: insets.top, height: headerHeight }}>
          <Appbar.BackAction color={palette.text} accessibilityLabel={t('common:actions.back')} disabled={Boolean(busy)} onPress={dismiss} />
          <Appbar.Content titleMaxFontSizeMultiplier={1.5} titleStyle={{ color: palette.text }} title={t('settings:connection.setup.scan')} />
        </Appbar.Header>
        <View pointerEvents="none" style={[styles.instructions, { top: headerHeight + 12 }]}>
          <View style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}>
            <Text variant="bodyLarge" style={{ color: palette.text }}>{t('settings:connection.setup.pairCommand')}</Text>
            <Text style={{ color: palette.muted }}>{t('settings:connection.setup.sameNetwork')}</Text>
          </View>
        </View>
        {busy ? <View style={styles.center} pointerEvents="none">
          <View style={[styles.card, styles.progress, { backgroundColor: palette.surface, borderColor: palette.border }]}>
            <ActivityIndicator />
            <Text style={{ color: palette.text }} testID="connection-scan-progress">{t(`settings:connect.progress.${busy === 'pair' ? 'claiming' : 'saving'}`)}</Text>
          </View>
        </View> : null}
        {message ? <View style={[styles.recovery, { bottom: Math.max(insets.bottom, 96) }]}>
          <View style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}>
            <HelperText testID="connection-scan-error" type="error" visible>{message}</HelperText>
            <View style={styles.actions}>
              {redeemed ? <Button testID="connection-scan-retry" mode="contained" disabled={Boolean(busy)} onPress={() => void submit(redeemed)}>{t('common:actions.retry')}</Button> : null}
              <Button testID="connection-scan-again" disabled={Boolean(busy)} onPress={rescan}>{t('settings:connection.setup.scanAgain')}</Button>
            </View>
          </View>
        </View> : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  instructions: { position: 'absolute', left: 24, right: 24 },
  recovery: { position: 'absolute', left: 24, right: 24 },
  center: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  card: { borderRadius: 16, borderWidth: 1, padding: 16, gap: 6 },
  progress: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
});
