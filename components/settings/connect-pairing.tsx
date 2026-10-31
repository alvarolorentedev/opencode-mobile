import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { HeaderTitle, ScreenHeader } from '@/components/ui/screen-header';
import { Spinner } from '@/components/ui/spinner';
import { Text } from '@/components/ui/text';
import { FieldDescription, TextField } from '@/components/ui/text-field';

import { useIsFocused } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AppState, KeyboardAvoidingView, Linking, Platform, StyleSheet, View } from 'react-native';

import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ConnectCameraGate } from '@/components/settings/connect-camera-gate';
import { ConnectionSetupForm } from '@/components/settings/connection-setup-form';
import { ConnectScanner } from '@/components/settings/connect-scanner';
import { ConnectSubscription } from '@/components/settings/connect-subscription';
import { ConnectOnboarding } from '@/components/settings/connect-onboarding';
import { OverlaySheet } from '@/components/ui/overlay-sheet';

import { useDismissOnBack } from '@/hooks/use-dismiss-on-back';
import { useUpdateBlocker } from '@/hooks/use-update-blocker';
import { usePalette } from '@/hooks/use-palette';
import { CONNECT_LEARN_MORE_URL } from '@/lib/connect';
import type { ConnectSetup } from '@/providers/use-connect-state';

export function ConnectEntry(props: { setup: ConnectSetup; onConnected: () => void; onClose: () => void; onManage: () => void; deepLink?: boolean }) {
  const [choosing, setChoosing] = useState(false);
  const [startedFromChooser, setStartedFromChooser] = useState(false);
  const [busy, setBusy] = useState(false);
  const { t } = useTranslation();
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const { deepLink, ...rest } = props;
  if (!choosing) {
    return <ConnectPairing {...rest} guided={!deepLink || startedFromChooser} onClose={() => setChoosing(true)} />;
  }
  return <View className={cn(stylesClasses.screen, "bg-background")}>
    <ScreenHeader style={{ backgroundColor: palette.surface, paddingTop: insets.top, height: 64 + insets.top }} safeArea={false}><Button disabled={busy} accessibilityLabel={t('common:actions.back')} onPress={props.onClose} variant="ghost" size="icon"><Icon name={"arrow-left"} size={24} color={palette.text} /></Button><HeaderTitle title={t('settings:connection.addConnection')} textStyle={{ color: palette.text }} maxFontSizeMultiplier={1.5}></HeaderTitle></ScreenHeader>
    <View className={cn("p-5")}><ConnectionSetupForm onBusyChange={setBusy} onPair={() => { setStartedFromChooser(true); setChoosing(false); }} onConnected={props.onConnected} /></View>
  </View>;
}

