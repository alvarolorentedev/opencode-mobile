import { useIsFocused } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AppState, KeyboardAvoidingView, Linking, Platform, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Appbar, Button, HelperText, Text } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ConnectCameraGate } from '@/components/settings/connect-camera-gate';
import { ConnectionSetupForm } from '@/components/settings/connection-setup-form';
import { ConnectScanner } from '@/components/settings/connect-scanner';
import { ConnectSubscription } from '@/components/settings/connect-subscription';
import { OverlaySheet } from '@/components/ui/overlay-sheet';
import { TextInput } from '@/components/ui/text-input';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { CONNECT_LEARN_MORE_URL } from '@/lib/connect';
import type { ConnectSetup } from '@/providers/use-connect-state';

export function ConnectEntry(props: { setup: ConnectSetup; onConnected: () => void; onClose: () => void; onManage: () => void; deepLink?: boolean }) {
  const [choosing, setChoosing] = useState(false);
  const [busy, setBusy] = useState(false);
  const { t } = useTranslation();
  const palette = Colors[useColorScheme() ?? 'light'];
  const insets = useSafeAreaInsets();
  const { deepLink, ...rest } = props;
  if (!choosing) {
    const pairing = <ConnectPairing {...rest} onClose={() => setChoosing(true)} />;
    // Deep links already carry the QR and auto-pair; they must not race a
    // camera permission prompt against a completed navigation. Web has no camera.
    return deepLink || Platform.OS === 'web' ? pairing : <ConnectCameraGate onCancel={props.onClose}>{pairing}</ConnectCameraGate>;
  }
  return <View style={[styles.screen, { backgroundColor: palette.background }]}>
    <Appbar.Header statusBarHeight={0} style={{ backgroundColor: palette.surface, paddingTop: insets.top, height: 64 + insets.top }}>
      <Appbar.BackAction color={palette.text} disabled={busy} accessibilityLabel={t('common:actions.back')} onPress={props.onClose} />
      <Appbar.Content titleStyle={{ color: palette.text }} title={t('settings:connection.addConnection')} />
    </Appbar.Header>
    <View style={{ padding: 20 }}><ConnectionSetupForm onBusyChange={setBusy} onPair={() => setChoosing(false)} onConnected={props.onConnected} /></View>
  </View>;
}

