import { MaterialCommunityIcons } from '@expo/vector-icons';
import { type ComponentProps, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Appbar,
  Button,
  Snackbar,
  Text,
} from 'react-native-paper';

import { Colors, Fonts } from '@/constants/theme';
import { WorkspaceScope, useWorkspaces } from '@/providers/workspace-context';
import { getConnectionUiScope } from '@/lib/connection-scope';
import { ServerContextPicker } from '@/components/settings/server-context-picker';
import { ServerApprovals } from '@/components/settings/server-approvals';
import { McpSection } from '@/components/settings/mcp-section';
import {
  EditorSection,
  ConnectionSection,
  CloudLinkSection,
  DiagnosticsSection,
  GeneralSection,
  NotificationsSection,
  SupportSection,
  UpdateSection,
  VoiceSection,
} from '@/components/settings/settings-sections';
import { useNotificationSetup } from '@/components/settings/use-notification-setup';
import { AiSettingsPanel } from '@/components/settings/ai-settings-panel';
import { useVoiceSetup } from '@/components/settings/use-voice-setup';
import {
  RESPONSE_SCOPE_OPTIONS,
  WORKING_SOUND_OPTIONS,
} from '@/components/settings/settings-utils';
import { OverlaySheet } from '@/components/ui/overlay-sheet';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useLastJsError } from '@/hooks/use-last-js-error';
import { getSpeechVoiceOptions, type SpeechVoiceOption } from '@/lib/voice/speech-output';
import { useApprovals, useCapabilities, useConnection, useDiagnostics, useMcp, useOnboarding, usePreferences, useProjects, useUpdates } from '@/providers/opencode-contexts';

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
  const registry = useWorkspaces();
  return <WorkspaceScope target={registry.inspectionTarget ?? registry.focus}><SettingsContent /></WorkspaceScope>;
}

