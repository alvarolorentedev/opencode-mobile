import { cn } from '@/shared/ui/cn';
import { ModalSurface } from '@/shared/ui/portal';
import { Button } from '@/shared/ui/button';
import { Icon } from '@/shared/ui/icon';
import { HeaderTitle, ScreenHeader } from '@/shared/ui/screen-header';
import { Text } from '@/shared/ui/text';
import { Spinner } from '@/shared/ui/spinner';
import { FieldDescription } from '@/shared/ui/text-field';

import Constants from 'expo-constants';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, StyleSheet, View } from 'react-native';

import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ConnectCameraGate } from '@/shared/platform/camera/connect-camera-gate';
import { ConnectScanner } from '@/shared/platform/camera/connect-scanner';
import type { ConnectionProfileFormValues } from '@/features/connections/ui/connection-profile-dialog';
import { useUpdateBlocker } from '@/runtime/ui';
import { usePalette } from '@/shared/ui/theme/use-palette';
import { LocalPairingError } from '@/shared/contracts/pairing-error';
import { useConnection } from '@/features/connections/context';

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
    <ModalSurface accessibilityLabel={t('settings:connection.setup.scan')} visible animationType="slide" presentationStyle="fullScreen" onRequestClose={locked ? undefined : dismiss}>
      <View className={cn(stylesClasses.screen, "bg-background")}>
        <View style={StyleSheet.absoluteFill}>
          <ConnectCameraGate onCancel={dismiss}>
            <ConnectScanner key={attempt} enabled={!busy && !message} hint={t('settings:connection.setup.scanAutomatic')} onScan={(code) => void pair(code)} />
          </ConnectCameraGate>
        </View>
        <ScreenHeader style={{ backgroundColor: palette.surface, paddingTop: insets.top, height: headerHeight }} safeArea={false}><Button accessibilityLabel={t('common:actions.back')} disabled={Boolean(busy)} onPress={dismiss} variant="ghost" size="icon"><Icon name={"arrow-left"} size={24} color={palette.text} /></Button><HeaderTitle title={t('settings:connection.setup.scan')} textStyle={{ color: palette.text }} maxFontSizeMultiplier={1.5}></HeaderTitle></ScreenHeader>
        <View pointerEvents="none" className={cn(stylesClasses.instructions)} style={[{ top: headerHeight + 12 }]}>
          <View className={cn(stylesClasses.card, "bg-surface border-border")}>
            <Text className={cn("text-foreground")} variant="body">{t('settings:connection.setup.pairCommand')}</Text>
            <Text className={cn("text-muted-foreground")}>{t('settings:connection.setup.sameNetwork')}</Text>
          </View>
        </View>
        {busy ? <View className={cn(stylesClasses.center)} pointerEvents="none">
          <View className={cn(stylesClasses.card, stylesClasses.progress, "bg-surface border-border")}>
            <Spinner />
            <Text className={cn("text-foreground")} testID="connection-scan-progress">{t(`settings:connect.progress.${busy === 'pair' ? 'claiming' : 'saving'}`)}</Text>
          </View>
        </View> : null}
        {message ? <View className={cn(stylesClasses.recovery)} style={[{ bottom: Math.max(insets.bottom, 96) }]}>
          <View className={cn(stylesClasses.card, "bg-surface border-border")}>
            <FieldDescription testID="connection-scan-error" invalid={true} hidden={!(true)}>{message}</FieldDescription>
            <View className={cn(stylesClasses.actions)}>
              {redeemed ? <Button testID="connection-scan-retry" disabled={Boolean(busy)} onPress={() => void submit(redeemed)} variant="default"><Text>{t('common:actions.retry')}</Text></Button> : null}
              <Button testID="connection-scan-again" disabled={Boolean(busy)} onPress={rescan} variant="ghost"><Text>{t('settings:connection.setup.scanAgain')}</Text></Button>
            </View>
          </View>
        </View> : null}
      </View>
    </ModalSurface>
  );
}

const stylesClasses = {
  "screen": "flex-1",
  "instructions": "absolute left-6 right-6",
  "card": "rounded-[16px] border p-4 gap-1.5",
  "center": "absolute top-0 left-0 right-0 bottom-0 items-center justify-center",
  "progress": "flex-row items-center gap-3",
  "recovery": "absolute left-6 right-6",
  "actions": "flex-row justify-end gap-2"
} as const;
