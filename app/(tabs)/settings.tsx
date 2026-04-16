import * as IntentLauncher from 'expo-intent-launcher';
import * as Linking from 'expo-linking';
import Constants from 'expo-constants';
import { useEffect, useMemo, useState } from 'react';
import { Platform, ScrollView, StyleSheet } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import {
  Portal,
  Snackbar,
} from 'react-native-paper';

import { Colors } from '@/constants/theme';
import { ProviderConfigDialog } from '@/components/settings/provider-config-dialog';
import {
  AiDefaultsSection,
  ConnectionSection,
  NotificationsSection,
  VoiceSection,
} from '@/components/settings/settings-sections';
import {
  getProviderCopy,
  RESPONSE_SCOPE_OPTIONS,
  shouldUseGenericApiFallback,
  WORKING_SOUND_OPTIONS,
} from '@/components/settings/settings-utils';
import { useColorScheme } from '@/hooks/use-color-scheme';
import {
  ensureNotificationPermissionsAsync,
  getNotificationDebugStatusAsync,
  type NotificationDebugStatus,
} from '@/lib/notifications';
import { getSpeechVoiceOptions, type SpeechVoiceOption } from '@/lib/voice/speech-output';
import { useOpencode, type ResponseScope } from '@/providers/opencode-provider';
import type { WorkingSoundVariant } from '@/lib/voice/working-sound';

export default function SettingsScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const {
    availableModels,
    availableProviders,
    chatPreferences,
    configureProvider,
    configuredProviders,
    providerAuthMethodsById,
    setProviderAuth,
    startProviderOAuth,
    connect,
    connection,
    settings,
    updateChatPreferences,
    updateSettings,
  } = useOpencode();
  const [isConnecting, setIsConnecting] = useState(false);
  const [addProviderMenuVisible, setAddProviderMenuVisible] = useState(false);
  const [selectedProviderId, setSelectedProviderId] = useState<string>();
  const [selectedMethodIndex, setSelectedMethodIndex] = useState(0);
  const [authValues, setAuthValues] = useState<Record<string, string>>({});
  const [isConfiguringProvider, setIsConfiguringProvider] = useState(false);
  const [providerDialogError, setProviderDialogError] = useState<string>();
  const [providerFeedback, setProviderFeedback] = useState<{ type: 'success' | 'info'; message: string }>();
  const [expandedProviderId, setExpandedProviderId] = useState<string>();
  const [notificationStatus, setNotificationStatus] = useState<NotificationDebugStatus>();
  const [isRefreshingNotificationStatus, setIsRefreshingNotificationStatus] = useState(false);
  const [notificationFeedback, setNotificationFeedback] = useState<string>();
  const [availableSpeechVoices, setAvailableSpeechVoices] = useState<SpeechVoiceOption[]>([]);
  const [isRefreshingSpeechVoices, setIsRefreshingSpeechVoices] = useState(false);
  const [speechVoiceMenuVisible, setSpeechVoiceMenuVisible] = useState(false);
  const [responseScopeMenuVisible, setResponseScopeMenuVisible] = useState(false);
  const [workingSoundMenuVisible, setWorkingSoundMenuVisible] = useState(false);
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
  const useGenericFallback = useMemo(
    () => (selectedProviderId ? shouldUseGenericApiFallback(selectedProviderId, authMethods.length) : false),
    [authMethods.length, selectedProviderId],
  );
  const effectiveAuthMethods = useMemo(
    () =>
      authMethods.length > 0
        ? authMethods
        : useGenericFallback
          ? [
            {
              type: 'api' as const,
              label: 'API key',
              prompts: [
                {
                  type: 'text' as const,
                  key: 'key',
                  message: 'API key',
                  placeholder: 'Paste your API key',
                },
              ],
            },
          ]
          : [],
    [authMethods, useGenericFallback],
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

  function startProviderConfiguration(providerId: string) {
    setAddProviderMenuVisible(false);
    setProviderDialogError(undefined);
    setSelectedMethodIndex(0);

    const methods = providerAuthMethodsById[providerId] || [];
    const fallbackMethod = {
      type: 'api' as const,
      label: 'API key',
      prompts: [
        {
          type: 'text' as const,
          key: 'key',
          message: 'API key',
          placeholder: 'Paste your API key',
        },
      ],
    };
    const initialValues: Record<string, string> = {};
    const initialMethod = methods[0] || (shouldUseGenericApiFallback(providerId, methods.length) ? fallbackMethod : undefined);
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
    const hasAnyAuthValue = Object.values(authValues).some((value) => value.trim().length > 0);
    setIsConfiguringProvider(true);
    setProviderDialogError(undefined);

    try {
      if (selectedMethod.type === 'oauth') {
        const authorization = await startProviderOAuth(selectedProviderId, selectedMethodIndex, authValues);
        await WebBrowser.openBrowserAsync(authorization.url);
        await connect();
        setProviderFeedback(
          authorization.instructions
            ? { type: 'info', message: authorization.instructions }
            : { type: 'success', message: `${providerLabel} sign-in finished. Provider status has been refreshed.` },
        );
      } else if (useGenericFallback && authMethods.length === 0 && !hasAnyAuthValue) {
        await configureProvider(selectedProviderId);
        setProviderFeedback({
          type: 'success',
          message: `${providerLabel} was enabled successfully.`,
        });
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

  return (
    <>
      <ScrollView style={[styles.screen, { backgroundColor: palette.background }]} contentContainerStyle={styles.content}>
        <ConnectionSection
          connection={connection}
          isConnecting={isConnecting}
          onReconnect={() => void handleConnect()}
          palette={palette}
          settings={settings}
          updateSettings={updateSettings}
        />
        <AiDefaultsSection
          addProviderMenuVisible={addProviderMenuVisible}
          availableModels={availableModels}
          availableProviders={availableProviders}
          chatPreferences={chatPreferences}
          configuredProviders={configuredProviders}
          enabledModelIds={enabledModelIds}
          expandedProviderId={expandedProviderId}
          onExpandedProviderChange={setExpandedProviderId}
          onMenuVisibilityChange={setAddProviderMenuVisible}
          onModelToggle={handleModelToggle}
          onStartProviderConfiguration={startProviderConfiguration}
          palette={palette}
        />
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
        <VoiceSection
          availableSpeechVoices={availableSpeechVoices}
          chatPreferences={chatPreferences}
          isRefreshingSpeechVoices={isRefreshingSpeechVoices}
          onResponseScopeMenuVisibleChange={setResponseScopeMenuVisible}
          onSpeechVoiceMenuVisibleChange={setSpeechVoiceMenuVisible}
          onWorkingSoundMenuVisibleChange={setWorkingSoundMenuVisible}
          palette={palette}
          responseScopeMenuVisible={responseScopeMenuVisible}
          selectedResponseScope={selectedResponseScope}
          selectedSpeechVoiceLabel={selectedSpeechVoiceLabel}
          selectedWorkingSound={selectedWorkingSound}
          speechVoiceMenuVisible={speechVoiceMenuVisible}
          updateChatPreferences={updateChatPreferences}
          workingSoundMenuVisible={workingSoundMenuVisible}
        />

      </ScrollView>

      <Portal>
        {selectedProvider ? (
          <ProviderConfigDialog
            authMethods={authMethods}
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
            useGenericFallback={useGenericFallback}
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
});
