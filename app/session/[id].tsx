import { cn } from '@/lib/utils';
import { Spinner } from '@/components/ui/spinner';
import { Text } from '@/components/ui/text';
import { Button } from '@/components/ui/button';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';


import { useCurrentSession, useOnboarding } from '@/providers/opencode-contexts';
import { usePalette } from '@/hooks/use-palette';

export default function SessionDeepLinkScreen() {
  const { t } = useTranslation();
  const palette = usePalette();
  const router = useRouter();
  const params = useLocalSearchParams();
  const { isHydrated } = useOnboarding();
  const { openDeepLinkSession } = useCurrentSession();
  const rawSessionId = Array.isArray(params.id) ? params.id[0] : params.id;
  const sessionId = rawSessionId?.trim();
  const rawProject = Array.isArray(params.project) ? params.project[0] : params.project;
  const projectPath = rawProject?.trim() || undefined;
  const rawScope = Array.isArray(params.connectionScope) ? params.connectionScope[0] : params.connectionScope;
  const connectionScope = rawScope?.trim() || undefined;
  const [error, setError] = useState<string>();
  const missingSessionIdError = sessionId ? undefined : t('chat:deepLink.missingSessionId');
  const displayError = error ?? missingSessionIdError;

  useEffect(() => {
    if (!sessionId) {
      return;
    }

    if (!isHydrated) {
      return;
    }

    const controller = new AbortController();
    let isActive = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- clear the previous attempt's error before retrying.
    setError(undefined);
    void openDeepLinkSession({ sessionId, projectPath, connectionScope }, controller.signal)
      .then((result) => {
        if (!isActive) return;
        if (result.ok) {
          router.replace('/(tabs)');
          return;
        }
        setError(result.error);
      })
      .catch(() => {
        if (isActive) setError(t('chat:deepLink.couldNotOpen'));
      });

    return () => {
      isActive = false;
      controller.abort();
    };
  }, [connectionScope, isHydrated, openDeepLinkSession, projectPath, router, sessionId, t]);

  const title = displayError ? t('chat:deepLink.errorTitle') : t('chat:deepLink.openingTitle');
  const copy = displayError
    ? displayError
    : t('chat:deepLink.loading');

  return (
    <View className={cn(stylesClasses.center, "bg-background")}>
      <View className={cn(stylesClasses.panel, "bg-surface")}>{!displayError && <Spinner size="large" color={palette.tint} />}<Text className={cn(stylesClasses.title, "text-foreground")} variant="display">{title}</Text><Text className={cn(stylesClasses.copy, "text-muted-foreground")} variant="description">{copy}</Text>{displayError && (
          <Button onPress={() => router.replace('/(tabs)')} variant="default" className={cn(stylesClasses.button)} ><Text>{t('chat:deepLink.backToChat')}</Text></Button>
        )}</View>
    </View>
  );
}



const stylesClasses = {
  "center": "flex-1 items-center justify-center p-6",
  "panel": "w-full p-6 gap-3 rounded-[16px]",
  "title": "text-center font-semibold",
  "copy": "text-center leading-[22px]",
  "button": "mt-2"
} as const;
