import { Platform, StyleSheet, View } from 'react-native';
import {
  Button,
  Card,
  Checkbox,
  Chip,
  HelperText,
  List,
  Menu,
  Switch,
  Text,
  TextInput,
} from 'react-native-paper';

import { renderProviderIcon } from '@/components/ui/provider-icon';
import { Colors } from '@/constants/theme';
import { formatTimestamp } from '@/lib/opencode/format';
import type { NotificationDebugStatus } from '@/lib/notifications';
import type { OpencodeConnectionSettings } from '@/lib/opencode/client';
import type { SpeechVoiceOption } from '@/lib/voice/speech-output';
import type { WorkingSoundVariant } from '@/lib/voice/working-sound';
import type { ChatPreferences, ModelOption, ProviderOption, ResponseScope } from '@/providers/opencode-provider';
import { getProviderCopy, RESPONSE_SCOPE_OPTIONS, WORKING_SOUND_OPTIONS } from '@/components/settings/settings-utils';

type Palette = typeof Colors.light;

type ConnectionSectionProps = {
  connection: { status: 'idle' | 'connecting' | 'connected' | 'error'; message: string; checkedAt?: number };
  isConnecting: boolean;
  onReconnect: () => void;
  palette: Palette;
  settings: OpencodeConnectionSettings;
  updateSettings: (patch: Partial<OpencodeConnectionSettings>) => void;
};

export function ConnectionSection({ connection, isConnecting, onReconnect, palette, settings, updateSettings }: ConnectionSectionProps) {
  return (
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
        <Button testID="settings-reconnect-button" mode="contained" loading={isConnecting} onPress={onReconnect}>
          Reconnect
        </Button>
      </Card.Content>
    </Card>
  );
}

type AiDefaultsSectionProps = {
  addProviderMenuVisible: boolean;
  availableModels: ModelOption[];
  availableProviders: ProviderOption[];
  chatPreferences: ChatPreferences;
  configuredProviders: ProviderOption[];
  enabledModelIds: Set<string>;
  expandedProviderId?: string;
  onExpandedProviderChange: (providerId?: string) => void;
  onMenuVisibilityChange: (visible: boolean) => void;
  onModelToggle: (modelId: string, checked: boolean) => void;
  onStartProviderConfiguration: (providerId: string) => void;
  palette: Palette;
};

