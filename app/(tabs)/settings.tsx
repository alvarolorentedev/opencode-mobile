import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import {
  Button,
  Card,
  Chip,
  HelperText,
  Menu,
  RadioButton,
  Text,
  TextInput,
} from 'react-native-paper';

import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { formatTimestamp } from '@/lib/opencode/format';
import { useOpencode } from '@/providers/opencode-provider';

export default function SettingsScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const {
    availableModels,
    availableProviders,
    chatPreferences,
    configureProvider,
    configuredProviders,
    connect,
    connection,
    settings,
    updateChatPreferences,
    updateSettings,
  } = useOpencode();
  const [isConnecting, setIsConnecting] = useState(false);
  const [addProviderMenuVisible, setAddProviderMenuVisible] = useState(false);

  const providerModels = useMemo(
    () => availableModels.filter((model) => model.providerID === chatPreferences.providerId && configuredProviders.some((provider) => provider.id === model.providerID)),
    [availableModels, chatPreferences.providerId, configuredProviders],
  );
  const unconfiguredProviders = useMemo(
    () => availableProviders.filter((provider) => !provider.configured),
    [availableProviders],
  );

  async function handleConnect() {
    setIsConnecting(true);
    try {
      await connect();
    } finally {
      setIsConnecting(false);
    }
  }

  return (
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
                    title={provider.label}
                    onPress={() => {
                      setAddProviderMenuVisible(false);
                      void configureProvider(provider.id);
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
                selected={chatPreferences.providerId === provider.id}
                onPress={() => updateChatPreferences({ providerId: provider.id })}>
                {provider.label}
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
  optionCard: { borderRadius: 14 },
  metaRow: { gap: 4 },
});
