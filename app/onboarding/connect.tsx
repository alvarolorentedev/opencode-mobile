import { useState } from 'react';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Button } from 'react-native-paper';

import { OnboardingStep } from '@/components/onboarding/onboarding-step';
import { ConnectionSetupForm } from '@/components/settings/connection-setup-form';

export default function OnboardingConnectScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return <OnboardingStep step={3} totalSteps={5} title={t('settings:connection.addConnection')} testID="onboarding-connect" onBack={busy ? undefined : () => router.back()} footer={
    <Button disabled={busy} testID="onboarding-connect-skip" onPress={() => router.push('/onboarding/project')}>{t('onboarding:connect.skip')}</Button>
  }>
    <ConnectionSetupForm onBusyChange={setBusy} onPair={() => router.push('/pair')} onConnected={() => router.push('/onboarding/project')} />
  </OnboardingStep>;
}