export function AiDefaultsSection({
  addProviderMenuVisible,
  availableModels,
  availableProviders,
  chatPreferences,
  configuredProviders,
  enabledModelIds,
  expandedProviderId,
  onExpandedProviderChange,
  onMenuVisibilityChange,
  onModelToggle,
  onStartProviderConfiguration,
  palette,
}: AiDefaultsSectionProps) {
  const configuredModels = availableModels.filter((model) => configuredProviders.some((provider) => provider.id === model.providerID));
  const configuredProviderModels = configuredProviders
    .map((provider) => ({
      provider,
      models: configuredModels.filter((model) => model.providerID === provider.id),
    }))
    .filter((entry) => entry.models.length > 0);
  const unconfiguredProviders = availableProviders.filter((provider) => !provider.configured);

  return (
    <Card mode="contained" style={[styles.card, { backgroundColor: palette.surface }]}>
      <Card.Content style={styles.section}>
        <Text variant="titleLarge" style={[styles.title, { color: palette.text }]}>AI defaults</Text>
        <Text variant="bodyMedium" style={{ color: palette.muted }}>
          Choose which configured models appear in chat. The last model you pick in chat stays selected for new chats.
        </Text>
        <View style={styles.providerHeader}>
          <Text variant="labelLarge" style={{ color: palette.text }}>Configured providers</Text>
          {unconfiguredProviders.length > 0 ? (
            <Menu
              visible={addProviderMenuVisible}
              onDismiss={() => onMenuVisibilityChange(false)}
              anchor={
                <Button testID="settings-add-provider-button" compact mode="outlined" onPress={() => onMenuVisibilityChange(true)}>
                  Add provider
                </Button>
              }>
              {unconfiguredProviders.map((provider) => (
                <Menu.Item
                  key={provider.id}
                  leadingIcon={(props) => renderProviderIcon(provider.id, props.size, props.color)}
                  title={getProviderCopy(provider.id, provider.label).label}
                  onPress={() => onStartProviderConfiguration(provider.id)}
                />
              ))}
            </Menu>
          ) : null}
        </View>

        <View style={styles.chipWrap}>
          {configuredProviders.map((provider) => (
            <Chip key={provider.id} icon={({ size, color }) => renderProviderIcon(provider.id, size, color)} compact>
              {getProviderCopy(provider.id, provider.label).label}
            </Chip>
          ))}
        </View>
        {availableProviders.length === 0 ? <HelperText type="info">Connect first to load providers.</HelperText> : null}
        {availableProviders.length > 0 && configuredProviders.length === 0 ? (
          <HelperText type="info">Configure at least one provider to pick defaults.</HelperText>
        ) : null}
        <List.Section style={styles.modelListSection}>
          <List.AccordionGroup expandedId={expandedProviderId} onAccordionPress={(id) => onExpandedProviderChange(expandedProviderId === String(id) ? undefined : String(id))}>
            {configuredProviderModels.map(({ provider, models }) => {
              const selectedCount = models.filter((model) => enabledModelIds.has(model.id)).length;

              return (
                <List.Accordion
                  key={provider.id}
                  id={provider.id}
                  title={getProviderCopy(provider.id, provider.label).label}
                  description={`${selectedCount} of ${models.length} selected`}
                  left={() => (
                    <View style={[styles.providerAccordionIconWrap, { backgroundColor: palette.surfaceAlt, borderColor: palette.border }]}>
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
                        onPress={() => onModelToggle(model.id, checked)}
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
  );
}

type NotificationsSectionProps = {
  isRefreshingNotificationStatus: boolean;
  notificationStatus?: NotificationDebugStatus;
  onEnableNotifications: () => void;
  onOpenAppSettings: () => void;
  onOpenBatterySaverSettings: () => void;
  onOpenBatterySettings: () => void;
  onOpenNotificationSettings: () => void;
  onRefreshStatus: () => void;
  palette: Palette;
};

export function NotificationsSection({
  isRefreshingNotificationStatus,
  notificationStatus,
  onEnableNotifications,
  onOpenAppSettings,
  onOpenBatterySaverSettings,
  onOpenBatterySettings,
  onOpenNotificationSettings,
  onRefreshStatus,
  palette,
}: NotificationsSectionProps) {
  const notificationsEnabled = Boolean(notificationStatus?.permissionGranted);
  const notificationStatusLabel = !notificationStatus ? 'Checking' : notificationsEnabled ? 'Enabled' : 'Needs setup';
  const notificationStatusTone = !notificationStatus ? palette.icon : notificationsEnabled ? palette.success : palette.warning;
  const backgroundStatusLabel = !notificationStatus
    ? 'Checking'
    : notificationStatus.backgroundMonitoringSupported
      ? notificationStatus.backgroundTaskRegistered
        ? 'Ready'
        : 'Limited'
      : 'Limited';
  const notificationSummary = `${notificationsEnabled ? 'Notifications enabled' : 'Notifications off'}${backgroundStatusLabel === 'Checking' ? '' : ` • Background ${backgroundStatusLabel.toLowerCase()}`}`;

  return (
    <Card mode="contained" style={[styles.card, { backgroundColor: palette.surface }]}>
      <Card.Content style={styles.section}>
        <Text variant="titleLarge" style={[styles.title, { color: palette.text }]}>Notifications</Text>
        <View style={[styles.connectionStatusCard, { backgroundColor: palette.background, borderColor: palette.border }]}>
          <View style={styles.connectionStatusHeader}>
            <View style={styles.connectionStatusRow}>
              <View style={[styles.connectionStatusDot, { backgroundColor: notificationStatusTone }]} />
              <Text variant="labelLarge" style={{ color: palette.text }}>{notificationStatusLabel}</Text>
            </View>
            <Text variant="bodySmall" style={{ color: palette.muted }}>{notificationSummary}</Text>
          </View>
        </View>
        <View style={styles.actionRow}>
          <Button mode="contained" disabled={notificationsEnabled} onPress={onEnableNotifications}>
            Enable notifications
          </Button>
          <Button mode="outlined" disabled={notificationsEnabled} onPress={onOpenNotificationSettings}>
            Notification settings
          </Button>
        </View>
        <List.Section style={styles.infoListSection}>
          <List.Item
            title="App settings"
            description="Review system settings for this app."
            titleStyle={{ color: palette.text }}
            descriptionStyle={{ color: palette.muted }}
            right={() => <Button disabled={notificationsEnabled} onPress={onOpenAppSettings}>Open</Button>}
          />
          {Platform.OS === 'android' ? (
            <List.Item
              title="Battery optimization"
              description="Allow the app to run more reliably in the background."
              titleStyle={{ color: palette.text }}
              descriptionStyle={{ color: palette.muted }}
              right={() => <Button disabled={!notificationsEnabled} onPress={onOpenBatterySettings}>Open</Button>}
            />
          ) : null}
          {Platform.OS === 'android' ? (
            <List.Item
              title="Battery saver"
              description="Battery saver can delay reminders."
              titleStyle={{ color: palette.text }}
              descriptionStyle={{ color: palette.muted }}
              right={() => <Button disabled={!notificationsEnabled} onPress={onOpenBatterySaverSettings}>Open</Button>}
            />
          ) : null}
        </List.Section>
        <Button mode="text" loading={isRefreshingNotificationStatus} onPress={onRefreshStatus}>
          Refresh status
        </Button>
      </Card.Content>
    </Card>
  );
}

type VoiceSectionProps = {
  availableSpeechVoices: SpeechVoiceOption[];
  chatPreferences: ChatPreferences;
  isRefreshingSpeechVoices: boolean;
  onResponseScopeMenuVisibleChange: (visible: boolean) => void;
  onSpeechVoiceMenuVisibleChange: (visible: boolean) => void;
  onWorkingSoundMenuVisibleChange: (visible: boolean) => void;
  palette: Palette;
  responseScopeMenuVisible: boolean;
  selectedResponseScope: { value: ResponseScope; label: string; description: string };
  selectedSpeechVoiceLabel: string;
  selectedWorkingSound: { value: WorkingSoundVariant; label: string; description: string };
  speechVoiceMenuVisible: boolean;
  updateChatPreferences: (patch: Partial<ChatPreferences>) => void;
  workingSoundMenuVisible: boolean;
};

export function VoiceSection({
  availableSpeechVoices,
  chatPreferences,
  isRefreshingSpeechVoices,
  onResponseScopeMenuVisibleChange,
  onSpeechVoiceMenuVisibleChange,
  onWorkingSoundMenuVisibleChange,
  palette,
  responseScopeMenuVisible,
  selectedResponseScope,
  selectedSpeechVoiceLabel,
  selectedWorkingSound,
  speechVoiceMenuVisible,
  updateChatPreferences,
  workingSoundMenuVisible,
}: VoiceSectionProps) {
  return (
    <Card mode="contained" style={[styles.card, { backgroundColor: palette.surface }]}>
      <Card.Content style={styles.section}>
        <Text variant="titleLarge" style={[styles.title, { color: palette.text }]}>Voice</Text>
        <List.Section style={styles.infoListSection}>
          <SettingSwitchRow
            description="Prefer local speech recognition and avoid cloud fallback when possible."
            onValueChange={(value) => updateChatPreferences({ preferOnDeviceRecognition: value })}
            palette={palette}
            title="On-device voice input"
            value={chatPreferences.preferOnDeviceRecognition}
          />
          <SettingSwitchRow
            description="Read the latest assistant response aloud when it finishes."
            onValueChange={(value) => updateChatPreferences({ autoPlayAssistantReplies: value })}
            palette={palette}
            title="Auto-play assistant replies"
            value={chatPreferences.autoPlayAssistantReplies}
          />
          <SettingSwitchRow
            description="Play a calm loop while the assistant is still working on a reply."
            onValueChange={(value) => updateChatPreferences({ workingSoundEnabled: value })}
            palette={palette}
            title="Working sound"
            value={chatPreferences.workingSoundEnabled}
          />
          <SettingSwitchRow
            description="In conversation mode, start listening again after spoken playback ends."
            onValueChange={(value) => updateChatPreferences({ resumeListeningAfterReply: value })}
            palette={palette}
            title="Resume listening after reply"
            value={chatPreferences.resumeListeningAfterReply}
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
          onDismiss={() => onResponseScopeMenuVisibleChange(false)}
          anchor={
            <Button mode="outlined" onPress={() => onResponseScopeMenuVisibleChange(true)}>
              Response scope: {selectedResponseScope.label}
            </Button>
          }>
          {RESPONSE_SCOPE_OPTIONS.map((option) => (
            <Menu.Item
              key={option.value}
              title={option.label}
              onPress={() => {
                updateChatPreferences({ responseScope: option.value });
                onResponseScopeMenuVisibleChange(false);
              }}
            />
          ))}
        </Menu>
        <HelperText type="info">{selectedResponseScope.description}</HelperText>
        <SettingSwitchRow
          description="End replies with a short recommendation when there is a clear next move."
          onValueChange={(value) => updateChatPreferences({ includeNextActions: value })}
          palette={palette}
          title="Simple next actions"
          value={chatPreferences.includeNextActions}
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
          onDismiss={() => onWorkingSoundMenuVisibleChange(false)}
          anchor={
            <Button mode="outlined" onPress={() => onWorkingSoundMenuVisibleChange(true)}>
              Working sound: {selectedWorkingSound.label}
            </Button>
          }>
          {WORKING_SOUND_OPTIONS.map((option) => (
            <Menu.Item
              key={option.value}
              title={option.label}
              onPress={() => {
                updateChatPreferences({ workingSoundVariant: option.value });
                onWorkingSoundMenuVisibleChange(false);
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
          onDismiss={() => onSpeechVoiceMenuVisibleChange(false)}
          anchor={
            <Button mode="outlined" onPress={() => onSpeechVoiceMenuVisibleChange(true)} loading={isRefreshingSpeechVoices}>
              Voice: {selectedSpeechVoiceLabel}
            </Button>
          }>
          <Menu.Item
            title="System default"
            onPress={() => {
              updateChatPreferences({ speechVoiceId: undefined });
              onSpeechVoiceMenuVisibleChange(false);
            }}
          />
          {availableSpeechVoices.map((voice) => (
            <Menu.Item
              key={voice.id}
              title={voice.label}
              onPress={() => {
                updateChatPreferences({ speechVoiceId: voice.id, speechLocale: chatPreferences.speechLocale || voice.language });
                onSpeechVoiceMenuVisibleChange(false);
              }}
            />
          ))}
        </Menu>
        <HelperText type="info">
          Shippable behavior: Android can keep a foreground service alive to monitor a running session and speak the finished reply. Continuous background microphone capture still is not supported.
        </HelperText>
      </Card.Content>
    </Card>
  );
}

function SettingSwitchRow({
  description,
  onValueChange,
  palette,
  title,
  value,
}: {
  description: string;
  onValueChange: (value: boolean) => void;
  palette: Palette;
  title: string;
  value: boolean;
}) {
  return (
    <List.Item
      title={title}
      description={description}
      titleStyle={{ color: palette.text }}
      descriptionStyle={{ color: palette.muted }}
      right={() => <Switch value={value} onValueChange={onValueChange} />}
    />
  );
}

const styles = StyleSheet.create({
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
