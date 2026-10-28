import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useCallback, useMemo, useRef, useState } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Appbar,
  Snackbar,
  Text,
} from 'react-native-paper';

import { Fonts } from '@/constants/theme';
import { WorkspaceScope, useWorkspaces } from '@/providers/workspace-context';
import { ServerContextPicker } from '@/components/settings/server-context-picker';
import { getConnectionUiScope } from '@/lib/connection-scope';
import { useNotificationSetup } from '@/components/settings/use-notification-setup';
import { useTtsSetup } from '@/components/settings/use-tts-setup';
import { useVoiceSetup } from '@/components/settings/use-voice-setup';
import { useSpeechVoices } from '@/components/settings/use-speech-voices';
import {
  RESPONSE_SCOPE_OPTIONS,
  WORKING_SOUND_OPTIONS,
} from '@/components/settings/settings-utils';
import { OverlaySheet } from '@/components/ui/overlay-sheet';
import { useLastJsError } from '@/hooks/use-last-js-error';
import { usePalette } from '@/hooks/use-palette';
import { getSpeechPlayback } from '@/lib/voice/speech-config';
import { useApprovals, useCapabilities, useConnection, useDiagnostics, useMcp, useOnboarding, usePreferences, useProjects, useUpdates } from '@/providers/opencode-contexts';
import { buildSettingsSections } from '@/components/settings/settings-section-registry';

export default function SettingsScreen() {
  const registry = useWorkspaces();
  return <WorkspaceScope target={registry.inspectionTarget ?? registry.focus}><SettingsContent /></WorkspaceScope>;
}

function SettingsContent() {
  const insets = useSafeAreaInsets();
  const palette = usePalette();
  const { t } = useTranslation();
  const { configuredProviders, currentConfig } = useCapabilities();
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
  const [advancedTab, setAdvancedTab] = useState<'mcp' | 'diagnostics'>('mcp');
  const [openSection, setOpenSection] = useState<string>();
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
      <Appbar.Header
        style={[styles.header, { backgroundColor: palette.surface, paddingTop: insets.top, height: 64 + insets.top }]}
        statusBarHeight={0}
        elevated>
        <View style={styles.headerMain}>
          <Text maxFontSizeMultiplier={1.5} variant="titleMedium" style={[styles.headerTitle, { color: palette.text }]}>{t('common:tabs.settings')}</Text>
        </View>
        <View style={styles.headerActions}>
          <Appbar.Action icon="refresh" accessibilityLabel={t('common:actions.reconnect')} loading={isConnecting} disabled={isConnecting} onPress={() => void handleConnect()} />
        </View>
      </Appbar.Header>
      <ScrollView style={[styles.screen, { backgroundColor: palette.background }]} contentContainerStyle={styles.content}>
        {[{ label: t('common:servers.serverSettings'), ids: ['ai', 'extensions', 'advanced', 'permissions'], server: true },
          { label: t('common:servers.appSettings'), ids: ['connection', 'cloud-link', 'general', 'notifications', 'voice', 'responses', 'support'], server: false }].map((group) => <View key={group.label} style={{ gap: 12, marginBottom: 20 }}>
          <Text variant="titleMedium">{group.label}</Text>
          {group.server ? <ServerContextPicker /> : null}
          <View style={[styles.categoryGroup, { backgroundColor: palette.surface, borderColor: palette.border }]}>
          {sections.filter((section) => group.ids.includes(section.id)).map((section, index) => <Pressable key={section.id} accessibilityRole="button" accessibilityLabel={`${section.title}. ${section.summary}`} onPress={section.onPress} style={[styles.category, index > 0 && { borderTopColor: palette.border, borderTopWidth: StyleSheet.hairlineWidth }]}>
            <MaterialCommunityIcons name={section.icon} size={22} color={palette.tint} />
            <View style={styles.categoryText}><Text variant="titleMedium" style={{ color: palette.text }}>{section.title}</Text><Text variant="bodyMedium" numberOfLines={section.summaryLines ?? 1} style={{ color: palette.muted }}>{section.summary}</Text></View>
            <MaterialCommunityIcons name="chevron-right" size={20} color={palette.muted} />
          </Pressable>)}
          </View>
        </View>)}
      </ScrollView>

      <OverlaySheet visible={Boolean(activeSection)} fitContent testID="settings-section-overlay" title={activeSection?.title ?? t('common:tabs.settings')} onClose={() => setOpenSection(undefined)}>
        {['ai', 'extensions', 'advanced', 'permissions'].includes(activeSection?.id ?? '') ? <ServerContextPicker project={activeSection?.id === 'advanced' || activeSection?.id === 'extensions'} /> : null}
        <View key={['ai', 'extensions', 'advanced', 'permissions'].includes(activeSection?.id ?? '') ? `${getConnectionUiScope(settings)}:${activeProjectPath ?? ''}` : activeSection?.id}>{activeSection?.render?.() ?? null}</View>
      </OverlaySheet>

      <Snackbar
        visible={Boolean(notifications.feedback)}
        onDismiss={notifications.clearFeedback}
        duration={4000}>
        {notifications.feedback}
      </Snackbar>
      <Snackbar
        visible={Boolean(voiceSetup.feedback)}
        onDismiss={voiceSetup.clearFeedback}
        duration={4000}>
        {voiceSetup.feedback}
      </Snackbar>
      <Snackbar
        visible={Boolean(reconnectFeedback)}
        onDismiss={() => setReconnectFeedback(undefined)}
        duration={4000}>
        {reconnectFeedback}
      </Snackbar>
    </>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: 16, paddingBottom: 28, width: '100%', maxWidth: 800, alignSelf: 'center' },
  header: { elevation: 0 },
  headerMain: { alignSelf: 'stretch', flex: 1, justifyContent: 'center', minWidth: 0 },
  headerActions: { alignItems: 'center', flexDirection: 'row', flexShrink: 0 },
  headerTitle: { fontFamily: Fonts.display, fontWeight: '700' },
  categoryGroup: { borderRadius: 18, borderWidth: 1, overflow: 'hidden' },
  category: { minHeight: 76, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', gap: 16 },
  categoryText: { flex: 1, gap: 2 },
});
