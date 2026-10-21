import { useState } from 'react';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Button } from 'react-native-paper';

import { useOnboardingNavigation } from '@/components/onboarding/use-onboarding-navigation';
import { OnboardingStep } from '@/components/onboarding/onboarding-step';
import { ConnectionSetupForm } from '@/components/settings/connection-setup-form';

export default function OnboardingConnectScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const navigation = useOnboardingNavigation('connect');
  const [busy, setBusy] = useState(false);
  return <OnboardingStep step="connect" title={t('settings:connection.addConnection')} testID="onboarding-connect" backDisabled={busy} footer={
    <Button disabled={busy} testID="onboarding-connect-skip" onPress={navigation.next}>{t('onboarding:connect.skip')}</Button>
  }>
    <ConnectionSetupForm onBusyChange={setBusy} onPair={() => router.push('/pair')} onConnected={() => router.push('/onboarding/ai')} />
  </OnboardingStep>;
}
