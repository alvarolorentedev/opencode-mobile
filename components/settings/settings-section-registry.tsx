import type { ComponentProps, ReactNode } from 'react';
import type { TFunction } from 'i18next';
import { useRouter } from 'expo-router';
import { View } from 'react-native';
import { Button } from 'react-native-paper';
import type { MaterialCommunityIcons } from '@expo/vector-icons';

import { ServerApprovals } from '@/components/settings/server-approvals';
import { McpSection } from '@/components/settings/mcp-section';
import { ExtensionsSection } from '@/components/settings/extensions-section';
import { EditorSection } from '@/components/settings/sections/editor-section';
import { ConnectionSection } from '@/components/settings/sections/connection-section';
import { CloudLinkSection } from '@/components/settings/sections/cloud-link-section';
import { DiagnosticsSection } from '@/components/settings/sections/diagnostics-section';
import { GeneralSection } from '@/components/settings/sections/general-section';
import { NotificationsSection } from '@/components/settings/sections/notifications-section';
import { SupportSection } from '@/components/settings/sections/support-section';
import { UpdateSection } from '@/components/settings/sections/update-section';
import { VoiceSection } from '@/components/settings/sections/voice-section';
import { ResponsesSection } from '@/components/settings/sections/responses-section';
import { AiSettingsPanel } from '@/components/settings/ai-settings-panel';
import { useNotificationSetup } from '@/components/settings/use-notification-setup';
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

  return [
    {
      id: 'connection',
      icon: 'server-network',
      title: t('settings:screen.categories.connection'),
      summary: connection.status === 'connected' ? t('common:labels.connected') : connection.message,
      summaryLines: 2,
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
    ...(serverCapabilities.contract === 'v2' ? [{
      id: 'extensions',
      icon: 'puzzle-outline' as const,
      title: t('settings:screen.categories.extensions'),
      summary: t('settings:screen.summaries.extensions'),
      onPress: () => setOpenSection('extensions'),
      render: () => <ExtensionsSection />,
    }] : []),
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
      summary: voiceSummary,
      onPress: () => setOpenSection('voice'),
      render: () => <VoiceSection availableSpeechVoices={availableSpeechVoices} chatPreferences={chatPreferences} isRefreshingSpeechVoices={isRefreshingSpeechVoices} isRefreshingVoiceCapabilities={voiceSetup.isRefreshing} isTestingVoice={voiceSetup.isTesting} localVoice={voiceSetup.localVoice} onEnableVoiceInput={() => void voiceSetup.enable()} onOpenVoiceSettings={() => void voiceSetup.openAppSettings()} onRefreshVoiceCapabilities={() => void voiceSetup.refreshStatus()} onTestVoicePlayback={() => void voiceSetup.testPlayback()} palette={palette} selectedSpeechVoiceLabel={selectedSpeechVoiceLabel} selectedWorkingSound={selectedWorkingSound} updateChatPreferences={updateChatPreferences} voiceCapabilities={voiceSetup.capabilities} />,
    },
    {
      id: 'responses',
      icon: 'message-text-outline',
      title: t('settings:screen.categories.responses'),
      summary: t(`settings:screen.summaries.${chatPreferences.includeNextActions ? 'responsesOn' : 'responsesOff'}`, {
        scope: t(`settings:voice.responseScope.${selectedResponseScope.value}.label`),
      }),
      onPress: () => setOpenSection('responses'),
      render: () => <ResponsesSection chatPreferences={chatPreferences} palette={palette} selectedResponseScope={selectedResponseScope} updateChatPreferences={updateChatPreferences} />,
    },
    {
      id: 'general', icon: 'cog-outline', title: t('common:servers.appSettings'), summary: t('common:servers.appSettingsSummary'),
      onPress: () => setOpenSection('general'), render: () => <>
          <EditorSection chatPreferences={chatPreferences} palette={palette} promptDeliveryAvailable={serverCapabilities.promptDeliveryAvailable} updateChatPreferences={updateChatPreferences} />
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
          {serverCapabilities.contract === 'v2'
            ? <Button mode="contained-tonal" onPress={() => setAdvancedTab('diagnostics')}>{t('settings:diagnostics.title')}</Button>
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
}
