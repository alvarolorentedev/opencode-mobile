import { SettingButton as Button, SettingSwitchRow } from './sections/setting-rows';
import type { ComponentProps, ReactNode } from 'react';
import type { TFunction } from 'i18next';
import { useRouter } from 'expo-router';
import { Platform, View } from 'react-native';
import {} from 'react-native-paper';
import type { MaterialCommunityIcons } from '@expo/vector-icons';

import { ServerApprovals } from '@/components/settings/server-approvals';
import { McpSection } from '@/components/settings/mcp-section';
import { ExtensionsSection } from '@/components/settings/extensions-section';
import { EditorSection } from '@/components/settings/sections/editor-section';
import { ConnectionSection } from '@/components/settings/sections/connection-section';
import { CloudLinkSection } from '@/components/settings/sections/cloud-link-section';
import { DiagnosticsSection } from '@/components/settings/sections/diagnostics-section';
import { AppearanceSection } from '@/components/settings/sections/appearance-section';
import { LanguageSection } from '@/components/settings/sections/language-section';
import { settingsTargets } from '@/components/settings/settings-targets';
import type { SettingsTarget } from '@/components/settings/settings-search';
import { GeneralSection } from '@/components/settings/sections/general-section';
import { NotificationsSection } from '@/components/settings/sections/notifications-section';
import { SupportSection } from '@/components/settings/sections/support-section';
import { UpdateSection } from '@/components/settings/sections/update-section';
import { VoiceSection } from '@/components/settings/sections/voice-section';
import { ResponsesSection } from '@/components/settings/sections/responses-section';
import { AiSettingsPanel } from '@/components/settings/ai-settings-panel';
import { useNotificationSetup } from '@/components/settings/use-notification-setup';
import type { useTtsSetup } from '@/components/settings/use-tts-setup';
import { useVoiceSetup } from '@/components/settings/use-voice-setup';
import type { RESPONSE_SCOPE_OPTIONS, WORKING_SOUND_OPTIONS } from '@/components/settings/settings-utils';
import { useLastJsError } from '@/hooks/use-last-js-error';
import { usePalette } from '@/hooks/use-palette';
import { DEFAULT_WAKE_PHRASE } from '@/lib/voice/wake-phrase';
import { LOCAL_WAKE_PHRASES } from '@/lib/voice/local-wake-word/types';
import type { SpeechVoiceOption } from '@/lib/voice/speech-output';
import { useApprovals, useCapabilities, useConnection, useDiagnostics, useMcp, useOnboarding, usePreferences, useUpdates } from '@/providers/opencode-contexts';

export type SettingsSection = {
  id: string;
  group: 'app' | 'connections' | 'server';
  keywords?: string;
  targets?: SettingsTarget[];
  icon: ComponentProps<typeof MaterialCommunityIcons>['name'];
  title: string;
  summary: string;
  summaryLines?: number;
  onPress: () => void;
  render?: () => ReactNode;
};

type RegistryInput = {
  t: TFunction;
  palette: ReturnType<typeof usePalette>;
  connection: ReturnType<typeof useConnection>['connection'];
  connectSetup: ReturnType<typeof useConnection>['connectSetup'];
  serviceManagement: ReturnType<typeof useConnection>['services'];
  autoModelAvailable: boolean;
  onReconnect: () => void;
  isReconnecting: boolean;
  configuredProviders: ReturnType<typeof useCapabilities>['configuredProviders'];
  currentConfig: ReturnType<typeof useCapabilities>['currentConfig'];
  mcp: ReturnType<typeof useMcp>;
  chatPreferences: ReturnType<typeof usePreferences>['chatPreferences'];
  updateChatPreferences: ReturnType<typeof usePreferences>['updateChatPreferences'];
  serverCapabilities: ReturnType<typeof useConnection>['serverCapabilities'];
  diagnosticsData: ReturnType<typeof useDiagnostics>;
  lastJsError: ReturnType<typeof useLastJsError>['lastJsError'];
  refreshLastJsError: ReturnType<typeof useLastJsError>['refreshLastJsError'];
  approvals: ReturnType<typeof useApprovals>['approvals'];
  startOnboardingReview: ReturnType<typeof useOnboarding>['startOnboardingReview'];
  updates: ReturnType<typeof useUpdates>;
  router: ReturnType<typeof useRouter>;
  notifications: ReturnType<typeof useNotificationSetup>;
  voiceSetup: ReturnType<typeof useVoiceSetup>;
  ttsSetup: ReturnType<typeof useTtsSetup>;
  availableSpeechVoices: SpeechVoiceOption[];
  isRefreshingSpeechVoices: boolean;
  selectedSpeechVoiceLabel: string;
  selectedResponseScope: (typeof RESPONSE_SCOPE_OPTIONS)[number];
  selectedWorkingSound: (typeof WORKING_SOUND_OPTIONS)[number];
  advancedTab: 'mcp' | 'diagnostics';
  setAdvancedTab: (tab: 'mcp' | 'diagnostics') => void;
  setOpenSection: (id?: string) => void;
  openServiceEditor: (id?: string) => void;
};

