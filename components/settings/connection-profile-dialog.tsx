import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Modal, ScrollView, StyleSheet, View } from 'react-native';
import { Appbar, Button, HelperText, Text, TextInput as PaperInput } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useUpdateBlocker } from '@/hooks/use-update-blocker';
import { TextInput } from '@/components/ui/text-input';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { isValidServerUrl, type ConnectionProbeResult } from '@/lib/opencode/client';
import { getServerHostname } from '@/lib/opencode/client/url';
import { useConnection } from '@/providers/opencode-contexts';

export type ConnectionProfileFormValues = {
  name: string;
  serverUrl: string;
  username: string;
  password: string;
};

// The form owns presentation; probing and profile persistence stay in the
// provider. Local QR setup lives in its own flow (`connection-scan-flow.tsx`)
// and never reuses this manual address/details surface.
export function ConnectionProfileDialog({ title, submitLabel, showName = true, initial, onSubmit, onDismiss, onBusyChange }: {
  title: string;
  submitLabel: string;
  showName?: boolean;
  initial?: Partial<ConnectionProfileFormValues>;
  onSubmit: (values: ConnectionProfileFormValues) => Promise<void> | void;
  onDismiss: () => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const insets = useSafeAreaInsets();
  useUpdateBlocker(true);
  const { t } = useTranslation();
  const { connectionProfiles } = useConnection();
  const palette = Colors[useColorScheme() ?? 'light'];
  const [name, setName] = useState(initial?.name ?? '');
  const [serverUrl, setServerUrl] = useState(initial?.serverUrl ?? '');
  const [username, setUsername] = useState(initial?.username ?? '');
  const [password, setPassword] = useState(initial?.password ?? '');
  const [step, setStep] = useState<'address' | 'details'>('address');
  const [probe, setProbe] = useState<ConnectionProbeResult>();
  const [customUsername, setCustomUsername] = useState(Boolean(initial?.username));
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState<'probe' | 'save'>();
  const working = useRef(false);
  const request = useRef(0);
  const controller = useRef<AbortController | undefined>(undefined);
  useEffect(() => () => { request.current += 1; controller.current?.abort(); }, []);
  useEffect(() => { onBusyChange?.(Boolean(busy)); }, [busy, onBusyChange]);
  const locked = busy === 'save';
  const v1 = probe?.status === 'detected' && probe.contract === 'v1';
  const v2 = probe?.status === 'detected' && probe.contract === 'v2';

  function back() {
    request.current += 1;
    controller.current?.abort();
    working.current = false;
    setBusy(undefined);
    onBusyChange?.(false);
    setError(undefined);
    if (step === 'details') setStep('address');
    else onDismiss();
  }

  async function perform(operation: 'probe' | 'save') {
    if (working.current) return;
    if (!serverUrl.trim() || !isValidServerUrl(serverUrl)) {
      setError(t(serverUrl.trim() ? 'settings:connection.errors.invalidUrl' : 'settings:connection.errors.serverUrl'));
      return;
    }
    working.current = true;
    setBusy(operation);
    setError(undefined);
    const current = ++request.current;
    controller.current = new AbortController();
    try {
      const values = { name: name.trim(), serverUrl: serverUrl.trim(), username: username.trim(), password };
      const result = await connectionProfiles.probe(values, controller.current.signal);
      if (current !== request.current) return;
      setProbe(result);
      if (result.status === 'unreachable') throw new Error(t('settings:connection.setup.unreachable'));
      if (operation === 'probe') { setStep('details'); return; }
      if (result.status === 'authentication-required') throw new Error(t('settings:connection.setup.credentialsRejected'));
      await onSubmit(values);
    } catch (reason) {
      if (current !== request.current) return;
      setError(reason instanceof Error ? reason.message : t('settings:connection.errors.save'));
    } finally {
      if (current === request.current) { working.current = false; setBusy(undefined); }
    }
  }

  return (
    <Modal visible animationType="slide" presentationStyle="fullScreen" onRequestClose={locked ? undefined : back}>
      <KeyboardAvoidingView style={[styles.screen, { backgroundColor: palette.background }]} behavior="padding">
        <Appbar.Header statusBarHeight={0} style={{ backgroundColor: palette.surface, paddingTop: insets.top, height: 64 + insets.top }}>
          <Appbar.BackAction accessibilityLabel={t('common:actions.back')} disabled={locked} onPress={back} />
          <Appbar.Content title={title} />
        </Appbar.Header>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
          <Text style={{ color: palette.muted }}>{t('settings:connection.setup.step', { step: step === 'address' ? 1 : 2 })}</Text>
          <Text variant="headlineSmall">{t(step === 'address' ? 'settings:connection.setup.addressTitle' : 'settings:connection.setup.detailsTitle')}</Text>
          {step === 'address' ? <>
            <Text style={{ color: palette.muted }}>{t('settings:connection.setup.addressHint')}</Text>
            <TextInput mode="outlined" label={t('settings:connection.fields.serverUrl')} testID="connection-profile-url-input" value={serverUrl}
              onChangeText={(value) => { setServerUrl(value); setProbe(undefined); setError(undefined); }} disabled={Boolean(busy)} autoFocus
              autoCapitalize="none" autoCorrect={false} keyboardType="url" placeholder="http://192.168.1.10:49374" />
          </> : <>
            <View style={styles.addressRow}>
              <Text style={styles.address} numberOfLines={2}>{serverUrl}</Text>
              <Button testID="connection-profile-change" disabled={Boolean(busy)} onPress={back}>{t('settings:connection.setup.change')}</Button>
            </View>
            <Text testID="connection-profile-detection" accessibilityLiveRegion="polite" style={{ color: v1 || v2 ? palette.tint : palette.muted }}>
              {v1 || v2 ? t('settings:connection.setup.detected', { version: v2 ? '2' : '1' }) : t('settings:connection.setup.identify')}
            </Text>
            {!v2 && !v1 ? <Button testID="connection-profile-custom-username" style={styles.left} disabled={Boolean(busy)} onPress={() => setCustomUsername((value) => !value)}>{t('settings:connection.setup.customUsername')}</Button> : null}
            {!v2 && (v1 || customUsername) ? <TextInput mode="outlined" label={t('settings:connection.fields.username')} testID="connection-profile-username-input"
              value={username} onChangeText={setUsername} disabled={Boolean(busy)} autoCapitalize="none" autoCorrect={false} placeholder="opencode" /> : null}
            <TextInput mode="outlined" label={t('settings:connection.fields.password')} testID="connection-profile-password-input" value={password}
              onChangeText={setPassword} secureTextEntry={!showPassword} disabled={Boolean(busy)} autoCapitalize="none" autoCorrect={false}
              right={<PaperInput.Icon icon={showPassword ? 'eye-off' : 'eye'} onPress={() => setShowPassword((value) => !value)} accessibilityLabel={t(showPassword ? 'settings:connection.setup.hidePassword' : 'settings:connection.setup.showPassword')} />} />
            <Text style={{ color: palette.muted }}>{t('settings:connection.setup.passwordHint')}</Text>
            {showName ? <>
              <TextInput mode="outlined" label={t('settings:connection.setup.optionalName')} testID="connection-profile-name-input" value={name} onChangeText={setName}
                disabled={Boolean(busy)} placeholder={getServerHostname(serverUrl)} />
              <Text style={{ color: palette.muted }}>{t('settings:connection.setup.nameHint')}</Text>
            </> : null}
          </>}
          <HelperText testID="connection-profile-error" type="error" visible={Boolean(error)} accessibilityLiveRegion="polite">{error}</HelperText>
        </ScrollView>
        <View style={[styles.actions, { backgroundColor: palette.surface, borderTopColor: palette.border, paddingBottom: Math.max(insets.bottom, 12) }]}>
          <Button testID="connection-profile-save-cancel" disabled={locked} onPress={back}>{t(step === 'details' ? 'common:actions.back' : 'common:actions.cancel')}</Button>
          <Button mode="contained" testID={step === 'address' ? 'connection-profile-continue' : 'connection-profile-save-confirm'} loading={Boolean(busy)} disabled={Boolean(busy)}
            onPress={() => void perform(step === 'address' ? 'probe' : 'save')}>{step === 'address' ? t('settings:connection.setup.continue') : submitLabel}</Button>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: 24, gap: 16 },
  addressRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  address: { flex: 1 },
  left: { alignSelf: 'flex-start' },
  actions: { borderTopWidth: 1, flexDirection: 'row', justifyContent: 'flex-end', gap: 8, paddingHorizontal: 24, paddingTop: 16 },
});
