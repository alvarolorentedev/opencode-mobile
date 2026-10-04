import { useIsFocused } from 'expo-router';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Platform, StyleSheet, View } from 'react-native';
import { Button, HelperText, Text } from 'react-native-paper';
import { ConnectSubscription } from '@/components/settings/connect-subscription';
import { usePalette } from '@/providers/theme-provider';
import type { ConnectSetup } from '@/providers/use-connect-state';

export function ConnectManagementPanel({ setup, onConnected, onClose }: { setup: ConnectSetup; onConnected: () => void; onClose: () => void }) {
  const { t } = useTranslation();
  const palette = usePalette();
  const focused = useIsFocused();
  const connected = useRef(setup.phase === 'paired');
  useEffect(() => {
    if (setup.phase !== 'paired') { connected.current = false; return; }
    if (focused && !connected.current && !setup.error) { connected.current = true; onConnected(); }
  }, [focused, onConnected, setup.error, setup.phase]);
  const runConnect = (action: Promise<boolean>) => { void action; };
  function confirm(title: string, message: string, action: () => void) {
    if (Platform.OS === 'web') { if (globalThis.confirm(message)) action(); return; }
    Alert.alert(title, message, [
      { text: t('common:actions.cancel'), style: 'cancel' },
      { text: title, style: 'destructive', onPress: action },
    ]);
  }
  return (
    <View testID="connect-panel" style={styles.section}>
      <Text style={{ color: palette.text }} variant="titleLarge">{t('settings:connect.title')}</Text>
      <Text style={{ color: palette.text }}>{t('settings:connect.description')}</Text>
      {setup.entitled ? <Text style={{ color: palette.text }} testID="connect-subscription-active">{t('settings:connect.subscriptionActive')}</Text> : setup.initialization === 'ready' ? <ConnectSubscription setup={setup} /> : null}
      {setup.canRetry ? <Button testID="connect-retry" disabled={setup.busy} onPress={() => void setup.retry()}>{t('common:actions.retry')}</Button> : null}
      {setup.busy ? <Text style={{ color: palette.text }} testID="connect-progress">{t(`settings:connect.progress.${setup.phase}`)}</Text> : null}
      {setup.error ? <HelperText testID="connect-error" type="error">{setup.error}</HelperText> : null}
      {setup.notice ? <HelperText testID="connect-notice" type="info">{setup.notice}</HelperText> : null}
      {setup.savedProfile ? <>
        <Text style={{ color: palette.text }}>{t('settings:connect.savedConnection', { name: setup.savedProfile.name })}</Text>
        <Button testID="connect-retry-connection" mode="outlined" disabled={setup.busy} onPress={() => runConnect(setup.connectProfile(setup.savedProfile!))}>{t('common:actions.reconnect')}</Button>
      </> : null}
      <Text style={{ color: palette.text }} variant="titleMedium">{t('settings:connect.machines')}</Text>
      <Button testID="connect-refresh-machines" mode="outlined" disabled={setup.busy || !setup.hasToken} onPress={() => { void setup.refreshMachines(); }}>{t('settings:connect.refreshMachines')}</Button>
      {setup.machines?.length === 0 ? <Text style={{ color: palette.text }} testID="connect-no-machines">{t('settings:connect.noMachines')}</Text> : null}
      {setup.machines?.map((machine) => {
        const profile = setup.profiles.find((item) => item.connect?.controlPlaneUrl === setup.controlPlaneUrl && item.connect.machineId === machine.id);
        return <View key={machine.id} testID={`connect-machine-${machine.id}`} style={styles.machine}>
          <Text style={{ color: palette.text }} variant="titleMedium">{machine.name}</Text><Text style={{ color: palette.text }}>{machine.public_url}</Text>
          {machine.access_enabled && setup.entitled ? <Button testID={`connect-access-${machine.id}`} disabled={setup.busy} onPress={() => runConnect(profile ? setup.connectProfile(profile) : setup.connectMachine(machine.id))}>{t('common:actions.connect')}</Button> : <Text style={{ color: palette.text }}>{t('settings:connect.accessUnavailable')}</Text>}
          <Button testID={`connect-revoke-${machine.id}`} disabled={setup.busy} onPress={() => confirm(t('settings:connect.revoke'), t('settings:connect.revokeConfirm'), () => { void setup.revokeMachine(machine.id); })}>{t('settings:connect.revoke')}</Button>
        </View>;
      })}
      {setup.profiles.filter((profile) => profile.connect?.controlPlaneUrl === setup.controlPlaneUrl).map((profile) => <View key={profile.id} style={styles.machine}>
        <Text style={{ color: palette.text }}>{profile.name}</Text>
        <Text style={{ color: palette.text }}>{t('settings:connect.expiresAt', { date: new Date(profile.connect!.expiresAt).toLocaleString() })}</Text>
        <Button disabled={setup.busy} onPress={() => confirm(t('settings:connect.forget'), t('settings:connect.forgetConfirm'), () => { void setup.forgetProfile(profile); })}>{t('settings:connect.forget')}</Button>
      </View>)}
      <Button disabled={setup.busy} onPress={() => { void setup.cancelPairing().then((ok) => { if (ok) onClose(); }); }}>{t('common:actions.close')}</Button>
    </View>
  );
}

const styles = StyleSheet.create({ section: { gap: 12 }, machine: { gap: 6, paddingVertical: 12, borderTopWidth: StyleSheet.hairlineWidth, borderColor: '#888' } });
