import type { WorkspaceTarget } from '@/shared/contracts/workspace';
import { cn } from '@/shared/ui/cn';
import { ModalSurface } from '@/shared/ui/portal';
import { Button } from '@/shared/ui/button';
import { Icon } from '@/shared/ui/icon';
import { HeaderTitle, ScreenHeader } from '@/shared/ui/screen-header';
import { Text } from '@/shared/ui/text';
import { Spinner } from '@/shared/ui/spinner';
import { FieldDescription } from '@/shared/ui/text-field';

import Constants from 'expo-constants';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, StyleSheet, View } from 'react-native';

import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ConnectCameraGate } from '@/shared/platform/camera/connect-camera-gate';
import { ConnectScanner } from '@/shared/platform/camera/connect-scanner';
import type { ConnectionProfileFormValues } from '@/features/connections/ui/connection-profile-dialog';
import { useUpdateBlocker } from '@/features/updates/context';
import { usePalette } from '@/shared/ui/theme/use-palette';
import { LocalPairingError } from '@/shared/contracts/pairing-error';
import { useConnection } from '@/features/connections/context';

// Local QR setup is its own flow. It never falls back to the manual address
// form: Back returns to the chooser where Manual remains available. The camera
// fills the screen like the Cloud Link scanner; the `opencode pair` command,
// the image-import FAB, scan progress and recovery are overlaid on top instead
// of being boxed into a step layout.
export function ConnectionScanFlow({ workspace, onSubmit, onDismiss, onBusyChange }: { workspace?: WorkspaceTarget;
  onSubmit: (values: ConnectionProfileFormValues) => Promise<void> | void;
  onDismiss: () => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const insets = useSafeAreaInsets();
  useUpdateBlocker(true);
  const { t } = useTranslation();
  const { connectionProfiles } = useConnection(workspace);
  const palette = usePalette();
  const native = (Platform.OS === 'ios' || Platform.OS === 'android') && !Constants.expoConfig?.extra?.foss;
  const [message, setMessage] = useState<string>();
  // Redeemed credentials survive a failed save/connect so Retry never re-pairs.
  const [redeemed, setRedeemed] = useState<ConnectionProfileFormValues>();
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState<'pair' | 'save'>();
  const [importing, setImporting] = useState(false);
  const working = useRef(false);
  const picking = useRef(false);
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

  // Camera denial must not close this flow: the image import FAB still works.
  const keepOpen = useCallback(() => undefined, []);

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

  // A cancelled pick or an image without a readable QR code must not interrupt
  // the live scan: fail silently and keep scanning.
  async function importImage() {
    if (picking.current || working.current) return;
    picking.current = true;
    setImporting(true);
    try {
      const picker = await import('expo-image-picker');
      const picked = await picker.launchImageLibraryAsync({ mediaTypes: ['images'] });
      if (picked.canceled || !picked.assets?.[0]) return;
      const camera = await import('expo-camera');
      const [found] = await camera.scanFromURLAsync(picked.assets[0].uri, ['qr']);
      if (!found?.data) return;
      await pair(found.data);
    } catch {
      // Unreadable image or a picker failure: resume the live scan.
    } finally {
      picking.current = false;
      setImporting(false);
    }
  }

  if (!native) return null;

  return (
    <ModalSurface accessibilityLabel={t('settings:connection.setup.scan')} visible animationType="slide" presentationStyle="fullScreen" onRequestClose={locked ? undefined : dismiss}>
      <View className={cn(stylesClasses.screen, "bg-background")}>
        <View style={StyleSheet.absoluteFill}>
          <ConnectCameraGate onCancel={dismiss} onDenied={keepOpen}>
            <ConnectScanner key={attempt} enabled={!busy && !message && !importing} hint={null} onScan={(code) => void pair(code)} />
          </ConnectCameraGate>
        </View>
        <ScreenHeader style={{ backgroundColor: palette.surface, paddingTop: insets.top, height: headerHeight }} safeArea={false}><Button accessibilityLabel={t('common:actions.back')} disabled={Boolean(busy)} onPress={dismiss} variant="ghost" size="icon"><Icon name={"arrow-left"} size={24} color={palette.text} /></Button><HeaderTitle title={t('settings:connection.setup.scan')} textStyle={{ color: palette.text }} maxFontSizeMultiplier={1.5}></HeaderTitle></ScreenHeader>
        <View pointerEvents="none" className={cn(stylesClasses.instructions)} style={[{ top: headerHeight + 12 }]}>
          <View className={cn(stylesClasses.card, "bg-surface border-border")}>
            <Text className={cn("text-foreground")} variant="body">{t('settings:connection.setup.pairCommand')}</Text>
          </View>
        </View>
        {!busy && !message ? <View className={cn(stylesClasses.fab)} style={[{ bottom: Math.max(insets.bottom, 16) }]}>
          <Button testID="connection-scan-import" accessibilityLabel={t('settings:connection.setup.importImage')} disabled={importing} onPress={() => importImage()} variant="default" className={cn("w-14 h-14 rounded-full p-0")}>
            {importing ? <Spinner size="small" /> : <Icon name="image-plus" size={26} />}
          </Button>
        </View> : null}
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
  "fab": "absolute right-6",
  "actions": "flex-row justify-end gap-2"
} as const;
