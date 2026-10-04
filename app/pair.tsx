import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { KeyboardAvoidingView, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ConnectManagementPanel } from '@/components/settings/connect-panel';
import { ConnectEntry } from '@/components/settings/connect-pairing';
import { usePalette } from '@/providers/theme-provider';
import { useConnection, useOnboarding } from '@/providers/opencode-contexts';

export default function PairScreen() {
  const params = useLocalSearchParams<{ v?: string; cp?: string; id?: string; t?: string; n?: string; mode?: string }>();
  const router = useRouter();
  const { connectSetup } = useConnection();
  const { isHydrated, onboardingCompleted, onboardingActive } = useOnboarding();
  const palette = usePalette();
  const { pairLink } = connectSetup;
  useEffect(() => {
    if (isHydrated && (params.v || params.cp || params.id || params.t || params.n)) {
      void pairLink(params);
      router.replace('/pair');
    }
  }, [pairLink, isHydrated, params, router]);
  if (!connectSetup.enabled) return null;
  const onConnected = () => router.replace(!onboardingCompleted || onboardingActive ? '/onboarding/workspace' : '/(tabs)/workspace');
  const onClose = () => router.replace(!onboardingCompleted || onboardingActive ? '/onboarding/connect' : '/(tabs)/settings');
  if (params.mode !== 'manage') return <ConnectEntry setup={connectSetup} onConnected={onConnected} onClose={onClose} onManage={() => router.push('/pair?mode=manage')} />;
  return <SafeAreaView style={{ flex: 1, backgroundColor: palette.background }}>
    <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 20 }}>
        <ConnectManagementPanel setup={connectSetup} onConnected={onConnected} onClose={onClose} />
      </ScrollView>
    </KeyboardAvoidingView>
  </SafeAreaView>;
}
