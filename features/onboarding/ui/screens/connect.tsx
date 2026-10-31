import { Button } from '@/shared/ui/button';
import { Text } from '@/shared/ui/text';
import { useState } from 'react';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { useOnboardingNavigation } from '@/features/onboarding/ui/use-onboarding-navigation';
import { OnboardingStep } from '@/features/onboarding/ui/onboarding-step';
import { ConnectionSetupForm } from '@/features/connections/index';

export default function OnboardingConnectScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const navigation = useOnboardingNavigation('connect');
  const [busy, setBusy] = useState(false);
  return <OnboardingStep step="connect" title={t('settings:connection.addConnection')} testID="onboarding-connect" backDisabled={busy} footer={
    <Button disabled={busy} testID="onboarding-connect-skip" onPress={navigation.next} variant={"ghost"}><Text>{t('onboarding:connect.skip')}</Text></Button>
  }>
    <ConnectionSetupForm onBusyChange={setBusy} onPair={() => router.push('/pair')} onConnected={() => router.push('/onboarding/ai')} />
  </OnboardingStep>;
}
