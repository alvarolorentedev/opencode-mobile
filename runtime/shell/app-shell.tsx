import { cn } from '@/shared/ui/cn';
import Constants from 'expo-constants';
import { DarkTheme, DefaultTheme, LocaleProvider, Stack, ThemeProvider, usePathname } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import { useEffect, useLayoutEffect, useMemo } from 'react';
import { ActivityIndicator, Platform, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useTranslation } from 'react-i18next';
import { PortalHost } from '@/shared/ui/portal';
import '@/global.css';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { DEFAULT_ACCENT_COLOR } from '@/shared/ui/theme/appearance';
import { getColors } from '@/shared/ui/theme/theme';
import { usePalette } from '@/shared/ui/theme/use-palette';
import { useNotificationRoute } from '@/features/notifications/index';
import { useQuickActionRoute } from '@/features/sessions/index';
import { useSystemColorScheme } from '@/shared/ui/theme/use-system-color-scheme';
import { ingestRecordedJsError, installGlobalErrorHandler } from '@/shared/platform/error-reporting';
import { setSystemPath } from '@/shared/platform/system-path';
import { initializeObservability, observability, preferencesFromChatPreferences } from '@/shared/observability';
import { installObservabilityLifecycle } from '@/shared/observability/lifecycle';
import '@/shared/i18n/index';
import { getLanguageDirection } from '@/shared/i18n/languages';
import { isConnectEnabled } from '@/shared/contracts/cloud-link';
import { AppearanceProvider } from '@/shared/ui/theme/appearance-context';
import { useOnboarding } from '@/features/onboarding/context';
import { usePreferences } from '@/shared/preferences/context';
import { useUpdates } from '@/features/updates/context';
import { UpdateNotice } from '@/features/updates/index';
import { OpencodeProvider } from '@/runtime/composition/opencode-provider';

export const unstable_settings = {
  anchor: '(tabs)',
};

export { ErrorBoundary } from 'expo-router';

// Keep the native splash up until AsyncStorage/SecureStore hydration and the
// onboarding decision are known, so neither the assistant nor the app flashes.
void SplashScreen.preventAutoHideAsync().catch(() => undefined);

