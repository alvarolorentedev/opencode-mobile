import * as IntentLauncher from 'expo-intent-launcher';
import * as Linking from 'expo-linking';
import Constants from 'expo-constants';
import { useEffect, useMemo, useState } from 'react';
import { Platform, ScrollView, StyleSheet, View } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import {
  Button,
  Card,
  Checkbox,
  Chip,
  Dialog,
  HelperText,
  List,
  Menu,
  Portal,
  RadioButton,
  Snackbar,
  Switch,
  Text,
  TextInput,
} from 'react-native-paper';

import { Colors } from '@/constants/theme';
import { renderProviderIcon } from '@/components/ui/provider-icon';
import { useColorScheme } from '@/hooks/use-color-scheme';
import {
  ensureNotificationPermissionsAsync,
  getNotificationDebugStatusAsync,
  type NotificationDebugStatus,
} from '@/lib/notifications';
import { formatTimestamp } from '@/lib/opencode/format';
import { getSpeechVoiceOptions, type SpeechVoiceOption } from '@/lib/voice/speech-output';
import { useOpencode, type ResponseScope } from '@/providers/opencode-provider';
import type { WorkingSoundVariant } from '@/lib/voice/working-sound';

const RESPONSE_SCOPE_OPTIONS: { value: ResponseScope; label: string; description: string }[] = [
  { value: 'brief', label: 'Brief', description: 'Short, tightly scoped answers for natural back-and-forth.' },
  { value: 'balanced', label: 'Balanced', description: 'Concise answers with a little more context when helpful.' },
  { value: 'detailed', label: 'Detailed', description: 'Longer explanations and more supporting detail.' },
];

const WORKING_SOUND_OPTIONS: { value: WorkingSoundVariant; label: string; description: string }[] = [
  { value: 'soft', label: 'Soft chime', description: 'Warm layered tone with a gentle pulse.' },
  { value: 'glass', label: 'Glass tone', description: 'Brighter, lighter ambient loop.' },
];

const KNOWN_PROVIDER_COPY: Record<string, { label: string; description: string }> = {
  openai: {
    label: 'OpenAI',
    description: 'GPT models from OpenAI, including the newest reasoning and multimodal options.',
  },
  anthropic: {
    label: 'Anthropic',
    description: 'Claude models from Anthropic for coding, analysis, and long-context work.',
  },
  'github-copilot': {
    label: 'GitHub Copilot',
    description: 'Use your GitHub Copilot access to sign in and enable supported foundation models.',
  },
  google: {
    label: 'Google',
    description: 'Gemini models from Google for multimodal and large-context tasks.',
  },
  groq: {
    label: 'Groq',
    description: 'Fast hosted inference for supported open and frontier models.',
  },
  openrouter: {
    label: 'OpenRouter',
    description: 'Route requests across multiple providers and model families from one account.',
  },
  mistral: {
    label: 'Mistral',
    description: 'Mistral AI hosted models for general-purpose and coding workloads.',
  },
  xai: {
    label: 'xAI',
    description: 'Grok models from xAI.',
  },
  azure: {
    label: 'Azure OpenAI',
    description: 'OpenAI-compatible models deployed through Azure.',
  },
};

const KNOWN_OAUTH_PROVIDER_IDS = new Set(['openai', 'github-copilot', 'github_copilot', 'anthropic']);

function getProviderCopy(providerId: string, fallbackLabel: string) {
  const copy = KNOWN_PROVIDER_COPY[providerId];
  return {
    label: copy?.label || fallbackLabel,
    description: copy?.description,
  };
}

