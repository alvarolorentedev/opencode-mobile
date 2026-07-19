import * as IntentLauncher from 'expo-intent-launcher';
import * as Linking from 'expo-linking';
import Constants from 'expo-constants';
import { useEffect, useMemo, useState } from 'react';
import { Alert, Platform, ScrollView, StyleSheet } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import {
  Button,
  Dialog,
  HelperText,
  List,
  Portal,
  Snackbar,
  TextInput,
} from 'react-native-paper';

import { Colors } from '@/constants/theme';
import { ProviderConfigDialog } from '@/components/settings/provider-config-dialog';
import { McpSection } from '@/components/settings/mcp-section';
import {
  AiDefaultsSection,
  ConnectionSection,
  DiagnosticsSection,
  NotificationsSection,
  VoiceSection,
} from '@/components/settings/settings-sections';
import {
  getProviderCopy,
  supportsGenericApiKey,
  RESPONSE_SCOPE_OPTIONS,
  WORKING_SOUND_OPTIONS,
} from '@/components/settings/settings-utils';
import { useColorScheme } from '@/hooks/use-color-scheme';
import {
  ensureNotificationPermissionsAsync,
  getNotificationDebugStatusAsync,
  type NotificationDebugStatus,
} from '@/lib/notifications';
import { getSpeechVoiceOptions, type SpeechVoiceOption } from '@/lib/voice/speech-output';
import { useOpencode } from '@/providers/opencode-provider';