export function ConnectPairing({ setup, onConnected, onClose, onManage, guided = false }: { setup: ConnectSetup; onConnected: () => void; onClose: () => void; onManage: () => void; guided?: boolean }) {
  const { t } = useTranslation();
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const focused = useIsFocused();
  const [active, setActive] = useState(AppState.currentState === 'active');
  const [sheet, setSheet] = useState<'options'>();
  const [link, setLink] = useState('');
  const [scanPending, setScanPending] = useState(false);
  const [selectedStep, setStep] = useState<number>();
  const [scanning, setScanning] = useState(false);
  const step = selectedStep ?? (setup.entitled && setup.initialization === 'ready' ? 4 : 1);
  const pending = setup.busy || ['purchasing', 'pending'].includes(setup.phase);
  if (guided && step === 3 && setup.entitled && !pending && setup.phase === 'idle' && !setup.error) setStep(4);
  if (guided && step === 4 && !setup.entitled && setup.initialization === 'ready' && !pending) { setScanning(false); setStep(3); }
  const overview = guided && !scanning;
  useUpdateBlocker(focused);
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
  const delayed = setup.phase === 'delayed';
  const subscription = !guided && focused && setup.initialization !== 'loading' && !setup.entitled;
  const canScan = setup.initialization === 'ready' && !pending && !delayed && !sheet && !setup.error && !scanPending;
  function close() {
    if (pending || scanPending) return;
    void setup.cancelPairing().then((ok) => { if (ok) onClose(); });
  }
  function back() {
    if (pending || scanPending) return;
    if (guided && scanning) { void setup.cancelPairing().then((ok) => { if (ok) setScanning(false); }); return; }
    if (overview && step > 1) { setStep(step === 4 && setup.entitled ? 2 : step - 1); return; }
    close();
  }
  useDismissOnBack(guided && focused && !sheet && !(step === 4 && (setup.error || setup.notice || delayed)), back);
  async function scan(value: string) {
    // The provider must have verified access before either pairing entry can claim.
    if (!setup.entitled) return;
    setScanPending(true);
    try { await setup.pairLink(value); } finally { setScanPending(false); }
  }
  return <KeyboardAvoidingView testID="connect-panel" className={cn(stylesClasses.screen, "bg-background")} behavior="padding">
    {canScan && !overview && focused && active && Platform.OS !== 'web' ? <View style={StyleSheet.absoluteFill}>{guided ? <ConnectCameraGate onCancel={() => setScanning(false)}><ConnectScanner enabled={setup.entitled} onScan={(value) => void scan(value)} /></ConnectCameraGate> : <ConnectScanner enabled={setup.entitled} onScan={(value) => void scan(value)} />}</View> : null}
    <ScreenHeader style={{ backgroundColor: palette.surface, paddingTop: insets.top, height: 64 + insets.top }} safeArea={false}><Button disabled={pending || scanPending} accessibilityLabel={t('common:actions.back')} onPress={back} variant="ghost" size="icon"><Icon name={"arrow-left"} size={24} color={palette.text} /></Button><HeaderTitle title={t(guided ? 'settings:connect.title' : 'settings:connect.entry')} textStyle={[{ color: palette.text }, guided && { fontSize: 18, textAlign: 'center' }]} maxFontSizeMultiplier={1.5}></HeaderTitle>{overview ? <Button testID="connect-close" accessibilityLabel={t('common:actions.close')} disabled={pending || scanPending} onPress={close} variant="ghost" size="icon"><Icon name={"close"} size={24} color={palette.text} /></Button> : <Button testID="connect-options" accessibilityLabel={t('settings:connect.options')} disabled={pending || scanPending} onPress={() => setSheet('options')} variant="ghost" size="icon"><Icon name={"monitor-multiple"} size={24} color={palette.text} /></Button>}</ScreenHeader>
    {overview ? <ConnectOnboarding step={step} setup={setup} onNext={() => setStep(step === 2 ? (setup.entitled ? 4 : 3) : step + 1)} onScan={() => setScanning(true)} onOptions={() => setSheet('options')} /> : null}
    {!overview && (pending || scanPending || setup.initialization === 'loading') ? <View className={cn(stylesClasses.progress, "bg-surface")}><Spinner /><Text className={cn("text-foreground")} testID="connect-progress">{t(`settings:connect.progress.${setup.phase}`)}</Text></View> : null}
    <OverlaySheet visible={subscription && !sheet} title={t('settings:connect.title')} onClose={close} fitContent testID="connect-subscription-sheet">
      <ConnectSubscription setup={setup} />
      {setup.busy ? <Text className={cn("text-foreground")} testID="connect-subscription-progress">{t(`settings:connect.progress.${setup.phase}`)}</Text> : null}
      {setup.error ? <FieldDescription testID="connect-error" invalid={true}>{setup.error}</FieldDescription> : null}
      {setup.notice ? <FieldDescription testID="connect-notice" invalid={false}>{setup.notice}</FieldDescription> : null}
      {setup.canRetry ? <Button testID="connect-retry" disabled={setup.busy} onPress={() => void setup.retry()} variant="ghost"><Text>{t('common:actions.retry')}</Text></Button> : null}
    </OverlaySheet>
    <OverlaySheet visible={focused && sheet === 'options'} title={t('settings:connect.options')} onClose={() => setSheet(undefined)} fitContent testID="connect-options-sheet">
      <TextField testID="connect-pairing-link" label={t('settings:connect.pairingLink')} value={link} onChangeText={setLink} autoCapitalize="none" autoCorrect={false} disabled={pending}></TextField>
      <Button testID="connect-open-link" disabled={pending || !link.trim()} onPress={() => { setSheet(undefined); void scan(link); setLink(''); }} variant="ghost"><Text>{t('settings:connect.openLink')}</Text></Button>
      {setup.entitled ? <Button testID="connect-manage" disabled={pending} onPress={() => { setSheet(undefined); onManage(); }} variant="ghost"><Icon name={"monitor-multiple"} size={20} /><Text>{t('settings:connect.machines')}</Text></Button> : null}
      <Button testID="connect-learn-more" onPress={() => void Linking.openURL(CONNECT_LEARN_MORE_URL).catch(() => undefined)} variant="ghost"><Icon name={"open-in-new"} size={20} /><Text>{t('settings:connect.learnMore')}</Text></Button>
    </OverlaySheet>
    <OverlaySheet visible={focused && !pending && !sheet && !subscription && (!overview || step === 4) && Boolean(delayed || setup.error || setup.notice)} title={t('settings:connect.title')} onClose={() => { if (delayed) void setup.cancelPairing(); else setup.dismissError(); }} fitContent testID="connect-error-sheet">
      {delayed ? <Text testID="connect-delayed" className={cn("text-foreground")}>{t('settings:connect.progress.delayed')}</Text> : null}
      {setup.error ? <FieldDescription testID="connect-error" invalid={true}>{setup.error}</FieldDescription> : null}
      {setup.notice ? <FieldDescription testID="connect-notice" invalid={false}>{setup.notice}</FieldDescription> : null}
      {setup.canRetry ? <Button testID="connect-retry" disabled={setup.busy} onPress={() => void setup.retry()} variant="ghost"><Text>{t('common:actions.retry')}</Text></Button> : null}
      {setup.savedProfile && !delayed ? <Button testID="connect-retry-connection" disabled={setup.busy} onPress={() => void setup.connectProfile(setup.savedProfile!)} variant="ghost"><Text>{t('common:actions.reconnect')}</Text></Button> : null}
      {delayed ? <Button testID="connect-rescan" onPress={() => void setup.cancelPairing()} variant="ghost"><Text>{t('settings:connect.scanNewQr')}</Text></Button> : <Button disabled={pending} onPress={() => { setup.dismissError(); setSheet('options'); }} variant="ghost"><Text>{t('settings:connect.openLink')}</Text></Button>}
    </OverlaySheet>
  </KeyboardAvoidingView>;
}


const stylesClasses = {
  "screen": "flex-1",
  "progress": "p-5 rounded-[12px] gap-3 items-center self-center mt-6"
} as const;
