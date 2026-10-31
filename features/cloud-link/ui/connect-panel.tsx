import { cn } from '@/shared/ui/cn';
import { useConfirmation } from '@/shared/ui/use-confirmation';
import { Text } from '@/shared/ui/text';
import { Button } from '@/shared/ui/button';
import { FieldDescription } from '@/shared/ui/text-field';

import { useIsFocused } from 'expo-router';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { AppState, StyleSheet, View } from 'react-native';

import { ConnectSubscription } from '@/features/cloud-link/ui/connect-subscription';
import type { ConnectSetup } from '@/shared/contracts/cloud-link-setup';

export function ConnectManagementPanel({ setup, onConnected, onClose }: { setup: ConnectSetup; onConnected: () => void; onClose: () => void }) {
  const { confirmAction, confirmation } = useConfirmation();
  const { t } = useTranslation();

  const focused = useIsFocused();
  const { hasToken, machines, refreshMachines } = setup;
  const connected = useRef(setup.phase === 'paired');
  const machinesRequested = useRef(false);
  useEffect(() => {
    if (setup.phase !== 'paired') { connected.current = false; return; }
    if (focused && !connected.current && !setup.error) { connected.current = true; onConnected(); }
  }, [focused, onConnected, setup.error, setup.phase]);
  useEffect(() => {
    if (!hasToken) { machinesRequested.current = false; return; }
    if (machines || machinesRequested.current) return;
    machinesRequested.current = true;
    void refreshMachines();
  }, [hasToken, machines, refreshMachines]);
  useEffect(() => {
    if (!hasToken) return;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refreshMachines();
    });
    return () => subscription.remove();
  }, [hasToken, refreshMachines]);
  const runConnect = (action: Promise<boolean>) => { void action; };
  function confirm(title: string, message: string, action: () => void) {
    confirmAction(title, message, title, t('common:actions.cancel'), action);
  }
  return <>{confirmation}{(
    <View testID="connect-management-panel" className={cn(stylesClasses.section)}>
      <Text className={cn("text-foreground")} variant="heading">{t('settings:connect.title')}</Text>
      <Text className={cn("text-foreground")}>{t('settings:connect.description')}</Text>
      {setup.entitled ? <Text className={cn("text-foreground")} testID="connect-subscription-active">{t('settings:connect.subscriptionActive')}</Text> : setup.initialization === 'ready' ? <ConnectSubscription setup={setup} /> : null}
      {setup.canRetry ? <Button testID="connect-retry" disabled={setup.busy} onPress={() => void setup.retry()} variant="ghost"><Text>{t('common:actions.retry')}</Text></Button> : null}
      {setup.busy ? <Text className={cn("text-foreground")} testID="connect-progress">{t(`settings:connect.progress.${setup.phase}`)}</Text> : null}
      {setup.phase === 'delayed' ? <Text className={cn("text-foreground")} testID="connect-delayed">{t('settings:connect.progress.delayed')}</Text> : null}
      {setup.error ? <FieldDescription testID="connect-error" invalid={true}>{setup.error}</FieldDescription> : null}
      {setup.notice ? <FieldDescription testID="connect-notice" invalid={false}>{setup.notice}</FieldDescription> : null}
      {setup.savedProfile ? <>
        <Text className={cn("text-foreground")}>{t('settings:connect.savedConnection', { name: setup.savedProfile.name })}</Text>
        {setup.phase !== 'delayed' ? <Button testID="connect-retry-connection" disabled={setup.busy} onPress={() => runConnect(setup.connectProfile(setup.savedProfile!))} variant="outline"><Text>{t('common:actions.reconnect')}</Text></Button> : null}
      </> : null}
      <Text className={cn("text-foreground")} variant="title">{t('settings:connect.machines')}</Text>
      {machines?.length === 0 ? <Text className={cn("text-foreground")} testID="connect-no-machines">{t('settings:connect.noMachines')}</Text> : null}
      {machines?.map((machine) => {
        const profile = setup.profiles.find((item) => item.connect?.controlPlaneUrl === setup.controlPlaneUrl && item.connect.machineId === machine.id);
        return <View key={machine.id} testID={`connect-machine-${machine.id}`} style={styles.machine}>
          <Text className={cn("text-foreground")} variant="title">{machine.name}</Text><Text className={cn("text-foreground")}>{machine.public_url}</Text>
          {machine.access_enabled && setup.entitled ? <Button testID={`connect-access-${machine.id}`} disabled={setup.busy} onPress={() => runConnect(profile ? setup.connectProfile(profile) : setup.connectMachine(machine.id))} variant="ghost"><Text>{t('common:actions.connect')}</Text></Button> : <Text className={cn("text-foreground")}>{t('settings:connect.accessUnavailable')}</Text>}
          <Button testID={`connect-revoke-${machine.id}`} disabled={setup.busy} onPress={() => confirm(t('settings:connect.revoke'), t('settings:connect.revokeConfirm'), () => { void setup.revokeMachine(machine.id); })} variant="ghost"><Text>{t('settings:connect.revoke')}</Text></Button>
        </View>;
      })}
      {setup.profiles.filter((profile) => profile.connect?.controlPlaneUrl === setup.controlPlaneUrl).map((profile) => <View key={profile.id} style={styles.machine}>
        <Text className={cn("text-foreground")}>{profile.name}</Text>
        <Text className={cn("text-foreground")}>{t('settings:connect.expiresAt', { date: new Date(profile.connect!.expiresAt).toLocaleString() })}</Text>
        <Button disabled={setup.busy} onPress={() => confirm(t('settings:connect.forget'), t('settings:connect.forgetConfirm'), () => { void setup.forgetProfile(profile); })} variant="ghost"><Text>{t('settings:connect.forget')}</Text></Button>
      </View>)}
      <Button disabled={setup.busy} onPress={() => { void setup.cancelPairing().then((ok) => { if (ok) onClose(); }); }} variant="ghost"><Text>{t('common:actions.close')}</Text></Button>
    </View>
  )}</>;
}

const styles = StyleSheet.create({
  machine: { gap: 6, paddingVertical: 12, borderTopWidth: StyleSheet.hairlineWidth, borderColor: '#888' }
});

const stylesClasses = {
  "section": "gap-3"
} as const;