export default function RootLayout() {
  const isE2EMode = Boolean(Constants.expoConfig?.extra?.e2eMode);
  const { i18n } = useTranslation();
  const language = i18n.resolvedLanguage || i18n.language || 'en';
  const direction = getLanguageDirection(language);

  useEffect(() => {
    if (Platform.OS !== 'web' || !globalThis.document?.documentElement) return;
    globalThis.document.documentElement.lang = language;
    globalThis.document.documentElement.dir = direction;
  }, [direction, language]);

  useEffect(() => {
    observability.markStartup('root-render');
    void initializeObservability()
      .then(() => {
        installObservabilityLifecycle(observability);
        return ingestRecordedJsError();
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (Platform.OS === 'web' || isE2EMode) {
      return;
    }

    installGlobalErrorHandler();

    void import('@/features/notifications/services/notifications')
      .then(({ initializeNotifications }) => initializeNotifications())
      .catch(() => undefined);

    void import('@/shared/platform/voice/tts/player')
      .then(({ cleanupLocalTtsAudioCache }) => cleanupLocalTtsAudioCache())
      .catch(() => undefined);
  }, [isE2EMode]);

  return (
    <GestureHandlerRootView className={cn(stylesClasses.root)}>
      {/* Android renders an empty app tree when direction is applied to this gesture root. */}
      <View style={{ flex: 1, direction }}>
        <LocaleProvider direction={direction}>
          <SafeAreaProvider>
            <OpencodeProvider>
              <AppearanceHost />
            </OpencodeProvider>
          </SafeAreaProvider>
        </LocaleProvider>
      </View>
    </GestureHandlerRootView>
  );
}

// Preferences live in the provider, so the themed shell must sit inside it.
// AppearanceProvider publishes the effective scheme/accent to useColorScheme
// and usePalette for every screen and component below.
function AppearanceHost() {
  const { chatPreferences } = usePreferences();
  const { isHydrated } = useOnboarding();
  const systemScheme = useSystemColorScheme();
  const scheme = chatPreferences.themeMode === 'light' || chatPreferences.themeMode === 'dark'
    ? chatPreferences.themeMode
    : systemScheme;
  const accent = chatPreferences.accentColor ?? DEFAULT_ACCENT_COLOR;
  const palette = useMemo(() => getColors(scheme, accent), [accent, scheme]);
  const navigationTheme = useMemo(() => {
    const base = scheme === 'dark' ? DarkTheme : DefaultTheme;
    return { ...base, colors: { ...base.colors, background: palette.background, card: palette.surface, text: palette.text, border: palette.border, primary: palette.tint, notification: palette.danger } };
  }, [palette, scheme]);
  const appearance = useMemo(() => ({ scheme, accent, palette }), [accent, palette, scheme]);

  // Observability preferences live with the existing global preferences. Wait
  // for hydration so a user who disabled local recording is never briefly
  // recorded under the defaults.
  useEffect(() => {
    if (!isHydrated) return;
    observability.configure(preferencesFromChatPreferences(chatPreferences));
  }, [
    isHydrated,
    chatPreferences,
    chatPreferences.diagnosticsEnabled,
    chatPreferences.diagnosticsLevel,
    chatPreferences.remoteTelemetryEnabled,
    chatPreferences.remoteCrashReports,
    chatPreferences.remotePerformance,
  ]);

  // Keep window-level chrome (web overscroll, native root view) on the themed
  // surface so navigation and safe-area edges never flash the OS color.
  useEffect(() => {
    if (Platform.OS === 'web') {
      if (globalThis.document?.documentElement) globalThis.document.documentElement.style.backgroundColor = palette.background;
      if (globalThis.document?.body) globalThis.document.body.style.backgroundColor = palette.background;
      return;
    }
    void SystemUI.setBackgroundColorAsync(palette.background).catch(() => undefined);
  }, [palette.background]);

  return (
    <AppearanceProvider value={appearance}>

        <ThemeProvider value={navigationTheme}>
          <RootNavigator />
          <UpdateHost />
          <SystemPathHost />
          <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
          <PortalHost />
        </ThemeProvider>

    </AppearanceProvider>
  );
}

// Records the visible route so the OpenID Connect browser callback returns to
// the screen that started sign-in instead of an unmatched deep link.
function SystemPathHost() {
  const pathname = usePathname();
  useEffect(() => { setSystemPath(pathname); }, [pathname]);
  return null;
}

function UpdateHost() {
  const pathname = usePathname();
  const updates = useUpdates();
  const { setSurfaceActive } = updates;
  const eligible = ['/', '/projects', '/settings', '/terminal'].includes(pathname);
  useLayoutEffect(() => {
    setSurfaceActive(eligible);
    return () => setSurfaceActive(false);
  }, [eligible, setSurfaceActive]);
  return <UpdateNotice {...updates} onUpdate={() => { void updates.update(); }} onLater={updates.later} onDismissError={updates.clearError} />;
}

// The onboarding decision depends on persisted state, so routing waits for
// hydration. `Stack.Protected` swaps the assistant in and out without mounting
// the tab navigator behind it, which prevents any onboarding/app flash.
function RootNavigator() {
  const palette = usePalette();
  const { isHydrated, onboardingCompleted, onboardingActive } = useOnboarding();
  useNotificationRoute();
  useQuickActionRoute(isHydrated);

  useEffect(() => {
    if (isHydrated) {
      observability.markStartup('workspace-ready');
      void SplashScreen.hideAsync()
        .then(() => observability.markStartup('interactive'))
        .catch(() => undefined);
    }
  }, [isHydrated]);

  if (!isHydrated) {
    return (
      <View className={cn(stylesClasses.hydration, "bg-background")}>
        <ActivityIndicator size="large" color={palette.tint} />
      </View>
    );
  }

  const onboardingVisible = !onboardingCompleted || onboardingActive;

  return (
    <Stack>
      <Stack.Protected guard={onboardingCompleted} redirectTo="/onboarding">
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="session/[id]" options={{ headerShown: false }} />
      </Stack.Protected>
      <Stack.Protected guard={onboardingVisible}>
        <Stack.Screen name="onboarding" options={{ headerShown: false }} />
      </Stack.Protected>
      <Stack.Protected guard={isConnectEnabled()}>
        <Stack.Screen name="pair" options={{ headerShown: false }} />
        <Stack.Screen name="service" options={{ headerShown: false }} />
      </Stack.Protected>
      <Stack.Screen name="share" options={{ headerShown: false }} />
    </Stack>
  );
}

const stylesClasses = {
  "root": "flex-1",
  "hydration": "items-center flex-1 justify-center"
} as const;