export function ConnectPairing({ setup, onConnected, onClose, onManage }: { setup: ConnectSetup; onConnected: () => void; onClose: () => void; onManage: () => void }) {
  const { t } = useTranslation();
  const palette = Colors[useColorScheme() ?? 'light'];
  const insets = useSafeAreaInsets();
  const focused = useIsFocused();
  const [active, setActive] = useState(AppState.currentState === 'active');
  const [sheet, setSheet] = useState<'options'>();
  const [link, setLink] = useState('');
  const [scanPending, setScanPending] = useState(false);
  // A previous successful pairing must not redirect a newly opened scanner.
  const connected = useRef(setup.phase === 'paired');
  useEffect(() => {
    const listener = AppState.addEventListener('change', (state) => setActive(state === 'active'));
    return () => listener.remove();
  }, []);
  useEffect(() => {
    if (setup.phase !== 'paired') connected.current = false;
    if (focused && setup.phase === 'paired' && !setup.error && !connected.current) { connected.current = true; onConnected(); }
  }, [focused, onConnected, setup.error, setup.phase]);
  const pending = setup.busy || ['purchasing', 'pending'].includes(setup.phase);
  const delayed = setup.phase === 'delayed';
  const subscription = focused && setup.initialization !== 'loading' && !setup.entitled;
  const canScan = setup.initialization === 'ready' && !pending && !delayed && !sheet && !setup.error && !scanPending;
  function close() {
    if (pending || scanPending) return;
    void setup.cancelPairing().then((ok) => { if (ok) onClose(); });
  }
  async function scan(value: string) {
    // Scanning without an active entitlement never pairs; the subscription
    // sheet gates access instead.
    if (!setup.entitled) return;
    setScanPending(true);
    try { await setup.pairLink(value); } finally { setScanPending(false); }
  }
  return <KeyboardAvoidingView testID="connect-panel" style={[styles.screen, { backgroundColor: palette.background }]} behavior="padding">
    {canScan && focused && active && Platform.OS !== 'web' ? <View style={StyleSheet.absoluteFill}><ConnectScanner enabled={setup.entitled} onScan={(value) => void scan(value)} /></View> : null}
    <Appbar.Header statusBarHeight={0} style={{ backgroundColor: palette.surface, paddingTop: insets.top, height: 64 + insets.top }}>
      <Appbar.BackAction color={palette.text} disabled={pending || scanPending} accessibilityLabel={t('common:actions.back')} onPress={close} />
      <Appbar.Content titleStyle={{ color: palette.text }} title={t('settings:connect.entry')} />
      <Appbar.Action icon="monitor-multiple" color={palette.text} testID="connect-options" accessibilityLabel={t('settings:connect.options')} disabled={pending || scanPending} onPress={() => setSheet('options')} />
    </Appbar.Header>
    {pending || scanPending || setup.initialization === 'loading' ? <View style={[styles.progress, { backgroundColor: palette.surface }]}><ActivityIndicator /><Text style={{ color: palette.text }} testID="connect-progress">{t(`settings:connect.progress.${setup.phase}`)}</Text></View> : null}
    <OverlaySheet visible={subscription && !sheet} title={t('settings:connect.title')} onClose={close} fitContent testID="connect-subscription-sheet">
      <ConnectSubscription setup={setup} />
      {setup.busy ? <Text style={{ color: palette.text }} testID="connect-subscription-progress">{t(`settings:connect.progress.${setup.phase}`)}</Text> : null}
      {setup.error ? <HelperText testID="connect-error" type="error">{setup.error}</HelperText> : null}
      {setup.notice ? <HelperText testID="connect-notice" type="info">{setup.notice}</HelperText> : null}
      {setup.canRetry ? <Button testID="connect-retry" disabled={setup.busy} onPress={() => void setup.retry()}>{t('common:actions.retry')}</Button> : null}
    </OverlaySheet>
    <OverlaySheet visible={focused && sheet === 'options'} title={t('settings:connect.options')} onClose={() => setSheet(undefined)} fitContent testID="connect-options-sheet">
      <TextInput testID="connect-pairing-link" label={t('settings:connect.pairingLink')} value={link} onChangeText={setLink} autoCapitalize="none" autoCorrect={false} disabled={pending} />
      <Button testID="connect-open-link" disabled={pending || !link.trim()} onPress={() => { setSheet(undefined); void scan(link); setLink(''); }}>{t('settings:connect.openLink')}</Button>
      {setup.entitled ? <Button testID="connect-manage" icon="monitor-multiple" disabled={pending} onPress={() => { setSheet(undefined); onManage(); }}>{t('settings:connect.machines')}</Button> : null}
      <Button testID="connect-learn-more" icon="open-in-new" onPress={() => void Linking.openURL(CONNECT_LEARN_MORE_URL).catch(() => undefined)}>{t('settings:connect.learnMore')}</Button>
    </OverlaySheet>
    <OverlaySheet visible={focused && !pending && !sheet && !subscription && Boolean(delayed || setup.error || setup.notice)} title={t('settings:connect.title')} onClose={() => { if (delayed) void setup.cancelPairing(); else setup.dismissError(); }} fitContent testID="connect-error-sheet">
      {delayed ? <Text testID="connect-delayed" style={{ color: palette.text }}>{t('settings:connect.progress.delayed')}</Text> : null}
      {setup.error ? <HelperText testID="connect-error" type="error">{setup.error}</HelperText> : null}
      {setup.notice ? <HelperText testID="connect-notice" type="info">{setup.notice}</HelperText> : null}
      {setup.canRetry ? <Button testID="connect-retry" disabled={setup.busy} onPress={() => void setup.retry()}>{t('common:actions.retry')}</Button> : null}
      {setup.savedProfile && !delayed ? <Button testID="connect-retry-connection" disabled={setup.busy} onPress={() => void setup.connectProfile(setup.savedProfile!)}>{t('common:actions.reconnect')}</Button> : null}
      {delayed ? <Button testID="connect-rescan" onPress={() => void setup.cancelPairing()}>{t('settings:connect.scanNewQr')}</Button> : <Button disabled={pending} onPress={() => { setup.dismissError(); setSheet('options'); }}>{t('settings:connect.openLink')}</Button>}
    </OverlaySheet>
  </KeyboardAvoidingView>;
}
const styles = StyleSheet.create({
  screen: { flex: 1 },
  progress: { padding: 20, borderRadius: 12, gap: 12, alignItems: 'center', alignSelf: 'center', marginTop: 24 },
});
