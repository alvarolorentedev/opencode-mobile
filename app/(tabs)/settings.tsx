import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import {
  Button,
  Card,
  Chip,
  Dialog,
  HelperText,
  Menu,
  Portal,
  RadioButton,
  Snackbar,
  Text,
  TextInput,
} from 'react-native-paper';

import { Colors } from '@/constants/theme';
import { renderProviderIcon } from '@/components/ui/provider-icon';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { formatTimestamp } from '@/lib/opencode/format';
import { useOpencode } from '@/providers/opencode-provider';

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

  const providerModels = useMemo(
    () => availableModels.filter((model) => model.providerID === chatPreferences.providerId && configuredProviders.some((provider) => provider.id === model.providerID)),
    [availableModels, chatPreferences.providerId, configuredProviders],
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
          <TextInput
            mode="outlined"
            label="Server URL"
            value={settings.serverUrl}
            onChangeText={(value) => updateSettings({ serverUrl: value })}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="http://192.168.1.10:4096"
          />
          <TextInput
            mode="outlined"
            label="Username"
            value={settings.username}
            onChangeText={(value) => updateSettings({ username: value })}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <TextInput
            mode="outlined"
            label="Password"
            value={settings.password}
            onChangeText={(value) => updateSettings({ password: value })}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Button mode="contained" loading={isConnecting} onPress={() => void handleConnect()}>
            Reconnect
          </Button>
        </Card.Content>
      </Card>

      <Card mode="contained" style={[styles.card, { backgroundColor: palette.surface }]}> 
        <Card.Content style={styles.section}>
          <Text variant="titleLarge" style={[styles.title, { color: palette.text }]}>AI defaults</Text>
          <Text variant="bodyMedium" style={{ color: palette.muted }}>Configure providers first, then choose defaults from the configured ones.</Text>
          <View style={styles.providerHeader}>
            <Text variant="labelLarge" style={{ color: palette.text }}>Configured providers</Text>
            {unconfiguredProviders.length > 0 ? (
              <Menu
                visible={addProviderMenuVisible}
                onDismiss={() => setAddProviderMenuVisible(false)}
                anchor={
                  <Button compact mode="outlined" onPress={() => setAddProviderMenuVisible(true)}>
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
                  selected={chatPreferences.providerId === provider.id}
                  onPress={() => updateChatPreferences({ providerId: provider.id })}>
                  {getProviderCopy(provider.id, provider.label).label}
                </Chip>
              ))}
            </View>
          {availableProviders.length === 0 ? <HelperText type="info">Connect first to load providers.</HelperText> : null}
          {availableProviders.length > 0 && configuredProviders.length === 0 ? <HelperText type="info">Configure at least one provider to pick defaults.</HelperText> : null}
          <RadioButton.Group
            onValueChange={(value) => updateChatPreferences({ modelId: value, providerId: chatPreferences.providerId })}
            value={chatPreferences.modelId || ''}>
            <View style={styles.radioGroup}>
              {providerModels.map((model) => (
                <Card key={model.id} mode="outlined" style={styles.optionCard}>
                  <Card.Title
                    title={model.label}
                    subtitle={model.supportsReasoning ? 'Reasoning supported' : 'Standard model'}
                    left={() => <RadioButton value={model.id} />}
                  />
                </Card>
              ))}
            </View>
          </RadioButton.Group>
          {chatPreferences.providerId && providerModels.length === 0 ? <HelperText type="info">No models found for this provider.</HelperText> : null}
        </Card.Content>
      </Card>

      <Card mode="contained" style={[styles.card, { backgroundColor: palette.surface }]}> 
        <Card.Content style={styles.section}>
          <Text variant="titleLarge" style={[styles.title, { color: palette.text }]}>Status</Text>
          <MetaRow label="Connection" value={connection.status} />
          <MetaRow label="Message" value={connection.message} />
          <MetaRow label="Workspace" value={connection.projectDirectory || 'Not connected'} />
          <MetaRow label="Checked" value={connection.checkedAt ? formatTimestamp(connection.checkedAt) : 'Not yet'} />
        </Card.Content>
      </Card>
      </ScrollView>

      <Portal>
        <Dialog visible={Boolean(selectedProvider)} onDismiss={resetProviderDialog}>
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
            <Button disabled={!selectedMethod} loading={isConfiguringProvider} onPress={() => void submitProviderConfiguration()}>
              {selectedMethod?.type === 'oauth' ? 'Continue' : 'Save'}
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>

      <Snackbar
        visible={Boolean(providerFeedback)}
        onDismiss={() => setProviderFeedback(undefined)}
        duration={4000}>
        {providerFeedback?.message}
      </Snackbar>
    </>
  );
}

function MetaRow({ label, value }: { label: string; value: string }) {
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];

  return (
    <View style={styles.metaRow}>
      <Text variant="labelMedium" style={{ color: palette.muted }}>{label}</Text>
      <Text variant="bodyMedium" style={{ color: palette.text }}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: 16, gap: 16, paddingBottom: 28 },
  card: { borderRadius: 16 },
  section: { gap: 14 },
  title: { fontWeight: '600' },
  providerHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  radioGroup: { gap: 10 },
  dialogContent: { gap: 14 },
  authMethodRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  promptGroup: { gap: 8 },
  optionCard: { borderRadius: 14 },
  metaRow: { gap: 4 },
});
