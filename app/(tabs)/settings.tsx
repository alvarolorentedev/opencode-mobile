import * as WebBrowser from 'expo-web-browser';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { type ComponentProps, type ReactNode, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Alert, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Appbar,
  Snackbar,
  Text,
} from 'react-native-paper';

import { Colors, Fonts } from '@/constants/theme';
import { McpSection } from '@/components/settings/mcp-section';
import {
  AiDefaultsSection,
  EditorSection,
  ConnectionSection,
  SubscriptionSection,
  DiagnosticsSection,
  GeneralSection,
  NotificationsSection,
  PermissionsSection,
  SupportSection,
  VoiceSection,
} from '@/components/settings/settings-sections';
import { useNotificationSetup } from '@/components/settings/use-notification-setup';
import { useProviderConfiguration } from '@/components/settings/use-provider-configuration';
import { useVoiceSetup } from '@/components/settings/use-voice-setup';
import {
  getProviderCopy,
  RESPONSE_SCOPE_OPTIONS,
  WORKING_SOUND_OPTIONS,
} from '@/components/settings/settings-utils';
import { OverlaySheet } from '@/components/ui/overlay-sheet';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { getSpeechVoiceOptions, type SpeechVoiceOption } from '@/lib/voice/speech-output';
import { useApprovals, useCapabilities, useConnection, useDiagnostics, useMcp, useOnboarding, usePreferences } from '@/providers/opencode-contexts';