export default function SettingsScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const {
    availableModels,
    availableProviders,
    addMcpServer,
    chatPreferences,
    completeAutomaticProviderOAuth,
    completeProviderOAuth,
    completeMcpOAuth,
    configuredProviders,
    connectMcpServer,
    currentConfig,
    providerAuthMethodsById,
    removeProvider,
    setProviderAuth,
    startProviderOAuth,
    connect,
    connection,
    diagnostics,
    disconnectMcpServer,
    eventStreamStatus,
    mcpStatuses,
    refreshDiagnostics,
    refreshMcpServers,
    settings,
    setMcpServerEnabled,
    startMcpOAuth,
    updateChatPreferences,
    updateSettings,
  } = useOpencode();
  const [isConnecting, setIsConnecting] = useState(false);
  const [expandedSection, setExpandedSection] = useState(() => connection.status === 'connected' ? 'ai' : 'connection');
  const [selectedProviderId, setSelectedProviderId] = useState<string>();
  const [selectedMethodIndex, setSelectedMethodIndex] = useState(0);
  const [authValues, setAuthValues] = useState<Record<string, string>>({});
  const [isConfiguringProvider, setIsConfiguringProvider] = useState(false);
  const [providerDialogError, setProviderDialogError] = useState<string>();
  const [providerFeedback, setProviderFeedback] = useState<{ type: 'success' | 'info' | 'error'; message: string }>();
  const [expandedProviderId, setExpandedProviderId] = useState<string>();
  const [notificationStatus, setNotificationStatus] = useState<NotificationDebugStatus>();
  const [isRefreshingNotificationStatus, setIsRefreshingNotificationStatus] = useState(false);
  const [notificationFeedback, setNotificationFeedback] = useState<string>();
  const [availableSpeechVoices, setAvailableSpeechVoices] = useState<SpeechVoiceOption[]>([]);
  const [isRefreshingSpeechVoices, setIsRefreshingSpeechVoices] = useState(false);
  const [pendingOAuth, setPendingOAuth] = useState<{ providerId: string; methodIndex: number; instructions?: string }>();
  const [oauthCode, setOAuthCode] = useState('');
  const [oauthError, setOAuthError] = useState<string>();
  const applicationId = useMemo(
    () => Constants.expoConfig?.android?.package || Constants.expoConfig?.ios?.bundleIdentifier,
    [],
  );

  const enabledModelIds = useMemo(() => new Set(chatPreferences.enabledModelIds), [chatPreferences.enabledModelIds]);
  const selectedProvider = useMemo(
    () => availableProviders.find((provider) => provider.id === selectedProviderId),
    [availableProviders, selectedProviderId],
  );
  const selectedProviderCopy = useMemo(
    () => (selectedProvider ? getProviderCopy(selectedProvider.id, selectedProvider.label) : undefined),
    [selectedProvider],
  );
  const authMethods = useMemo(
    () => (selectedProviderId ? providerAuthMethodsById[selectedProviderId] || [] : []),
    [providerAuthMethodsById, selectedProviderId],
  );
  const effectiveAuthMethods = useMemo(
    () =>
      (authMethods.length > 0
        ? authMethods
        : supportsGenericApiKey(selectedProviderId)
          ? [{ type: 'api' as const, label: 'API key' }]
          : [])
        .map((method) => method.type === 'api' && !method.prompts?.length
        ? {
            ...method,
            prompts: [{
              type: 'text' as const,
              key: 'key',
              message: 'API key',
              placeholder: 'Paste your API key',
            }],
          }
        : method),
    [authMethods, selectedProviderId],
  );
  const selectedMethod = effectiveAuthMethods[selectedMethodIndex];
  const visiblePrompts = useMemo(
    () =>
      (selectedMethod?.prompts || []).filter((prompt) => {
        if (!prompt.when) {
          return true;
        }

        const value = authValues[prompt.when.key];
        return prompt.when.op === 'eq' ? value === prompt.when.value : value !== prompt.when.value;
      }),
    [authValues, selectedMethod],
  );

  async function handleConnect() {
    setIsConnecting(true);
    try {
      await connect();
    } finally {
      setIsConnecting(false);
    }
  }

  async function refreshNotificationStatus() {
    setIsRefreshingNotificationStatus(true);
    try {
      setNotificationStatus(await getNotificationDebugStatusAsync());
    } finally {
      setIsRefreshingNotificationStatus(false);
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

  async function handleEnableNotifications() {
    const permissions = await ensureNotificationPermissionsAsync();
    await refreshNotificationStatus();

    if (permissions?.granted) {
      setNotificationFeedback('Notifications are enabled on this device.');
      return;
    }

    setNotificationFeedback('Notifications are still disabled. Open system settings to enable them manually.');
  }

  async function handleOpenAppSettings() {
    await Linking.openSettings();
  }

  async function handleOpenNotificationSettings() {
    if (Platform.OS !== 'android') {
      await Linking.openSettings();
      return;
    }

    try {
      await IntentLauncher.startActivityAsync(IntentLauncher.ActivityAction.APP_NOTIFICATION_SETTINGS, {
        extra: applicationId
          ? {
              'android.provider.extra.APP_PACKAGE': applicationId,
            }
          : undefined,
      });
    } catch {
      await Linking.openSettings();
    }
  }

  async function handleOpenBatterySettings() {
    if (Platform.OS !== 'android') {
      return;
    }

    try {
      await IntentLauncher.startActivityAsync(IntentLauncher.ActivityAction.IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
    } catch {
      await Linking.openSettings();
    }
  }

  async function handleOpenBatterySaverSettings() {
    if (Platform.OS !== 'android') {
      return;
    }

    try {
      await IntentLauncher.startActivityAsync(IntentLauncher.ActivityAction.BATTERY_SAVER_SETTINGS);
    } catch {
      await Linking.openSettings();
    }
  }

  useEffect(() => {
    void refreshNotificationStatus();
    void refreshSpeechVoices();
  }, []);

  useEffect(() => {
    setExpandedSection(connection.status === 'connected' ? 'ai' : 'connection');
  }, [connection.status]);

  const selectedSpeechVoiceLabel = useMemo(
    () => availableSpeechVoices.find((voice) => voice.id === chatPreferences.speechVoiceId)?.label || 'System default',
    [availableSpeechVoices, chatPreferences.speechVoiceId],
  );
  const selectedResponseScope = useMemo(
    () => RESPONSE_SCOPE_OPTIONS.find((option) => option.value === chatPreferences.responseScope) || RESPONSE_SCOPE_OPTIONS[0],
    [chatPreferences.responseScope],
  );
  const selectedWorkingSound = useMemo(
    () => WORKING_SOUND_OPTIONS.find((option) => option.value === chatPreferences.workingSoundVariant) || WORKING_SOUND_OPTIONS[0],
    [chatPreferences.workingSoundVariant],
  );
  function resetProviderDialog() {
    setSelectedProviderId(undefined);
    setSelectedMethodIndex(0);
    setAuthValues({});
    setProviderDialogError(undefined);
  }

  function dismissPendingOAuth() {
    setPendingOAuth(undefined);
    setOAuthCode('');
    setOAuthError(undefined);
  }

  function startProviderConfiguration(providerId: string) {
    setProviderDialogError(undefined);
    setSelectedMethodIndex(0);

    const methods = providerAuthMethodsById[providerId] || [];
    const initialValues: Record<string, string> = {};
    const initialMethod = methods[0];
    initialMethod?.prompts?.forEach((prompt) => {
      if (prompt.type === 'select') {
        initialValues[prompt.key] = prompt.options?.[0]?.value || '';
      }
    });

    setSelectedProviderId(providerId);
    setAuthValues(initialValues);
  }

  async function submitProviderConfiguration() {
    if (!selectedProviderId || !selectedMethod) {
      return;
    }

    const providerLabel = selectedProviderCopy?.label || selectedProviderId;
    setIsConfiguringProvider(true);
    setProviderDialogError(undefined);

    try {
      if (selectedMethod.type === 'oauth') {
        const authorization = await startProviderOAuth(selectedProviderId, selectedMethodIndex, authValues);
        await WebBrowser.openBrowserAsync(authorization.url);
        if (authorization.method === 'code') {
          setPendingOAuth({ providerId: selectedProviderId, methodIndex: selectedMethodIndex, instructions: authorization.instructions });
          setSelectedProviderId(undefined);
          return;
        }
        await completeAutomaticProviderOAuth(selectedProviderId);
        await connect();
        setProviderFeedback(
          authorization.instructions
            ? { type: 'info', message: authorization.instructions }
            : { type: 'success', message: `${providerLabel} sign-in finished. Provider status has been refreshed.` },
        );
      } else {
        await setProviderAuth(selectedProviderId, authValues);
        setProviderFeedback({
          type: 'success',
          message: `${providerLabel} was configured successfully.`,
        });
      }

      resetProviderDialog();
    } catch (error) {
      setProviderDialogError(error instanceof Error ? error.message : 'Could not configure provider.');
    } finally {
      setIsConfiguringProvider(false);
    }
  }

  function handleProviderMethodChange(nextIndex: number) {
    const nextMethod = effectiveAuthMethods[nextIndex];
    const nextValues: Record<string, string> = {};
    nextMethod?.prompts?.forEach((prompt) => {
      if (prompt.type === 'select') {
        nextValues[prompt.key] = prompt.options?.[0]?.value || '';
      }
    });
    setSelectedMethodIndex(nextIndex);
    setAuthValues(nextValues);
  }

  function handleModelToggle(modelId: string, checked: boolean) {
    const nextEnabledModelIds = checked
      ? chatPreferences.enabledModelIds.filter((id) => id !== modelId)
      : [...chatPreferences.enabledModelIds, modelId];

    updateChatPreferences({ enabledModelIds: nextEnabledModelIds });
  }

  function handleRemoveProvider(providerId: string) {
    const label = getProviderCopy(providerId, providerId).label;
    const remove = () => void removeProvider(providerId)
      .then(() => setProviderFeedback({ type: 'success', message: `${label} credentials were removed.` }))
      .catch((error) => setProviderFeedback({ type: 'error', message: error instanceof Error ? error.message : 'Could not remove provider credentials.' }));
    if (Platform.OS === 'web') {
      if (globalThis.confirm(`Remove ${label}?\n\nStored credentials and provider configuration will be removed.`)) remove();
      return;
    }
    Alert.alert(`Remove ${label}?`, 'Stored credentials and provider configuration will be removed.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: remove },
    ]);
  }

  return (
    <>
      <ScrollView style={[styles.screen, { backgroundColor: palette.background }]} contentContainerStyle={styles.content}>
        <List.AccordionGroup expandedId={expandedSection} onAccordionPress={(id) => setExpandedSection(expandedSection === String(id) ? '' : String(id))}>
          <List.Accordion id="connection" title="Connection" description={connection.status === 'connected' ? 'Connected' : connection.message} titleStyle={{ color: palette.text }} descriptionStyle={{ color: palette.muted }} style={[styles.category, { backgroundColor: palette.surface, borderColor: palette.border }]}>
            <ConnectionSection
              connection={connection}
              isConnecting={isConnecting}
              onReconnect={() => void handleConnect()}
              palette={palette}
              settings={settings}
              updateSettings={updateSettings}
            />
          </List.Accordion>
          <List.Accordion id="ai" title="AI & providers" description={`${configuredProviders.length} configured`} titleStyle={{ color: palette.text }} descriptionStyle={{ color: palette.muted }} style={[styles.category, { backgroundColor: palette.surface, borderColor: palette.border }]}>
            <AiDefaultsSection
              availableModels={availableModels}
              availableProviders={availableProviders}
              chatPreferences={chatPreferences}
              configuredProviders={configuredProviders}
              enabledModelIds={enabledModelIds}
              expandedProviderId={expandedProviderId}
              onExpandedProviderChange={setExpandedProviderId}
              onModelToggle={handleModelToggle}
              onRemoveProvider={handleRemoveProvider}
              onStartProviderConfiguration={startProviderConfiguration}
              palette={palette}
            />
          </List.Accordion>
          <List.Accordion id="notifications" title="Notifications" description={notificationStatus?.permissionGranted ? 'Enabled' : 'Off'} titleStyle={{ color: palette.text }} descriptionStyle={{ color: palette.muted }} style={[styles.category, { backgroundColor: palette.surface, borderColor: palette.border }]}>
            <NotificationsSection
              isRefreshingNotificationStatus={isRefreshingNotificationStatus}
              notificationStatus={notificationStatus}
              onEnableNotifications={() => void handleEnableNotifications()}
              onOpenAppSettings={() => void handleOpenAppSettings()}
              onOpenBatterySaverSettings={() => void handleOpenBatterySaverSettings()}
              onOpenBatterySettings={() => void handleOpenBatterySettings()}
              onOpenNotificationSettings={() => void handleOpenNotificationSettings()}
              onRefreshStatus={() => void refreshNotificationStatus()}
              palette={palette}
            />
          </List.Accordion>
          <List.Accordion id="voice" title="Voice & responses" description={chatPreferences.autoPlayAssistantReplies ? 'Reply playback on' : 'Reply playback off'} titleStyle={{ color: palette.text }} descriptionStyle={{ color: palette.muted }} style={[styles.category, { backgroundColor: palette.surface, borderColor: palette.border }]}>
            <VoiceSection
              availableSpeechVoices={availableSpeechVoices}
              chatPreferences={chatPreferences}
              isRefreshingSpeechVoices={isRefreshingSpeechVoices}
              palette={palette}
              selectedResponseScope={selectedResponseScope}
              selectedSpeechVoiceLabel={selectedSpeechVoiceLabel}
              selectedWorkingSound={selectedWorkingSound}
              updateChatPreferences={updateChatPreferences}
            />
          </List.Accordion>
          <List.Accordion id="advanced" title="Advanced" description="MCP servers and diagnostics" titleStyle={{ color: palette.text }} descriptionStyle={{ color: palette.muted }} style={[styles.category, { backgroundColor: palette.surface, borderColor: palette.border }]}>
            <McpSection
              configs={currentConfig?.mcp}
              mcpStatuses={mcpStatuses}
              onAdd={addMcpServer}
              onCompleteOAuth={completeMcpOAuth}
              onConnect={connectMcpServer}
              onDisconnect={disconnectMcpServer}
              onRefresh={refreshMcpServers}
              onSetEnabled={setMcpServerEnabled}
              onStartOAuth={async (name) => {
                const url = await startMcpOAuth(name);
                if (!url) {
                  await refreshMcpServers();
                  return false;
                }
                await WebBrowser.openBrowserAsync(url);
                return true;
              }}
              palette={palette}
            />
            <DiagnosticsSection diagnostics={diagnostics} eventStreamStatus={eventStreamStatus} onRefresh={() => void refreshDiagnostics()} palette={palette} />
          </List.Accordion>
        </List.AccordionGroup>

      </ScrollView>

      <Portal>
        <Dialog visible={Boolean(pendingOAuth)} onDismiss={dismissPendingOAuth}>
          <Dialog.Title>Complete provider sign-in</Dialog.Title>
          <Dialog.Content>
            {pendingOAuth?.instructions ? <TextInput mode="flat" disabled value={pendingOAuth.instructions} /> : null}
            <TextInput mode="outlined" label="Authorization code" value={oauthCode} onChangeText={setOAuthCode} autoCapitalize="none" />
            {oauthError ? <HelperText type="error">{oauthError}</HelperText> : null}
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={dismissPendingOAuth}>Cancel</Button>
            <Button disabled={!oauthCode.trim()} onPress={() => {
              if (!pendingOAuth) return;
              void completeProviderOAuth(pendingOAuth.providerId, pendingOAuth.methodIndex, oauthCode).then(() => {
                setPendingOAuth(undefined);
                setOAuthCode('');
                setOAuthError(undefined);
                resetProviderDialog();
              }).catch((error) => setOAuthError(error instanceof Error ? error.message : 'Could not complete sign-in.'));
            }}>Complete</Button>
          </Dialog.Actions>
        </Dialog>
        {selectedProvider ? (
          <ProviderConfigDialog
            authValues={authValues}
            effectiveAuthMethods={effectiveAuthMethods}
            isConfiguringProvider={isConfiguringProvider}
            onAuthValueChange={(key, value) => setAuthValues((current) => ({ ...current, [key]: value }))}
            onDismiss={resetProviderDialog}
            onMethodChange={handleProviderMethodChange}
            onSubmit={() => void submitProviderConfiguration()}
            palette={palette}
            providerDialogError={providerDialogError}
            selectedMethod={selectedMethod}
            selectedMethodIndex={selectedMethodIndex}
            selectedProviderDescription={selectedProviderCopy?.description}
            selectedProviderLabel={selectedProviderCopy?.label || selectedProvider.id}
            visiblePrompts={visiblePrompts}
          />
        ) : null}
      </Portal>

      <Snackbar
        visible={Boolean(providerFeedback)}
        onDismiss={() => setProviderFeedback(undefined)}
        duration={4000}>
        {providerFeedback?.message}
      </Snackbar>
      <Snackbar
        visible={Boolean(notificationFeedback)}
        onDismiss={() => setNotificationFeedback(undefined)}
        duration={4000}>
        {notificationFeedback}
      </Snackbar>
    </>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: 16, paddingTop: 28, gap: 16, paddingBottom: 28 },
  category: { borderRadius: 16, borderWidth: 1, marginBottom: 10, overflow: 'hidden' },
});