function shouldUseGenericApiFallback(providerId: string, authMethodsCount: number) {
  if (authMethodsCount > 0) {
    return false;
  }

  return !KNOWN_OAUTH_PROVIDER_IDS.has(providerId);
}

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
  const configuredModels = useMemo(
    () => availableModels.filter((model) => configuredProviders.some((provider) => provider.id === model.providerID)),
    [availableModels, configuredProviders],
  );
  const configuredProviderModels = useMemo(
    () =>
      configuredProviders
        .map((provider) => ({
          provider,
          models: configuredModels.filter((model) => model.providerID === provider.id),
        }))
        .filter((entry) => entry.models.length > 0),
    [configuredModels, configuredProviders],
  );
  const unconfiguredProviders = useMemo(
    () => availableProviders.filter((provider) => !provider.configured),
    [availableProviders],
  );
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

  const notificationsEnabled = Boolean(notificationStatus?.permissionGranted);
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
  const notificationStatusLabel = !notificationStatus
    ? 'Checking'
    : notificationsEnabled
      ? 'Enabled'
      : 'Needs setup';
  const notificationStatusTone = !notificationStatus
    ? palette.icon
    : notificationsEnabled
      ? palette.success
      : palette.warning;
  const backgroundStatusLabel = !notificationStatus
    ? 'Checking'
    : notificationStatus.backgroundMonitoringSupported
      ? notificationStatus.backgroundTaskRegistered
        ? 'Ready'
        : 'Limited'
      : 'Limited';
  const notificationSummary = `${notificationsEnabled ? 'Notifications enabled' : 'Notifications off'}${backgroundStatusLabel === 'Checking' ? '' : ` • Background ${backgroundStatusLabel.toLowerCase()}`}`;

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

  return (
    <>
      <ScrollView style={[styles.screen, { backgroundColor: palette.background }]} contentContainerStyle={styles.content}>
      <Card mode="contained" style={[styles.card, { backgroundColor: palette.surface }]}> 
        <Card.Content style={styles.section}>
          <Text variant="titleLarge" style={[styles.title, { color: palette.text }]}>Connection</Text>
          <View style={[styles.connectionStatusCard, { backgroundColor: palette.background, borderColor: palette.border }]}> 
            <View style={styles.connectionStatusHeader}>
              <View style={styles.connectionStatusRow}>
                <View
                  style={[
                    styles.connectionStatusDot,
                    {
                      backgroundColor:
                        connection.status === 'connected'
                          ? palette.success
                          : connection.status === 'error'
                            ? palette.danger
                            : connection.status === 'connecting'
                              ? palette.warning
                              : palette.icon,
                    },
                  ]}
                />
                <Text variant="labelLarge" style={{ color: palette.text }}>
                  {connection.status.charAt(0).toUpperCase() + connection.status.slice(1)}
                </Text>
              </View>
              <Text variant="bodySmall" style={{ color: palette.muted }}>
                Last checked {connection.checkedAt ? formatTimestamp(connection.checkedAt) : 'not yet'}
              </Text>
            </View>
          </View>
          <TextInput
            mode="outlined"
            label="Server URL"
            testID="settings-server-url-input"
            value={settings.serverUrl}
            onChangeText={(value) => updateSettings({ serverUrl: value })}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="http://192.168.1.10:4096"
          />
          <TextInput
            mode="outlined"
            label="Username"
            testID="settings-username-input"
            value={settings.username}
            onChangeText={(value) => updateSettings({ username: value })}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <TextInput
            mode="outlined"
            label="Password"
            testID="settings-password-input"
            value={settings.password}
            onChangeText={(value) => updateSettings({ password: value })}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Button testID="settings-reconnect-button" mode="contained" loading={isConnecting} onPress={() => void handleConnect()}>
            Reconnect
          </Button>
        </Card.Content>
      </Card>

      <Card mode="contained" style={[styles.card, { backgroundColor: palette.surface }]}> 
        <Card.Content style={styles.section}>
          <Text variant="titleLarge" style={[styles.title, { color: palette.text }]}>AI defaults</Text>
          <Text variant="bodyMedium" style={{ color: palette.muted }}>Choose which configured models appear in chat. The last model you pick in chat stays selected for new chats.</Text>
          <View style={styles.providerHeader}>
            <Text variant="labelLarge" style={{ color: palette.text }}>Configured providers</Text>
            {unconfiguredProviders.length > 0 ? (
              <Menu
                visible={addProviderMenuVisible}
                onDismiss={() => setAddProviderMenuVisible(false)}
                anchor={
                  <Button testID="settings-add-provider-button" compact mode="outlined" onPress={() => setAddProviderMenuVisible(true)}>
                    Add provider
                  </Button>
                }>
                {unconfiguredProviders.map((provider) => (
                    <Menu.Item
                      key={provider.id}
                      leadingIcon={(props) => renderProviderIcon(provider.id, props.size, props.color)}
                      title={getProviderCopy(provider.id, provider.label).label}
                      onPress={() => {
                        startProviderConfiguration(provider.id);
                      }}
                    />
                  ))}
              </Menu>
            ) : null}
          </View>

          <View style={styles.chipWrap}>
            {configuredProviders.map((provider) => (
                <Chip
                  key={provider.id}
                  icon={({ size, color }) => renderProviderIcon(provider.id, size, color)}
                  compact>
                  {getProviderCopy(provider.id, provider.label).label}
                </Chip>
              ))}
            </View>
          {availableProviders.length === 0 ? <HelperText type="info">Connect first to load providers.</HelperText> : null}
          {availableProviders.length > 0 && configuredProviders.length === 0 ? <HelperText type="info">Configure at least one provider to pick defaults.</HelperText> : null}
          <List.Section style={styles.modelListSection}>
            <List.AccordionGroup
              expandedId={expandedProviderId}
              onAccordionPress={(id) => setExpandedProviderId(expandedProviderId === String(id) ? undefined : String(id))}>
              {configuredProviderModels.map(({ provider, models }) => {
                const selectedCount = models.filter((model) => enabledModelIds.has(model.id)).length;

                return (
                  <List.Accordion
                    key={provider.id}
                    id={provider.id}
                    title={getProviderCopy(provider.id, provider.label).label}
                    description={`${selectedCount} of ${models.length} selected`}
                    left={() => (
                      <View
                        style={[
                          styles.providerAccordionIconWrap,
                          { backgroundColor: palette.surfaceAlt, borderColor: palette.border },
                        ]}>
                        {renderProviderIcon(provider.id, 20, palette.tint)}
                      </View>
                    )}
                    style={[styles.providerAccordion, { backgroundColor: palette.background, borderColor: palette.border }]}
                    titleStyle={{ color: palette.text }}
                    descriptionStyle={{ color: palette.muted }}>
                    {models.map((model) => {
                      const checked = enabledModelIds.has(model.id);

                      return (
                        <List.Item
                          key={model.id}
                          title={model.label}
                          description={model.supportsReasoning ? 'Reasoning supported' : 'Standard model'}
                          titleStyle={{ color: palette.text }}
                          descriptionStyle={{ color: palette.muted }}
                          onPress={() => {
                            const nextEnabledModelIds = checked
                              ? chatPreferences.enabledModelIds.filter((id) => id !== model.id)
                              : [...chatPreferences.enabledModelIds, model.id];

                            updateChatPreferences({ enabledModelIds: nextEnabledModelIds });
                          }}
                          left={() => <Checkbox status={checked ? 'checked' : 'unchecked'} />}
                          style={styles.modelListItem}
                        />
                      );
                    })}
                  </List.Accordion>
                );
              })}
            </List.AccordionGroup>
          </List.Section>
          {configuredModels.length === 0 ? <HelperText type="info">No models found for your configured providers.</HelperText> : null}
        </Card.Content>
      </Card>

      <Card mode="contained" style={[styles.card, { backgroundColor: palette.surface }]}> 
        <Card.Content style={styles.section}>
          <Text variant="titleLarge" style={[styles.title, { color: palette.text }]}>Notifications</Text>
          <View style={[styles.connectionStatusCard, { backgroundColor: palette.background, borderColor: palette.border }]}> 
            <View style={styles.connectionStatusHeader}>
              <View style={styles.connectionStatusRow}>
                <View
                  style={[
                    styles.connectionStatusDot,
                    {
                      backgroundColor: notificationStatusTone,
                    },
                  ]}
                />
                <Text variant="labelLarge" style={{ color: palette.text }}>
                  {notificationStatusLabel}
                </Text>
              </View>
              <Text variant="bodySmall" style={{ color: palette.muted }}>
                {notificationSummary}
              </Text>
            </View>
          </View>
          <View style={styles.actionRow}>
            <Button mode="contained" disabled={notificationsEnabled} onPress={() => void handleEnableNotifications()}>
              Enable notifications
            </Button>
            <Button mode="outlined" disabled={notificationsEnabled} onPress={() => void handleOpenNotificationSettings()}>
              Notification settings
            </Button>
          </View>
          <List.Section style={styles.infoListSection}>
            <List.Item
              title="App settings"
              description="Review system settings for this app."
              titleStyle={{ color: palette.text }}
              descriptionStyle={{ color: palette.muted }}
              right={() => <Button disabled={notificationsEnabled} onPress={() => void handleOpenAppSettings()}>Open</Button>}
            />
            {Platform.OS === 'android' ? (
              <List.Item
                title="Battery optimization"
                description="Allow the app to run more reliably in the background."
                titleStyle={{ color: palette.text }}
                descriptionStyle={{ color: palette.muted }}
                right={() => <Button disabled={!notificationsEnabled} onPress={() => void handleOpenBatterySettings()}>Open</Button>}
              />
            ) : null}
            {Platform.OS === 'android' ? (
              <List.Item
                title="Battery saver"
                description="Battery saver can delay reminders."
                titleStyle={{ color: palette.text }}
                descriptionStyle={{ color: palette.muted }}
                right={() => <Button disabled={!notificationsEnabled} onPress={() => void handleOpenBatterySaverSettings()}>Open</Button>}
              />
            ) : null}
          </List.Section>
          <Button mode="text" loading={isRefreshingNotificationStatus} onPress={() => void refreshNotificationStatus()}>
            Refresh status
          </Button>
        </Card.Content>
      </Card>

      <Card mode="contained" style={[styles.card, { backgroundColor: palette.surface }]}> 
        <Card.Content style={styles.section}>
          <Text variant="titleLarge" style={[styles.title, { color: palette.text }]}>Voice</Text>
          <List.Section style={styles.infoListSection}>
            <List.Item
              title="On-device voice input"
              description="Prefer local speech recognition and avoid cloud fallback when possible."
              titleStyle={{ color: palette.text }}
              descriptionStyle={{ color: palette.muted }}
              right={() => (
                <Switch
                  value={chatPreferences.preferOnDeviceRecognition}
                  onValueChange={(value) => updateChatPreferences({ preferOnDeviceRecognition: value })}
                />
              )}
            />
            <List.Item
              title="Auto-play assistant replies"
              description="Read the latest assistant response aloud when it finishes."
              titleStyle={{ color: palette.text }}
              descriptionStyle={{ color: palette.muted }}
              right={() => (
                <Switch
                  value={chatPreferences.autoPlayAssistantReplies}
                  onValueChange={(value) => updateChatPreferences({ autoPlayAssistantReplies: value })}
                />
              )}
            />
            <List.Item
              title="Working sound"
              description="Play a calm loop while the assistant is still working on a reply."
              titleStyle={{ color: palette.text }}
              descriptionStyle={{ color: palette.muted }}
              right={() => (
                <Switch
                  value={chatPreferences.workingSoundEnabled}
                  onValueChange={(value) => updateChatPreferences({ workingSoundEnabled: value })}
                />
              )}
            />
            <List.Item
              title="Resume listening after reply"
              description="In conversation mode, start listening again after spoken playback ends."
              titleStyle={{ color: palette.text }}
              descriptionStyle={{ color: palette.muted }}
              right={() => (
                <Switch
                  value={chatPreferences.resumeListeningAfterReply}
                  onValueChange={(value) => updateChatPreferences({ resumeListeningAfterReply: value })}
                />
              )}
            />
          </List.Section>
          <TextInput
            mode="outlined"
            label="Speech locale"
            placeholder="en-US"
            value={chatPreferences.speechLocale || ''}
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={(value) => updateChatPreferences({ speechLocale: value.trim() || undefined })}
          />
          <HelperText type="info">Leave empty to use the system default language for voice input and playback.</HelperText>
          <Menu
            visible={responseScopeMenuVisible}
            onDismiss={() => setResponseScopeMenuVisible(false)}
            anchor={
              <Button mode="outlined" onPress={() => setResponseScopeMenuVisible(true)}>
                Response scope: {selectedResponseScope.label}
              </Button>
            }>
            {RESPONSE_SCOPE_OPTIONS.map((option) => (
              <Menu.Item
                key={option.value}
                title={option.label}
                onPress={() => {
                  updateChatPreferences({ responseScope: option.value });
                  setResponseScopeMenuVisible(false);
                }}
              />
            ))}
          </Menu>
          <HelperText type="info">{selectedResponseScope.description}</HelperText>
          <List.Item
            title="Simple next actions"
            description="End replies with a short recommendation when there is a clear next move."
            titleStyle={{ color: palette.text }}
            descriptionStyle={{ color: palette.muted }}
            right={() => (
              <Switch
                value={chatPreferences.includeNextActions}
                onValueChange={(value) => updateChatPreferences({ includeNextActions: value })}
              />
            )}
          />
          <TextInput
            mode="outlined"
            label="Speech rate"
            placeholder="1.0"
            value={String(chatPreferences.speechRate)}
            keyboardType="decimal-pad"
            onChangeText={(value) => {
              const normalized = value.replace(',', '.').trim();
              const parsed = Number(normalized);
              if (!normalized) {
                updateChatPreferences({ speechRate: 1 });
                return;
              }
              if (!Number.isFinite(parsed)) {
                return;
              }
              updateChatPreferences({ speechRate: Math.min(1.5, Math.max(0.5, parsed)) });
            }}
          />
          <HelperText type="info">Use a value between 0.5 and 1.5. `1` is the normal reading speed.</HelperText>
          <Menu
            visible={workingSoundMenuVisible}
            onDismiss={() => setWorkingSoundMenuVisible(false)}
            anchor={
              <Button mode="outlined" onPress={() => setWorkingSoundMenuVisible(true)}>
                Working sound: {selectedWorkingSound.label}
              </Button>
            }>
            {WORKING_SOUND_OPTIONS.map((option) => (
              <Menu.Item
                key={option.value}
                title={option.label}
                onPress={() => {
                  updateChatPreferences({ workingSoundVariant: option.value });
                  setWorkingSoundMenuVisible(false);
                }}
              />
            ))}
          </Menu>
          <HelperText type="info">{selectedWorkingSound.description}</HelperText>
          <TextInput
            mode="outlined"
            label="Working sound volume"
            placeholder="0.18"
            value={String(chatPreferences.workingSoundVolume)}
            keyboardType="decimal-pad"
            onChangeText={(value) => {
              const normalized = value.replace(',', '.').trim();
              const parsed = Number(normalized);
              if (!normalized) {
                updateChatPreferences({ workingSoundVolume: 0.18 });
                return;
              }
              if (!Number.isFinite(parsed)) {
                return;
              }
              updateChatPreferences({ workingSoundVolume: Math.min(1, Math.max(0, parsed)) });
            }}
          />
          <HelperText type="info">Use a value between 0 and 1. Lower values feel calmer in the background.</HelperText>
          <Menu
            visible={speechVoiceMenuVisible}
            onDismiss={() => setSpeechVoiceMenuVisible(false)}
            anchor={
              <Button mode="outlined" onPress={() => setSpeechVoiceMenuVisible(true)} loading={isRefreshingSpeechVoices}>
                Voice: {selectedSpeechVoiceLabel}
              </Button>
            }>
            <Menu.Item
              title="System default"
              onPress={() => {
                updateChatPreferences({ speechVoiceId: undefined });
                setSpeechVoiceMenuVisible(false);
              }}
            />
            {availableSpeechVoices.map((voice) => (
              <Menu.Item
                key={voice.id}
                title={voice.label}
                onPress={() => {
                  updateChatPreferences({ speechVoiceId: voice.id, speechLocale: chatPreferences.speechLocale || voice.language });
                  setSpeechVoiceMenuVisible(false);
                }}
              />
            ))}
          </Menu>
          <HelperText type="info">Shippable behavior: Android can keep a foreground service alive to monitor a running session and speak the finished reply. Continuous background microphone capture still is not supported.</HelperText>
        </Card.Content>
      </Card>

      </ScrollView>

      <Portal>
        {selectedProvider ? <Dialog visible onDismiss={resetProviderDialog}>
          <Dialog.Title>{selectedProviderCopy ? `Configure ${selectedProviderCopy.label}` : 'Configure provider'}</Dialog.Title>
          <Dialog.Content style={styles.dialogContent}>
            {selectedProviderCopy?.description ? (
              <Text variant="bodyMedium" style={{ color: palette.muted }}>{selectedProviderCopy.description}</Text>
            ) : null}
            {authMethods.length === 0 && useGenericFallback ? (
              <HelperText type="info">No provider-specific setup metadata was returned. You can paste an API key, or leave it empty to just enable the provider.</HelperText>
            ) : null}
            {authMethods.length === 0 && !useGenericFallback ? (
              <HelperText type="info">This provider should expose its auth flow from the server, but no auth metadata was returned. Refresh the connection and try again.</HelperText>
            ) : null}
            {effectiveAuthMethods.length > 1 ? (
              <RadioButton.Group
                onValueChange={(value) => {
                  const nextIndex = Number(value);
                  const nextMethod = effectiveAuthMethods[nextIndex];
                  const nextValues: Record<string, string> = {};
                  nextMethod?.prompts?.forEach((prompt) => {
                    if (prompt.type === 'select') {
                      nextValues[prompt.key] = prompt.options?.[0]?.value || '';
                    }
                  });
                  setSelectedMethodIndex(nextIndex);
                  setAuthValues(nextValues);
                }}
                value={String(selectedMethodIndex)}>
                {effectiveAuthMethods.map((method, index) => (
                  <View key={`${method.label}-${index}`} style={styles.authMethodRow}>
                    <RadioButton value={String(index)} />
                    <Text style={{ color: palette.text }}>{method.label}</Text>
                  </View>
                ))}
              </RadioButton.Group>
            ) : null}

            {visiblePrompts.map((prompt) =>
              prompt.type === 'select' ? (
                <View key={prompt.key} style={styles.promptGroup}>
                  <Text variant="labelLarge" style={{ color: palette.text }}>{prompt.message}</Text>
                  <View style={styles.chipWrap}>
                    {(prompt.options || []).map((option) => (
                      <Chip
                        key={option.value}
                        selected={authValues[prompt.key] === option.value}
                        onPress={() => setAuthValues((current) => ({ ...current, [prompt.key]: option.value }))}>
                        {option.label}
                      </Chip>
                    ))}
                  </View>
                </View>
              ) : (
                <TextInput
                  key={prompt.key}
                  mode="outlined"
                  label={prompt.message}
                  placeholder={prompt.placeholder}
                  value={authValues[prompt.key] || ''}
                  onChangeText={(value) => setAuthValues((current) => ({ ...current, [prompt.key]: value }))}
                  autoCapitalize="none"
                  autoCorrect={false}
                  secureTextEntry={/token|key|secret|password/i.test(prompt.key)}
                />
              ),
            )}

            {selectedMethod?.type === 'oauth' ? (
              <HelperText type="info">This opens the provider sign-in flow in your browser.</HelperText>
            ) : null}
            {!selectedMethod && authMethods.length === 0 && !useGenericFallback ? (
              <HelperText type="error">Setup details for this provider are unavailable right now.</HelperText>
            ) : null}
            {providerDialogError ? <HelperText type="error">{providerDialogError}</HelperText> : null}
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={resetProviderDialog}>Cancel</Button>
            <Button testID="settings-provider-save-button" disabled={!selectedMethod} loading={isConfiguringProvider} onPress={() => void submitProviderConfiguration()}>
              {selectedMethod?.type === 'oauth' ? 'Continue' : 'Save'}
            </Button>
          </Dialog.Actions>
        </Dialog> : null}
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
  card: { borderRadius: 16 },
  section: { gap: 14 },
  title: { fontWeight: '600' },
  connectionStatusCard: { borderRadius: 14, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 12 },
  connectionStatusHeader: { gap: 6 },
  connectionStatusRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  connectionStatusDot: { width: 10, height: 10, borderRadius: 999 },
  providerHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  infoListSection: { marginVertical: 0 },
  modelListSection: { gap: 10 },
  dialogContent: { gap: 14 },
  authMethodRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  promptGroup: { gap: 8 },
  providerAccordion: { borderRadius: 14, borderWidth: 1, overflow: 'hidden', marginBottom: 10 },
  providerAccordionIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 4,
    marginRight: 8,
  },
  modelListItem: { paddingLeft: 16, paddingRight: 8 },
});
