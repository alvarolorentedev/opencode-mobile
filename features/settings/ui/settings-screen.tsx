import { cn } from '@/shared/ui/cn';
import { Text } from '@/shared/ui/text';
import { ScreenHeader } from '@/shared/ui/screen-header';
import { Feedback } from '@/shared/ui/feedback';
import { useCallback, useMemo, useRef, useState } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Platform, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Fonts } from '@/shared/ui/theme/theme';
import { WorkspaceScope, useWorkspaces } from '@/runtime/workspace';
import { ServerContextPicker } from '@/features/settings/ui/server-context-picker';
import { getConnectionUiScope } from '@/shared/contracts/connection-scope';
import { useNotificationSetup } from '@/features/notifications/index';
import { useTtsSetup , useVoiceSetup , useSpeechVoices , WORKING_SOUND_OPTIONS } from '@/features/voice/index';
import { RESPONSE_SCOPE_OPTIONS } from '@/features/chat/index';
import { SettingsHome } from '@/features/settings/ui/settings-home';
import { SettingsPanel } from '@/shared/ui/settings/settings-panel';
import type { SettingsTarget } from '@/shared/ui/settings/target';
import { getVisibleModels } from '@/features/ai/index';
import { OverlaySheet } from '@/shared/ui/overlay-sheet';
import { useLastJsError } from '@/features/connections/index';
import { usePalette } from '@/shared/ui/theme/use-palette';
import { getSpeechPlayback } from '@/shared/platform/voice/speech-config';
import { useApprovals } from '@/features/sessions/context';
import { useCapabilities } from '@/features/ai/context';
import { useConnection, useDiagnostics } from '@/features/connections/context';
import { useMcp } from '@/features/extensions/context';
import { useOnboarding } from '@/features/onboarding/context';
import { usePreferences } from '@/shared/preferences/context';
import { useProjects } from '@/features/projects/context';
import { useUpdates } from '@/features/updates/context';
import { buildSettingsSections } from '@/features/settings/ui/settings-section-registry';

export default function SettingsScreen() {
  const registry = useWorkspaces();
  return <WorkspaceScope target={registry.inspectionTarget ?? registry.focus}><SettingsContent /></WorkspaceScope>;
}