export function buildSettingsSections({
  t,
  palette,
  connection,
  connectSetup,
  serviceManagement,
  configuredProviders,
  autoModelAvailable,
  onReconnect,
  isReconnecting,
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
}: RegistryInput): SettingsSection[] {
  const voicePhrase = chatPreferences.voiceWakeMode === 'local'
    ? LOCAL_WAKE_PHRASES[chatPreferences.localWakePhrase].label
    : chatPreferences.conversationWakePhrase || DEFAULT_WAKE_PHRASE;
  const localVoiceSummary = voiceSetup.localVoice.status === 'ready'
    ? chatPreferences.localSpeakerVerification && !voiceSetup.localVoice.enrollment.hasProfile
      ? t('settings:voice.localWake.notEnrolled')
      : voicePhrase
    : voiceSetup.localVoice.status === 'installing'
      ? t('settings:voice.localWake.statusInstalling')
      : voiceSetup.localVoice.status === 'error'
        ? t('settings:voice.localWake.statusError')
        : voiceSetup.localVoice.status === 'unsupported'
          ? t('settings:voice.localWake.statusUnsupported')
          : t('settings:voice.localWake.statusMissing');
  const voiceSummary = chatPreferences.voiceWakeMode === 'local'
    ? t('settings:screen.summaries.voiceLocal', { phrase: localVoiceSummary })
    : t('settings:screen.summaries.voiceSystem', { phrase: voicePhrase });

  const sections: SettingsSection[] = [
    {
      id: 'connection', group: 'connections' as const,
      icon: 'server-network',
      title: t('settings:screen.categories.connection'),
      summary: connection.status === 'connected' ? t('common:labels.connected') : connection.message,
      summaryLines: 2,
      onPress: () => setOpenSection('connection'),
      render: () => <ConnectionSection onReconnect={onReconnect} isReconnecting={isReconnecting} connection={connection} palette={palette} onManageConnect={connectSetup.enabled ? () => { setOpenSection(undefined); router.push('/pair?mode=manage'); } : undefined} onPair={connectSetup.enabled ? () => { setOpenSection(undefined); router.push('/pair'); } : undefined} />,
    },
    {
      id: 'ai', group: 'server' as const,
      icon: 'creation',
      title: t('settings:screen.categories.ai'),
      summary: t('settings:screen.summaries.configuredCount', { value: configuredProviders.length }),
      onPress: () => setOpenSection('ai'),
      render: () => <AiSettingsPanel />,
    },
    ...(serverCapabilities.contract === 'v2' ? [{
      id: 'extensions', group: 'server' as const,
      icon: 'puzzle-outline' as const,
      title: t('settings:screen.categories.extensions'),
      summary: t('settings:screen.summaries.extensions'),
      onPress: () => setOpenSection('extensions'),
      render: () => <ExtensionsSection />,
    }] : []),
    ...(connectSetup.enabled && connectSetup.storeInstall ? [{
      id: 'cloud-link', group: 'connections' as const,
      icon: 'cloud-outline' as const,
      title: t('settings:screen.categories.cloudLink'),
      summary: connectSetup.initialization === 'loading' ? t('settings:connect.progress.idle') : connectSetup.entitled ? t('common:labels.active') : t('settings:subscription.inactive'),
      onPress: () => { setOpenSection('cloud-link'); void serviceManagement.refresh(); },
      render: () => <CloudLinkSection setup={connectSetup} services={serviceManagement} palette={palette} onManageMachines={() => { setOpenSection(undefined); router.push('/pair?mode=manage'); }} onAddService={() => openServiceEditor()} onEditService={(service) => openServiceEditor(service.id)} />,
    }] : []),
    {
      id: 'notifications', group: 'app' as const,
      icon: 'bell-outline',
      title: t('settings:screen.categories.notifications'),
      summary: !notifications.status ? t('settings:notifications.status.checking') : notifications.status.permissionGranted ? t('common:labels.enabled') : t('common:labels.off'),
      onPress: () => setOpenSection('notifications'),
      render: () => <>
        <NotificationsSection isRefreshingNotificationStatus={notifications.isRefreshing} notificationStatus={notifications.status} onEnableNotifications={() => void notifications.enable()} onOpenAppSettings={() => void notifications.openAppSettings()} onOpenBatterySaverSettings={() => void notifications.openBatterySaverSettings()} onOpenBatterySettings={() => void notifications.openBatterySettings()} onOpenNotificationSettings={() => void notifications.openNotificationSettings()} onRefreshStatus={() => void notifications.refreshStatus()} palette={palette} />
        {Platform.OS === 'android' ? <SettingSwitchRow title={t('share:widgets.previewsTitle')} description={t('share:widgets.previewsDescription')} value={chatPreferences.showWidgetPreviews !== false} palette={palette} onValueChange={(showWidgetPreviews) => updateChatPreferences({ showWidgetPreviews })} /> : null}
      </>,
    },
    {
      id: 'voice', group: 'app' as const,
      icon: 'waveform',
      title: t('settings:screen.categories.voice'),
      summary: voiceSummary,
      onPress: () => setOpenSection('voice'),
      render: () => <VoiceSection availableSpeechVoices={availableSpeechVoices} chatPreferences={chatPreferences} isRefreshingSpeechVoices={isRefreshingSpeechVoices} isRefreshingVoiceCapabilities={voiceSetup.isRefreshing} isTestingVoice={voiceSetup.isTesting} localVoice={voiceSetup.localVoice} onEnableVoiceInput={() => void voiceSetup.enable()} onOpenVoiceSettings={() => void voiceSetup.openAppSettings()} onRefreshVoiceCapabilities={() => void voiceSetup.refreshStatus()} onTestVoicePlayback={() => void voiceSetup.testPlayback()} palette={palette} selectedSpeechVoiceLabel={selectedSpeechVoiceLabel} selectedWorkingSound={selectedWorkingSound} ttsSetup={ttsSetup} updateChatPreferences={updateChatPreferences} voiceCapabilities={voiceSetup.capabilities} />,
    },
    {
      id: 'responses', group: 'app' as const,
      icon: 'message-text-outline',
      title: t('settings:screen.categories.chat'),
      summary: t(`settings:screen.summaries.${chatPreferences.includeNextActions ? 'responsesOn' : 'responsesOff'}`, {
        scope: t(`settings:voice.responseScope.${selectedResponseScope.value}.label`),
      }),
      onPress: () => setOpenSection('responses'),
      render: () => <>
        <EditorSection chatPreferences={chatPreferences} palette={palette} promptDeliveryAvailable={serverCapabilities.promptDeliveryAvailable} updateChatPreferences={updateChatPreferences} />
        <ResponsesSection chatPreferences={chatPreferences} palette={palette} selectedResponseScope={selectedResponseScope} updateChatPreferences={updateChatPreferences} />
      </>,
    },
    {
      id: 'appearance', group: 'app', icon: 'palette-outline', title: t('settings:screen.categories.appearance'), summary: t('settings:screen.summaries.appearance'),
      onPress: () => setOpenSection('appearance'), render: () => <>
        <AppearanceSection chatPreferences={chatPreferences} palette={palette} updateChatPreferences={updateChatPreferences} />
        <SettingSwitchRow title={t('settings:appearance.slimInterface.title')} description={t('settings:appearance.slimInterface.description')} value={chatPreferences.slimInterface === true} palette={palette} onValueChange={(slimInterface) => updateChatPreferences({ slimInterface })} />
      </>,
    },
    {
      id: 'language', group: 'app', icon: 'translate', title: t('settings:language.title'), summary: t('settings:language.description'),
      onPress: () => setOpenSection('language'), render: () => <LanguageSection chatPreferences={chatPreferences} palette={palette} updateChatPreferences={updateChatPreferences} />,
    },
    {
      id: 'advanced', group: 'server' as const,
      icon: 'tune',
      title: t('settings:diagnostics.title'),
      summary: t('settings:screen.summaries.diagnostics'),
      onPress: () => setOpenSection('advanced'),
      render: () => (
        <>
          {serverCapabilities.contract === 'v2'
            ? null
            : <View style={{ flexDirection: 'row', gap: 8 }}><Button mode={advancedTab === 'mcp' ? 'contained-tonal' : 'text'} onPress={() => setAdvancedTab('mcp')}>MCP</Button><Button mode={advancedTab === 'diagnostics' ? 'contained-tonal' : 'text'} onPress={() => setAdvancedTab('diagnostics')}>{t('settings:diagnostics.title')}</Button></View>}
          {serverCapabilities.contract !== 'v2' && advancedTab === 'mcp' ? <>
          <McpSection configs={currentConfig?.mcp} mcpStatuses={mcp.mcpStatuses} onAdd={mcp.addMcpServer} onConnect={mcp.connectMcpServer} onDisconnect={mcp.disconnectMcpServer} onRefresh={mcp.refreshMcpServers} mcpOAuth={mcp.mcpOAuth} requiresIntegrationId={serverCapabilities.mcpIntegrationId} oauthAvailable={serverCapabilities.mcpOAuth} palette={palette} />
          </> : <>
          <DiagnosticsSection diagnostics={diagnosticsData.diagnostics} eventStreamStatus={diagnosticsData.eventStreamStatus} transport={diagnosticsData.transport} lastJsError={lastJsError} onRefresh={() => { void diagnosticsData.refreshDiagnostics(); refreshLastJsError(); }} palette={palette} />
          </>}
        </>
      ),
    },
    ...(serverCapabilities.savedPermissions ? [{
      id: 'permissions', group: 'server' as const,
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
      id: 'support', group: 'app' as const,
      icon: 'lifebuoy',
      title: t('settings:screen.categories.about'),
      summary: t('settings:screen.summaries.support'),
      onPress: () => setOpenSection('support'),
      render: () => <>
        <SupportSection palette={palette} />
        {updates.supported ? <UpdateSection checkPeriod={updates.checkPeriod} enabled={updates.enabled} onCheckPeriodChange={updates.setCheckPeriod} onEnabledChange={updates.setEnabled} palette={palette} /> : null}
        <GeneralSection palette={palette} onResetOnboarding={() => {
          setOpenSection(undefined);
          startOnboardingReview();
          router.push('/onboarding');
        }} />
      </>,
    },
  ];
  const order = ['appearance', 'responses', 'voice', 'notifications', 'language', 'support', 'connection', 'cloud-link', 'ai', 'extensions', 'permissions', 'advanced'];
  return sections.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id)).map((section) => ({
    ...section,
    keywords: t(`settings:screen.keywords.${section.id}`),
    targets: settingsTargets(t, section.id, {
      native: Platform.OS !== 'web', android: Platform.OS === 'android',
      localInput: chatPreferences.voiceWakeMode === 'local', localInputSupported: voiceSetup.localVoice.status !== 'unsupported',
      enrolled: voiceSetup.localVoice.enrollment.hasProfile, localPlayback: chatPreferences.ttsEngine === 'local',
      speakerAvailable: (ttsSetup.activePack?.speakers.length ?? 0) > 1, workingSound: chatPreferences.workingSoundEnabled,
      delivery: serverCapabilities.promptDeliveryAvailable, updates: updates.supported, autoModel: autoModelAvailable,
      classifier: chatPreferences.autoModel.classifier,
    }),
  }));
}