function SettingsContent() {
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const { t } = useTranslation();
  const { configuredProviders, currentConfig } = useCapabilities();
  const { addMcpServer, mcpOAuth, connectMcpServer, disconnectMcpServer, mcpStatuses, refreshMcpServers, setMcpServerEnabled } = useMcp();
  const { chatPreferences, updateChatPreferences } = usePreferences();
  const { connect, connection, settings, serverCapabilities, connectSetup, services: serviceManagement } = useConnection();
  const { activeProjectPath } = useProjects();
  const { diagnostics, eventStreamStatus, refreshDiagnostics, transport } = useDiagnostics();
  const { lastJsError, refreshLastJsError } = useLastJsError();
  const { approvals } = useApprovals();
  const { startOnboardingReview } = useOnboarding();
  const updates = useUpdates();
  const router = useRouter();
  const notifications = useNotificationSetup();
  const voiceSetup = useVoiceSetup({
    locale: chatPreferences.speechLocale,
    rate: chatPreferences.speechRate,
    voiceId: chatPreferences.speechVoiceId,
  });
  const [isConnecting, setIsConnecting] = useState(false);
  const [advancedTab, setAdvancedTab] = useState<'mcp' | 'diagnostics'>('mcp');
  const [openSection, setOpenSection] = useState<string>();
  // Reopening Cloud Link after the full-screen service editor returns keeps the
  // user in context without leaving a portal sheet over the pushed route.
  const returnToCloudLink = useRef(false);
  const [availableSpeechVoices, setAvailableSpeechVoices] = useState<SpeechVoiceOption[]>([]);
  const [isRefreshingSpeechVoices, setIsRefreshingSpeechVoices] = useState(false);

  async function handleConnect() {
    setIsConnecting(true);
    try {
      await connect();
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

  const sections: SettingsSection[] = [
    {
      id: 'connection',
      icon: 'server-network',
      title: t('settings:screen.categories.connection'),
      summary: connection.status === 'connected' ? t('common:labels.connected') : connection.message,
      onPress: () => setOpenSection('connection'),
      render: () => <ConnectionSection connection={connection} palette={palette} onManageConnect={connectSetup.enabled ? () => { setOpenSection(undefined); router.push('/pair?mode=manage'); } : undefined} onPair={connectSetup.enabled ? () => { setOpenSection(undefined); router.push('/pair'); } : undefined} />,
    },
    {
      id: 'ai',
      icon: 'creation',
      title: t('settings:screen.categories.ai'),
      summary: t('settings:screen.summaries.configuredCount', { value: configuredProviders.length }),
      onPress: () => setOpenSection('ai'),
      render: () => <AiSettingsPanel />,
    },
    ...(connectSetup.enabled && connectSetup.storeInstall ? [{
      id: 'cloud-link',
      icon: 'cloud-outline' as const,
      title: t('settings:screen.categories.cloudLink'),
      summary: connectSetup.initialization === 'loading' ? t('settings:connect.progress.idle') : connectSetup.entitled ? t('common:labels.active') : t('settings:subscription.inactive'),
      onPress: () => { setOpenSection('cloud-link'); void serviceManagement.refresh(); },
      render: () => <CloudLinkSection setup={connectSetup} services={serviceManagement} palette={palette} onManageMachines={() => { setOpenSection(undefined); router.push('/pair?mode=manage'); }} onAddService={() => openServiceEditor()} onEditService={(service) => openServiceEditor(service.id)} />,
    }] : []),
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
      id: 'general', icon: 'cog-outline', title: t('common:servers.appSettings'), summary: t('common:servers.appSettingsSummary'),
      onPress: () => setOpenSection('general'), render: () => <>
          <EditorSection chatPreferences={chatPreferences} contract={serverCapabilities.contract} palette={palette} updateChatPreferences={updateChatPreferences} />
          <GeneralSection chatPreferences={chatPreferences} palette={palette} updateChatPreferences={updateChatPreferences} onResetOnboarding={() => {
            setOpenSection(undefined);
            startOnboardingReview();
            router.push('/onboarding');
          }} />
          {updates.supported ? <UpdateSection checkPeriod={updates.checkPeriod} enabled={updates.enabled} onCheckPeriodChange={updates.setCheckPeriod} onEnabledChange={updates.setEnabled} palette={palette} /> : null}
      </>,
    },
    {
      id: 'advanced',
      icon: 'tune',
      title: t('settings:screen.categories.advanced'),
      summary: t('common:servers.serverToolsSummary'),
      onPress: () => setOpenSection('advanced'),
      render: () => (
        <>
          <View style={{ flexDirection: 'row', gap: 8 }}><Button mode={advancedTab === 'mcp' ? 'contained-tonal' : 'text'} onPress={() => setAdvancedTab('mcp')}>MCP</Button><Button mode={advancedTab === 'diagnostics' ? 'contained-tonal' : 'text'} onPress={() => setAdvancedTab('diagnostics')}>{t('settings:diagnostics.title')}</Button></View>
          {advancedTab === 'mcp' ? <>
          <McpSection configs={currentConfig?.mcp} mcpStatuses={mcpStatuses} onAdd={addMcpServer} onConnect={connectMcpServer} onDisconnect={disconnectMcpServer} onRefresh={refreshMcpServers} onSetEnabled={setMcpServerEnabled} mcpOAuth={mcpOAuth} persistentConfigAvailable={serverCapabilities.configWrite} requiresIntegrationId={serverCapabilities.contract === 'v2'} oauthAvailable={serverCapabilities.mcpOAuth} palette={palette} />
          </> : <>
          <DiagnosticsSection diagnostics={diagnostics} eventStreamStatus={eventStreamStatus} transport={transport} formatterAvailable={serverCapabilities.formatter} lastJsError={lastJsError} lspAvailable={serverCapabilities.lsp} onRefresh={() => { void refreshDiagnostics(); refreshLastJsError(); }} palette={palette} />
          </>}
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
      render: () => <ServerApprovals />,
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
        {[{ label: t('common:servers.serverSettings'), ids: ['ai', 'advanced', 'permissions'], server: true },
          { label: t('common:servers.appSettings'), ids: ['connection', 'cloud-link', 'general', 'notifications', 'voice', 'support'], server: false }].map((group) => <View key={group.label} style={{ gap: 12, marginBottom: 20 }}>
          <Text variant="titleMedium">{group.label}</Text>
          {group.server ? <ServerContextPicker /> : null}
          <View style={[styles.categoryGroup, { backgroundColor: palette.surface, borderColor: palette.border }]}>
          {sections.filter((section) => group.ids.includes(section.id)).map((section, index) => <Pressable key={section.id} accessibilityRole="button" accessibilityLabel={`${section.title}. ${section.summary}`} onPress={section.onPress} style={[styles.category, index > 0 && { borderTopColor: palette.border, borderTopWidth: StyleSheet.hairlineWidth }]}>
            <MaterialCommunityIcons name={section.icon} size={22} color={palette.tint} />
            <View style={styles.categoryText}><Text variant="titleMedium" style={{ color: palette.text }}>{section.title}</Text><Text variant="bodyMedium" numberOfLines={1} style={{ color: palette.muted }}>{section.summary}</Text></View>
            <MaterialCommunityIcons name="chevron-right" size={20} color={palette.muted} />
          </Pressable>)}
          </View>
        </View>)}
      </ScrollView>

      <OverlaySheet visible={Boolean(activeSection)} fitContent testID="settings-section-overlay" title={activeSection?.title ?? t('common:tabs.settings')} onClose={() => setOpenSection(undefined)}>
        {['ai', 'advanced', 'permissions'].includes(activeSection?.id ?? '') ? <ServerContextPicker project={activeSection?.id === 'advanced'} /> : null}
        <View key={['ai', 'advanced', 'permissions'].includes(activeSection?.id ?? '') ? `${getConnectionUiScope(settings)}:${activeProjectPath ?? ''}` : activeSection?.id}>{activeSection?.render?.() ?? null}</View>
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