function SettingsContent() {
  const insets = useSafeAreaInsets();
  const palette = usePalette();
  const { t } = useTranslation();
  const { configuredProviders, currentConfig, availableModels, modelRouting } = useCapabilities();
  const mcp = useMcp();
  const { chatPreferences, updateChatPreferences } = usePreferences();
  const { connect, connection, settings, serverCapabilities, connectSetup, services: serviceManagement } = useConnection();
  const { activeProjectPath } = useProjects();
  const diagnosticsData = useDiagnostics();
  const { lastJsError, refreshLastJsError } = useLastJsError();
  const { approvals } = useApprovals();
  const { startOnboardingReview } = useOnboarding();
  const updates = useUpdates();
  const router = useRouter();
  const notifications = useNotificationSetup();
  const speechPlayback = useMemo(
    () => getSpeechPlayback({
      localTtsPackId: chatPreferences.localTtsPackId,
      localTtsSpeakerId: chatPreferences.localTtsSpeakerId,
      speechVoiceId: chatPreferences.speechVoiceId,
      ttsEngine: chatPreferences.ttsEngine,
    }),
    [
      chatPreferences.localTtsPackId,
      chatPreferences.localTtsSpeakerId,
      chatPreferences.speechVoiceId,
      chatPreferences.ttsEngine,
    ],
  );
  const voiceSetup = useVoiceSetup({
    locale: chatPreferences.speechLocale,
    localCommandModel: chatPreferences.localCommandModel,
    localWakePhrase: chatPreferences.localWakePhrase,
    playback: speechPlayback,
    rate: chatPreferences.speechRate,
  });
  const ttsSetup = useTtsSetup({
    chatPreferences,
    rate: chatPreferences.speechRate,
    updateChatPreferences,
  });
  const refreshTtsSetup = ttsSetup.refresh;
  const [isConnecting, setIsConnecting] = useState(false);
  const [reconnectFeedback, setReconnectFeedback] = useState<string>();
  const [advancedTab, setAdvancedTab] = useState<'mcp' | 'diagnostics'>('diagnostics');
  const [openSection, setOpenSection] = useState<string>();
  const [searchTarget, setSearchTarget] = useState<SettingsTarget>();
  // Reopening Cloud Link after the full-screen service editor returns keeps the
  // user in context without leaving a portal sheet over the pushed route.
  const returnToCloudLink = useRef(false);
  const { voices: availableSpeechVoices, isLoading: isRefreshingSpeechVoices } = useSpeechVoices();

  async function handleConnect() {
    setIsConnecting(true);
    setReconnectFeedback(undefined);
    try {
      const result = await connect();
      setReconnectFeedback(result.status === 'connected'
        ? t('settings:connection.reconnectSuccess', { url: settings.serverUrl })
        : result.message);
    } catch (error) {
      setReconnectFeedback(error instanceof Error ? error.message : t('settings:connection.errors.generic'));
    } finally {
      setIsConnecting(false);
    }
  }

  function openServiceEditor(id?: string) {
    returnToCloudLink.current = true;
    setOpenSection(undefined);
    router.push(id ? `/service?id=${encodeURIComponent(id)}` : '/service');
  }

  useFocusEffect(useCallback(() => {
    if (!returnToCloudLink.current) return;
    returnToCloudLink.current = false;
    setOpenSection('cloud-link');
    void serviceManagement.refresh();
  }, [serviceManagement]));

  useFocusEffect(useCallback(() => {
    refreshTtsSetup();
  }, [refreshTtsSetup]));

  const selectedSpeechVoiceLabel = useMemo(
    () => availableSpeechVoices.find((voice) => voice.id === chatPreferences.speechVoiceId)?.label || t('settings:voice.voiceSelect.automatic'),
    [availableSpeechVoices, chatPreferences.speechVoiceId, t],
  );
  const selectedResponseScope = useMemo(
    () => RESPONSE_SCOPE_OPTIONS.find((option) => option.value === chatPreferences.responseScope) || RESPONSE_SCOPE_OPTIONS[0],
    [chatPreferences.responseScope],
  );
  const selectedWorkingSound = useMemo(
    () => WORKING_SOUND_OPTIONS.find((option) => option.value === chatPreferences.workingSoundVariant) || WORKING_SOUND_OPTIONS[0],
    [chatPreferences.workingSoundVariant],
  );

  // eslint-disable-next-line react-hooks/refs -- the builder stores this callback; it never invokes it during render.
  const sections = buildSettingsSections({
    t,
    palette,
    connection,
    connectSetup,
    serviceManagement,
    configuredProviders,
    autoModelAvailable: Platform.OS !== 'web' || (serverCapabilities.contract === 'v2' && getVisibleModels(availableModels, configuredProviders, chatPreferences.enabledModelIds).length > 0 && modelRouting.serverStatus !== 'unsupported'),
    onReconnect: () => void handleConnect(),
    isReconnecting: isConnecting,
    currentConfig,
    mcp,
    chatPreferences,
    updateChatPreferences,
    serverCapabilities,
    diagnosticsData,
    lastJsError,
    refreshLastJsError,
    approvals,
    startOnboardingReview,
    updates,
    router,
    notifications,
    voiceSetup,
    ttsSetup,
    availableSpeechVoices,
    isRefreshingSpeechVoices,
    selectedSpeechVoiceLabel,
    selectedResponseScope,
    selectedWorkingSound,
    advancedTab,
    setAdvancedTab,
    setOpenSection,
    openServiceEditor,
  });

  const activeSection = sections.find((section) => section.id === openSection);

  return (
    <>
      <ScreenHeader style={[styles.header, { backgroundColor: palette.surface, paddingTop: insets.top, height: 64 + insets.top }]} safeArea={false}><View className={cn(stylesClasses.headerMain)}>
          <Text maxFontSizeMultiplier={1.5} className={cn("text-foreground")} style={[styles.headerTitle]} variant="title">{t('common:tabs.settings')}</Text>
        </View></ScreenHeader>
      <SettingsHome sections={sections} onOpen={(section, target) => { setSearchTarget(target); section.onPress(); }} />

      <OverlaySheet visible={Boolean(activeSection)} fitContent scrollable={false} testID="settings-section-overlay" title={activeSection?.title ?? t('common:tabs.settings')} onClose={() => { setOpenSection(undefined); setSearchTarget(undefined); }}>
        <SettingsPanel target={searchTarget}>
          {activeSection?.group === 'server' ? <ServerContextPicker server={false} project={activeSection.id === 'advanced' || activeSection.id === 'extensions'} /> : null}
          <View key={activeSection?.group === 'server' ? `${activeSection.id}:${getConnectionUiScope(settings)}:${activeProjectPath ?? ''}` : activeSection?.id}>{activeSection?.render?.() ?? null}</View>
        </SettingsPanel>
      </OverlaySheet>

      <Feedback duration={4000} open={Boolean(notifications.feedback)} onOpenChange={() => (notifications.clearFeedback)()}>{notifications.feedback}</Feedback>
      <Feedback duration={4000} open={Boolean(voiceSetup.feedback)} onOpenChange={() => (voiceSetup.clearFeedback)()}>{voiceSetup.feedback}</Feedback>
      <Feedback duration={4000} open={Boolean(reconnectFeedback)} onOpenChange={() => (() => setReconnectFeedback(undefined))()}>{reconnectFeedback}</Feedback>
    </>
  );
}

const styles = StyleSheet.create({
  header: { elevation: 0 },
  headerTitle: { fontFamily: Fonts.display, fontWeight: '700' }
});

const stylesClasses = {
  "headerMain": "self-stretch flex-1 justify-center min-w-0"
} as const;
