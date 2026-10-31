import { cn } from '@/shared/ui/cn';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ConnectManagementPanel } from '@/features/cloud-link/ui/connect-panel';
import { ConnectEntry } from '@/features/cloud-link/ui/connect-pairing';
import { useConnection } from '@/features/connections/context';
import { useBootState as useOnboarding } from '@/runtime/workspace';

export default function PairScreen() {
  const params = useLocalSearchParams<{ v?: string; cp?: string; id?: string; t?: string; n?: string; mode?: string }>();
  const router = useRouter();
  const { connectSetup } = useConnection();
  const { isHydrated, onboardingCompleted, onboardingActive } = useOnboarding();

  const { pairLink, initialization, busy } = connectSetup;
  const incomingLink = useRef<typeof params | undefined>(undefined);
  // Captured before the incoming link params are stripped from the route.
  const [deepLink, setDeepLink] = useState(() => Boolean(params.v || params.cp || params.id || params.t || params.n));
  // Router params can arrive after mount; retain their origin before stripping them.
  if (!deepLink && (params.v || params.cp || params.id || params.t || params.n)) setDeepLink(true);
  useEffect(() => {
    if (isHydrated && (params.v || params.cp || params.id || params.t || params.n)) {
      incomingLink.current = { ...params };
      router.setParams({ v: undefined, cp: undefined, id: undefined, t: undefined, n: undefined });
    }
  }, [isHydrated, params, router]);
  useEffect(() => {
    // Store recovery may reject new links while its purchase is being saved.
    if (!incomingLink.current || initialization !== 'ready' || busy) return;
    const link = incomingLink.current;
    incomingLink.current = undefined;
    void pairLink(link);
  }, [initialization, busy, pairLink, params]);
  async function cancelPairing() {
    const cancelled = await connectSetup.cancelPairing();
    if (cancelled) incomingLink.current = undefined;
    return cancelled;
  }
  if (!connectSetup.enabled) return null;
  const onConnected = () => router.replace(!onboardingCompleted || onboardingActive ? '/onboarding/ai' : '/(tabs)/projects');
  const onClose = () => router.replace(!onboardingCompleted || onboardingActive ? '/onboarding/connect' : '/(tabs)/settings');
  if (params.mode !== 'manage') return <ConnectEntry setup={{ ...connectSetup, cancelPairing }} onConnected={onConnected} onClose={onClose} onManage={() => router.push('/pair?mode=manage')} deepLink={deepLink} />;
  return <SafeAreaView className={cn("flex-1 bg-background")}>
    <KeyboardAvoidingView className={cn("flex-1")} behavior="padding">
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 20 }}>
        <ConnectManagementPanel setup={connectSetup} onConnected={onConnected} onClose={onClose} />
      </ScrollView>
    </KeyboardAvoidingView>
  </SafeAreaView>;
}