// One entry per settings section. Adding a section means adding an entry here
// (and its presentational component); the row list and the overlay both derive
// from this array, so there is a single place to edit.
type SettingsSection = {
  id: string;
  icon: ComponentProps<typeof MaterialCommunityIcons>['name'];
  title: string;
  summary: string;
  onPress: () => void;
  render?: () => ReactNode;
};

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const { t } = useTranslation();
  const { availableModels, availableProviders, configuredProviders, currentConfig, providerAccounts, providerAuthMethodsById, removeProvider } = useCapabilities();
  const { addMcpServer, completeMcpOAuth, connectMcpServer, disconnectMcpServer, mcpStatuses, refreshMcpServers, setMcpServerEnabled, startMcpOAuth } = useMcp();
  const { chatPreferences, updateChatPreferences } = usePreferences();
  const { connect, connection, serverCapabilities, connectSetup } = useConnection();
  const { diagnostics, eventStreamStatus, refreshDiagnostics } = useDiagnostics();
  const { approvals } = useApprovals();
  const { startOnboardingReview } = useOnboarding();
  const router = useRouter();
  const notifications = useNotificationSetup();
  const providerConfig = useProviderConfiguration();
  const voiceSetup = useVoiceSetup({
    locale: chatPreferences.speechLocale,
    rate: chatPreferences.speechRate,
    voiceId: chatPreferences.speechVoiceId,
  });
  const [isConnecting, setIsConnecting] = useState(false);
  const [openSection, setOpenSection] = useState<string>();
  const [expandedProviderId, setExpandedProviderId] = useState<string>();
  const [availableSpeechVoices, setAvailableSpeechVoices] = useState<SpeechVoiceOption[]>([]);
  const [isRefreshingSpeechVoices, setIsRefreshingSpeechVoices] = useState(false);

  const enabledModelIds = useMemo(() => new Set(chatPreferences.enabledModelIds), [chatPreferences.enabledModelIds]);

  async function handleConnect() {
    setIsConnecting(true);
    try {
      await connect();
    } finally {
      setIsConnecting(false);
    }
  }

  async function refreshSpeechVoices() {
    setIsRefreshingSpeechVoices(true);
    try {
      setAvailableSpeechVoices(await getSpeechVoiceOptions());
    } catch {
      setAvailableSpeechVoices([]);
    } finally {
      setIsRefreshingSpeechVoices(false);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrate speech status once on mount.
    void refreshSpeechVoices();
  }, []);

  const selectedSpeechVoiceLabel = useMemo(
    () => availableSpeechVoices.find((voice) => voice.id === chatPreferences.speechVoiceId)?.label || t('common:labels.systemDefault'),
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

  function handleModelToggle(modelId: string, checked: boolean) {
    const nextEnabledModelIds = checked
      ? chatPreferences.enabledModelIds.filter((id) => id !== modelId)
      : [...chatPreferences.enabledModelIds, modelId];

    updateChatPreferences({ enabledModelIds: nextEnabledModelIds });
  }

  function handleRemoveProvider(providerId: string) {
    const label = getProviderCopy(providerId, providerId, t).label;
    const remove = () => void removeProvider(providerId)
      .then(() => providerConfig.setFeedback({ type: 'success', message: t('settings:providers.credentialsRemoved', { provider: label }) }))
      .catch((error) => providerConfig.setFeedback({ type: 'error', message: error instanceof Error ? error.message : t('settings:providers.couldNotRemove') }));
    if (Platform.OS === 'web') {
      if (globalThis.confirm(t('settings:providers.removeWebConfirm', { provider: label }))) remove();
      return;
    }
    Alert.alert(t('settings:providers.removeTitle', { provider: label }), t('settings:providers.removeMessage'), [
      { text: t('common:actions.cancel'), style: 'cancel' },
      { text: t('common:actions.remove'), style: 'destructive', onPress: remove },
    ]);
  }

  const sections: SettingsSection[] = [
    {
      id: 'connection',
      icon: 'server-network',
      title: t('settings:screen.categories.connection'),
      summary: connection.status === 'connected' ? t('common:labels.connected') : connection.message,
      onPress: () => setOpenSection('connection'),
      render: () => <ConnectionSection connection={connection} palette={palette} onManageConnect={connectSetup.enabled ? () => { setOpenSection(undefined); router.push('/pair?mode=manage'); } : undefined} onPair={connectSetup.enabled ? () => { setOpenSection(undefined); router.push('/pair'); } : undefined} />,
    },
    ...(connectSetup.enabled ? [{
      id: 'subscription',
      icon: 'crown-outline' as const,
      title: t('settings:screen.categories.subscription'),
      summary: `${t('settings:connect.title')} · ${connectSetup.initialization === 'loading' ? t('settings:connect.progress.idle') : connectSetup.entitled ? t('common:labels.active') : t('settings:subscription.inactive')}`,
      onPress: () => setOpenSection('subscription'),
      render: () => <SubscriptionSection setup={connectSetup} palette={palette} onManageMachines={() => { setOpenSection(undefined); router.push('/pair?mode=manage'); }} />,
    }] : []),
    {
      id: 'ai',
      icon: 'creation',
      title: t('settings:screen.categories.ai'),
      summary: t('settings:screen.summaries.configuredCount', { value: configuredProviders.length }),
      onPress: () => setOpenSection('ai'),
      render: () => <AiDefaultsSection availableModels={availableModels} availableProviders={availableProviders} configuredProviders={configuredProviders} contract={serverCapabilities.contract} enabledModelIds={enabledModelIds} expandedProviderId={expandedProviderId} onActivateProviderAccount={(credentialId) => void providerAccounts.activate(credentialId)} onExpandedProviderChange={setExpandedProviderId} onModelToggle={handleModelToggle} onRemoveProvider={handleRemoveProvider} onRemoveProviderAccount={(credentialId) => void providerAccounts.remove(credentialId)} onStartProviderConfiguration={providerConfig.startProviderConfiguration} palette={palette} providerAuthMethodsById={providerAuthMethodsById} />,
    },
    {
      id: 'notifications',
      icon: 'bell-outline',
      title: t('settings:screen.categories.notifications'),
      summary: notifications.status?.permissionGranted ? t('common:labels.enabled') : t('common:labels.off'),
      onPress: () => setOpenSection('notifications'),
      render: () => <NotificationsSection isRefreshingNotificationStatus={notifications.isRefreshing} notificationStatus={notifications.status} onEnableNotifications={() => void notifications.enable()} onOpenAppSettings={() => void notifications.openAppSettings()} onOpenBatterySaverSettings={() => void notifications.openBatterySaverSettings()} onOpenBatterySettings={() => void notifications.openBatterySettings()} onOpenNotificationSettings={() => void notifications.openNotificationSettings()} onRefreshStatus={() => void notifications.refreshStatus()} palette={palette} />,
    },
    {
      id: 'voice',
      icon: 'waveform',
      title: t('settings:screen.categories.voice'),
      summary: chatPreferences.autoPlayAssistantReplies ? t('settings:screen.summaries.replyPlaybackOn') : t('settings:screen.summaries.replyPlaybackOff'),
      onPress: () => setOpenSection('voice'),
      render: () => <VoiceSection availableSpeechVoices={availableSpeechVoices} chatPreferences={chatPreferences} isRefreshingSpeechVoices={isRefreshingSpeechVoices} isRefreshingVoiceCapabilities={voiceSetup.isRefreshing} isTestingVoice={voiceSetup.isTesting} onEnableVoiceInput={() => void voiceSetup.enable()} onOpenVoiceSettings={() => void voiceSetup.openAppSettings()} onRefreshVoiceCapabilities={() => void voiceSetup.refreshStatus()} onTestVoicePlayback={() => void voiceSetup.testPlayback()} palette={palette} selectedResponseScope={selectedResponseScope} selectedSpeechVoiceLabel={selectedSpeechVoiceLabel} selectedWorkingSound={selectedWorkingSound} updateChatPreferences={updateChatPreferences} voiceCapabilities={voiceSetup.capabilities} />,
    },
    {
      id: 'advanced',
      icon: 'tune',
      title: t('settings:screen.categories.advanced'),
      summary: t('settings:screen.summaries.advanced'),
      onPress: () => setOpenSection('advanced'),
      render: () => (
        <>
          <EditorSection chatPreferences={chatPreferences} contract={serverCapabilities.contract} palette={palette} updateChatPreferences={updateChatPreferences} />
          <GeneralSection chatPreferences={chatPreferences} palette={palette} updateChatPreferences={updateChatPreferences} onResetOnboarding={() => {
            setOpenSection(undefined);
            startOnboardingReview();
            router.push('/onboarding');
          }} />
          <McpSection configs={currentConfig?.mcp} mcpStatuses={mcpStatuses} onAdd={addMcpServer} onCompleteOAuth={completeMcpOAuth} onConnect={connectMcpServer} onDisconnect={disconnectMcpServer} onRefresh={refreshMcpServers} onSetEnabled={setMcpServerEnabled} onStartOAuth={async (name) => { const url = await startMcpOAuth(name); if (!url) { await refreshMcpServers(); return false; } await WebBrowser.openBrowserAsync(url); return true; }} oauthAvailable={serverCapabilities.mcpOAuth} palette={palette} />
          <DiagnosticsSection diagnostics={diagnostics} eventStreamStatus={eventStreamStatus} formatterAvailable={serverCapabilities.formatter} lspAvailable={serverCapabilities.lsp} onRefresh={() => void refreshDiagnostics()} palette={palette} />
        </>
      ),
    },
    ...(serverCapabilities.savedPermissions ? [{
      id: 'permissions',
      icon: 'shield-key-outline' as const,
      title: t('settings:screen.categories.permissions'),
      summary: t('settings:screen.summaries.permissions', { value: approvals.savedPermissions.length }),
      onPress: () => {
        setOpenSection('permissions');
        void approvals.refreshSavedPermissions();
      },
      render: () => (
        <PermissionsSection
          palette={palette}
          rules={approvals.savedPermissions}
          onRefresh={() => void approvals.refreshSavedPermissions()}
          onRemove={(id) => void approvals.removeSavedPermission(id)}
        />
      ),
    }] : []),
    {
      id: 'support',
      icon: 'lifebuoy',
      title: t('settings:screen.categories.support'),
      summary: t('settings:screen.summaries.support'),
      onPress: () => setOpenSection('support'),
      render: () => <SupportSection palette={palette} />,
    },
  ];

  const activeSection = sections.find((section) => section.id === openSection);

  return (
    <>
      <Appbar.Header
        style={[styles.header, { backgroundColor: palette.surface, paddingTop: insets.top, height: 64 + insets.top }]}
        statusBarHeight={0}
        elevated>
        <View style={styles.headerMain}>
          <Text variant="titleMedium" style={[styles.headerTitle, { color: palette.text }]}>{t('common:tabs.settings')}</Text>
        </View>
        <View style={styles.headerActions}>
          <Appbar.Action icon="refresh" accessibilityLabel={t('common:actions.reconnect')} loading={isConnecting} disabled={isConnecting} onPress={() => void handleConnect()} />
        </View>
      </Appbar.Header>
      <ScrollView style={[styles.screen, { backgroundColor: palette.background }]} contentContainerStyle={styles.content}>
        <View style={[styles.categoryGroup, { backgroundColor: palette.surface, borderColor: palette.border }]}>
        {sections.map((section, index) => <Pressable key={section.id} accessibilityRole="button" accessibilityLabel={`${section.title}. ${section.summary}`} onPress={section.onPress} style={[styles.category, index < sections.length - 1 && { borderBottomColor: palette.border, borderBottomWidth: StyleSheet.hairlineWidth }]}>
          <MaterialCommunityIcons name={section.icon} size={22} color={palette.tint} />
          <View style={styles.categoryText}><Text variant="titleMedium" style={{ color: palette.text }}>{section.title}</Text><Text variant="bodyMedium" numberOfLines={1} style={{ color: palette.muted }}>{section.summary}</Text></View>
          <MaterialCommunityIcons name="chevron-right" size={20} color={palette.muted} />
        </Pressable>)}
        </View>
      </ScrollView>

      <OverlaySheet visible={Boolean(activeSection)} fitContent testID="settings-section-overlay" title={activeSection?.title ?? t('common:tabs.settings')} onClose={() => setOpenSection(undefined)}>
        {activeSection?.render?.() ?? null}
      </OverlaySheet>

      {providerConfig.dialog}

      <Snackbar
        visible={Boolean(providerConfig.feedback)}
        onDismiss={providerConfig.clearFeedback}
        duration={4000}>
        {providerConfig.feedback?.message}
      </Snackbar>
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
