import { useIsFocused } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AppState, KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Appbar, Button, HelperText, Text } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ConnectionSetupForm } from '@/components/settings/connection-setup-form';
import { ConnectScanner } from '@/components/settings/connect-scanner';
import { ConnectSubscription } from '@/components/settings/connect-subscription';
import { OverlaySheet } from '@/components/ui/overlay-sheet';
import { TextInput } from '@/components/ui/text-input';
import { usePalette } from '@/providers/theme-provider';
import type { ConnectSetup } from '@/providers/use-connect-state';

export function ConnectEntry(props: { setup: ConnectSetup; onConnected: () => void; onClose: () => void; onManage: () => void }) {
  const [choosing, setChoosing] = useState(false);
  const [busy, setBusy] = useState(false);
  const { t } = useTranslation();
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  if (!choosing) return <ConnectPairing {...props} onClose={() => setChoosing(true)} />;
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
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const focused = useIsFocused();
  const [active, setActive] = useState(AppState.currentState === 'active');
  const [sheet, setSheet] = useState<'link'>();
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
  const subscription = focused && setup.initialization !== 'loading' && !setup.entitled;
  const canScan = setup.initialization === 'ready' && setup.entitled && !pending && !sheet && !setup.error && !scanPending;
  function close() {
    if (pending || scanPending) return;
    void setup.cancelPairing().then((ok) => { if (ok) onClose(); });
  }
  async function scan(value: string) {
    setScanPending(true);
    try { await setup.pairLink(value); } finally { setScanPending(false); }
  }
  return <KeyboardAvoidingView testID="connect-panel" style={[styles.screen, { backgroundColor: palette.background }]} behavior="padding">
    {canScan && focused && active && Platform.OS !== 'web' ? <View style={StyleSheet.absoluteFill}><ConnectScanner onScan={(value) => void scan(value)} /></View> : null}
    <Appbar.Header statusBarHeight={0} style={{ backgroundColor: palette.surface, paddingTop: insets.top, height: 64 + insets.top }}>
      <Appbar.BackAction color={palette.text} disabled={pending || scanPending} accessibilityLabel={t('common:actions.back')} onPress={close} />
      <Appbar.Content titleStyle={{ color: palette.text }} title={t('settings:connect.entry')} />
    </Appbar.Header>
    <View pointerEvents="box-none" style={styles.body}>
      <Text style={[styles.instruction, { backgroundColor: palette.surface, color: palette.text }]}>{t('settings:connect.scanHint')}</Text>
      {setup.entitled ? <Text testID="connect-subscription-active" style={[styles.instruction, { backgroundColor: palette.surface, color: palette.text }]}>{t('settings:connect.subscriptionActive')}</Text> : null}
      {pending || scanPending || setup.initialization === 'loading' ? <View style={[styles.progress, { backgroundColor: palette.surface }]}><ActivityIndicator /><Text style={{ color: palette.text }} testID="connect-progress">{t(`settings:connect.progress.${setup.phase}`)}</Text></View> : null}
      {setup.entitled ? <Button testID="connect-manage" disabled={pending} onPress={onManage}>{t('settings:connect.machines')}</Button> : null}
      <View style={[styles.bottom, { paddingBottom: Math.max(insets.bottom, 12) }]}>
        <Button mode="contained-tonal" testID="connect-link-options" disabled={pending || scanPending} onPress={() => setSheet('link')}>{t('settings:connect.openLink')}</Button>
      </View>
    </View>
    <OverlaySheet visible={subscription && !sheet} title={t('settings:connect.title')} onClose={close} fitContent testID="connect-subscription-sheet">
      <ConnectSubscription setup={setup} />
      {setup.busy ? <Text style={{ color: palette.text }} testID="connect-subscription-progress">{t(`settings:connect.progress.${setup.phase}`)}</Text> : null}
      {setup.error ? <HelperText testID="connect-error" type="error">{setup.error}</HelperText> : null}
      {setup.notice ? <HelperText testID="connect-notice" type="info">{setup.notice}</HelperText> : null}
      {setup.canRetry ? <Button testID="connect-retry" disabled={setup.busy} onPress={() => void setup.retry()}>{t('common:actions.retry')}</Button> : null}
    </OverlaySheet>
    <OverlaySheet visible={focused && sheet === 'link'} title={t('settings:connect.openLink')} onClose={() => setSheet(undefined)} fitContent testID="connect-link-sheet">
      <TextInput testID="connect-pairing-link" label={t('settings:connect.pairingLink')} value={link} onChangeText={setLink} autoCapitalize="none" autoCorrect={false} disabled={pending} />
      <Button testID="connect-open-link" disabled={pending || !link.trim()} onPress={() => { setSheet(undefined); void scan(link); setLink(''); }}>{t('settings:connect.openLink')}</Button>
    </OverlaySheet>
    <OverlaySheet visible={focused && !sheet && !subscription && Boolean(setup.error || setup.notice)} title={t('settings:connect.title')} onClose={() => { setup.dismissError(); }} fitContent testID="connect-error-sheet">
      {setup.error ? <HelperText testID="connect-error" type="error">{setup.error}</HelperText> : null}
      {setup.notice ? <HelperText testID="connect-notice" type="info">{setup.notice}</HelperText> : null}
      {setup.canRetry ? <Button testID="connect-retry" disabled={setup.busy} onPress={() => void setup.retry()}>{t('common:actions.retry')}</Button> : null}
      {setup.savedProfile ? <Button testID="connect-retry-connection" disabled={setup.busy} onPress={() => void setup.connectProfile(setup.savedProfile!)}>{t('common:actions.reconnect')}</Button> : null}
      <Button disabled={pending} onPress={() => { setup.dismissError(); setSheet('link'); }}>{t('settings:connect.openLink')}</Button>
    </OverlaySheet>
  </KeyboardAvoidingView>;
}
const styles = StyleSheet.create({
  screen: { flex: 1 }, body: { flex: 1, padding: 20 },
  instruction: { padding: 12, borderRadius: 12, alignSelf: 'center', marginBottom: 8 },
  progress: { padding: 20, borderRadius: 12, gap: 12, alignItems: 'center', marginTop: 24 },
  bottom: { marginTop: 'auto', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12, paddingBottom: 12 },
});
