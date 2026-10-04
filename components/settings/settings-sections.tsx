import { useTranslation } from 'react-i18next';
import { Platform, Pressable, StyleSheet, Switch as NativeSwitch, Text as NativeText, View } from 'react-native';
import {
  Button,
  Checkbox,
  Chip,
  HelperText,
  List,
  Text,
} from 'react-native-paper';

import { ConnectionProfiles } from '@/components/settings/connection-profiles';
import { NativeSelect, type NativeSelectOption } from '@/components/ui/native-select';
import { NumericSlider } from '@/components/ui/numeric-slider';
import { TextInput } from '@/components/ui/text-input';
import { renderProviderIcon } from '@/components/ui/provider-icon';
import { ACCENT_MODES, getAccentPreviewColor, type AccentMode } from '@/constants/accent';
import { Colors, Fonts } from '@/constants/theme';
import { formatTimestamp } from '@/lib/opencode/format';
import type { NotificationDebugStatus } from '@/lib/notifications';
import type { VoiceCapabilities } from '@/lib/voice/capabilities';
import type { SpeechVoiceOption } from '@/lib/voice/speech-output';
import type { WorkingSoundVariant } from '@/lib/voice/working-sound';
import type { ChatPreferences, ModelOption, ProviderOption, ResponseScope } from '@/providers/opencode-provider';
import { normalizeTranscriptFontSize, TRANSCRIPT_FONT_SIZE_MAX, TRANSCRIPT_FONT_SIZE_MIN } from '@/providers/opencode-preferences';
import type { Diagnostics } from '@/providers/services/diagnostics-service';
import { getProviderCopy, LANGUAGE_OPTIONS, RESPONSE_SCOPE_OPTIONS, WORKING_SOUND_OPTIONS } from '@/components/settings/settings-utils';

type Palette = typeof Colors.light;

export function DiagnosticsSection({
  diagnostics,
  eventStreamStatus,
  formatterAvailable = true,
  lspAvailable = true,
  onRefresh,
  palette,
}: {
  diagnostics?: Diagnostics;
  eventStreamStatus: 'idle' | 'connecting' | 'connected' | 'error';
  formatterAvailable?: boolean;
  lspAvailable?: boolean;
  onRefresh: () => void;
  palette: Palette;
}) {
  const { t } = useTranslation();
  const health = diagnostics?.health.available ? diagnostics.health.data : undefined;
  const mcpCount = diagnostics?.mcp.available ? Object.keys(diagnostics.mcp.data).length : undefined;
  const lspCount = lspAvailable && diagnostics?.lsp.available ? diagnostics.lsp.data.length : undefined;
  const formatterCount = formatterAvailable && diagnostics?.formatter.available ? diagnostics.formatter.data.length : undefined;
  const notAvailable = t('settings:diagnostics.notAvailable');
  const subsystemParts = [t('settings:diagnostics.subsystemsMcp', { value: mcpCount ?? notAvailable })];
  if (lspAvailable) subsystemParts.push(t('settings:diagnostics.subsystemsLsp', { value: lspCount ?? notAvailable }));
  if (formatterAvailable) subsystemParts.push(t('settings:diagnostics.subsystemsFormatters', { value: formatterCount ?? notAvailable }));
  return (
    <View style={styles.section}>
        <Text variant="titleLarge" style={[styles.title, { color: palette.text }]}>{t('settings:diagnostics.title')}</Text>
        <List.Item title={t('settings:diagnostics.server')} description={health ? t('settings:diagnostics.openCodeVersion', { version: health.version }) : t('settings:diagnostics.healthUnavailable')} right={() => <Chip compact>{health?.healthy ? t('settings:diagnostics.healthy') : t('common:labels.unknown')}</Chip>} />
        <List.Item title={t('settings:diagnostics.realtimeUpdates')} description={eventStreamStatus === 'connected' ? t('settings:diagnostics.eventStreamConnected') : t('settings:diagnostics.pollingFallback')} right={() => <Chip compact>{eventStreamStatus}</Chip>} />
        <List.Item title={t('settings:diagnostics.subsystems')} description={subsystemParts.join(' • ')} />
        <Button mode="outlined" onPress={onRefresh}>{t('settings:diagnostics.refresh')}</Button>
    </View>
  );
}

type ConnectionSectionProps = {
  connection: { status: 'idle' | 'connecting' | 'connected' | 'error'; message: string; checkedAt?: number };
  palette: Palette;
  onPair?: () => void;
  onManageConnect?: () => void;
};

export function ConnectionSection({ connection, palette, onPair, onManageConnect }: ConnectionSectionProps) {
  const { t } = useTranslation();
  return (
    <View style={styles.section}>
        <Text variant="bodyMedium" style={{ color: palette.muted }}>{connection.message}</Text>
        {connection.checkedAt ? <Text variant="bodySmall" style={{ color: palette.muted }}>{t('settings:connection.lastChecked', { time: formatTimestamp(connection.checkedAt) })}</Text> : null}
        <ConnectionProfiles palette={palette} onManageConnect={onManageConnect} onPair={onPair} />
    </View>
  );
}

type AiDefaultsSectionProps = {
  availableModels: ModelOption[];
  availableProviders: ProviderOption[];
  chatPreferences: ChatPreferences;
  configuredProviders: ProviderOption[];
  enabledModelIds: Set<string>;
  expandedProviderId?: string;
  onExpandedProviderChange: (providerId?: string) => void;
  onModelToggle: (modelId: string, checked: boolean) => void;
  onRemoveProvider: (providerId: string) => void;
  onStartProviderConfiguration: (providerId: string) => void;
  palette: Palette;
};

export function AiDefaultsSection({
  availableModels,
  availableProviders,
  chatPreferences,
  configuredProviders,
  enabledModelIds,
  expandedProviderId,
  onExpandedProviderChange,
  onModelToggle,
  onRemoveProvider,
  onStartProviderConfiguration,
  palette,
}: AiDefaultsSectionProps) {
  const { t } = useTranslation();
  const configuredModels = availableModels.filter((model) => configuredProviders.some((provider) => provider.id === model.providerID));
  const configuredProviderModels = configuredProviders
    .map((provider) => ({
      provider,
      models: configuredModels.filter((model) => model.providerID === provider.id),
    }))
    .filter((entry) => entry.models.length > 0);
  const unconfiguredProviders = availableProviders.filter((provider) => !provider.configured);

  return (
    <View style={styles.section}>
        <Text variant="bodyMedium" style={{ color: palette.muted }}>
          {t('settings:providers.chooseModels')}
        </Text>
        <View style={styles.providerHeader}>
          <Text variant="labelLarge" style={{ color: palette.text }}>{t('settings:providers.configuredProviders')}</Text>
          {unconfiguredProviders.length > 0 ? (
            <NativeSelect
              onValueChange={onStartProviderConfiguration}
              options={unconfiguredProviders.map((provider) => ({
                label: getProviderCopy(provider.id, provider.label, t).label,
                leadingIcon: (props) => renderProviderIcon(provider.id, props.size, props.color),
                value: provider.id,
              }))}
              title={t('settings:providers.addProvider')}
              renderTrigger={({ disabled, open, openState }) => (
                <Pressable
                  accessibilityRole="button"
                  disabled={disabled}
                  onPress={open}
                  testID="settings-add-provider-button"
                  style={({ pressed }) => [
                    styles.inlineSelectButton,
                    {
                      backgroundColor: palette.surface,
                      borderColor: openState ? palette.tint : palette.border,
                      opacity: disabled ? 0.45 : pressed ? 0.82 : 1,
                    },
                  ]}>
                  <NativeText style={[styles.inlineSelectButtonLabel, { color: palette.text }]}>{t('settings:providers.addProvider')}</NativeText>
                </Pressable>
              )}
            />
          ) : null}
        </View>

        <View style={styles.chipWrap}>
          {configuredProviders.map((provider) => (
            <Chip key={provider.id} icon={({ size, color }) => renderProviderIcon(provider.id, size, color)} compact closeIconAccessibilityLabel={t('settings:providers.removeCredentials', { provider: getProviderCopy(provider.id, provider.label, t).label })} onClose={() => onRemoveProvider(provider.id)}>
              {getProviderCopy(provider.id, provider.label, t).label}
            </Chip>
          ))}
        </View>
        {availableProviders.length === 0 ? <HelperText type="info">{t('settings:providers.connectFirst')}</HelperText> : null}
        {availableProviders.length > 0 && configuredProviders.length === 0 ? (
          <HelperText type="info">{t('settings:providers.configureAtLeastOne')}</HelperText>
        ) : null}
        <List.Section style={styles.modelListSection}>
          <List.AccordionGroup expandedId={expandedProviderId} onAccordionPress={(id) => onExpandedProviderChange(expandedProviderId === String(id) ? undefined : String(id))}>
            {configuredProviderModels.map(({ provider, models }) => {
              const selectedCount = models.filter((model) => enabledModelIds.has(model.id)).length;

              return (
                <List.Accordion
                  key={provider.id}
                  id={provider.id}
                  title={getProviderCopy(provider.id, provider.label, t).label}
                  description={t('settings:providers.selectedCount', { selected: selectedCount, total: models.length })}
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
                        description={model.supportsReasoning ? t('settings:providers.reasoningSupported') : t('settings:providers.standardModel')}
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
        {configuredModels.length === 0 ? <HelperText type="info">{t('settings:providers.noModels')}</HelperText> : null}
    </View>
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
  const { t } = useTranslation();
  const notificationsEnabled = Boolean(notificationStatus?.permissionGranted);
  const notificationStatusKey = !notificationStatus ? 'checking' : notificationsEnabled ? 'enabled' : 'needsSetup';
  const notificationStatusTone = !notificationStatus ? palette.icon : notificationsEnabled ? palette.success : palette.warning;
  const backgroundStatusKey = !notificationStatus
    ? 'checking'
    : notificationStatus.backgroundMonitoringSupported
      ? notificationStatus.backgroundTaskRegistered
        ? 'ready'
        : 'limited'
      : 'limited';
  const notificationStatusLabel = t(`settings:notifications.status.${notificationStatusKey}`);
  const backgroundStatusLabel = t(`settings:notifications.background.${backgroundStatusKey}`);
  const notificationSummary = `${t(notificationsEnabled ? 'settings:notifications.summary.enabled' : 'settings:notifications.summary.off')}${backgroundStatusKey === 'checking' ? '' : ` • ${t('settings:notifications.summary.background', { status: backgroundStatusLabel.toLowerCase() })}`}`;

  return (
    <View style={styles.section}>
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
            {t('settings:notifications.enable')}
          </Button>
          <Button mode="outlined" onPress={onOpenNotificationSettings}>
            {t('settings:notifications.settings')}
          </Button>
        </View>
        <List.Section style={styles.infoListSection}>
          <List.Item
            title={t('settings:notifications.appSettings')}
            description={t('settings:notifications.appSettingsDescription')}
            titleStyle={{ color: palette.text }}
            descriptionStyle={{ color: palette.muted }}
            right={() => <Button onPress={onOpenAppSettings}>{t('common:actions.open')}</Button>}
          />
          {Platform.OS === 'android' ? (
            <List.Item
              title={t('settings:notifications.batteryOptimization')}
              description={t('settings:notifications.batteryOptimizationDescription')}
              titleStyle={{ color: palette.text }}
              descriptionStyle={{ color: palette.muted }}
              right={() => <Button disabled={!notificationsEnabled} onPress={onOpenBatterySettings}>{t('common:actions.open')}</Button>}
            />
          ) : null}
          {Platform.OS === 'android' ? (
            <List.Item
              title={t('settings:notifications.batterySaver')}
              description={t('settings:notifications.batterySaverDescription')}
              titleStyle={{ color: palette.text }}
              descriptionStyle={{ color: palette.muted }}
              right={() => <Button disabled={!notificationsEnabled} onPress={onOpenBatterySaverSettings}>{t('common:actions.open')}</Button>}
            />
          ) : null}
        </List.Section>
        <Button mode="text" loading={isRefreshingNotificationStatus} onPress={onRefreshStatus}>
          {t('settings:notifications.refreshStatus')}
        </Button>
    </View>
  );
}

type VoiceSectionProps = {
  availableSpeechVoices: SpeechVoiceOption[];
  chatPreferences: ChatPreferences;
  isRefreshingSpeechVoices: boolean;
  isRefreshingVoiceCapabilities: boolean;
  isTestingVoice: boolean;
  onEnableVoiceInput: () => void;
  onOpenVoiceSettings: () => void;
  onRefreshVoiceCapabilities: () => void;
  onTestVoicePlayback: () => void;
  palette: Palette;
  selectedResponseScope: { value: ResponseScope };
  selectedSpeechVoiceLabel: string;
  selectedWorkingSound: { value: WorkingSoundVariant };
  updateChatPreferences: (patch: Partial<ChatPreferences>) => void;
  voiceCapabilities?: VoiceCapabilities;
};

function VoiceCheckRow({ label, palette, status }: { label: string; palette: Palette; status: string }) {
  return (
    <View style={styles.voiceCheckRow}>
      <Text variant="bodyMedium" style={{ color: palette.text }}>{label}</Text>
      <Text variant="labelMedium" style={{ color: palette.muted }}>{status}</Text>
    </View>
  );
}

export function VoiceSection({
  availableSpeechVoices,
  chatPreferences,
  isRefreshingSpeechVoices,
  isRefreshingVoiceCapabilities,
  isTestingVoice,
  onEnableVoiceInput,
  onOpenVoiceSettings,
  onRefreshVoiceCapabilities,
  onTestVoicePlayback,
  palette,
  selectedResponseScope,
  selectedSpeechVoiceLabel,
  selectedWorkingSound,
  updateChatPreferences,
  voiceCapabilities,
}: VoiceSectionProps) {
  const { t } = useTranslation();
  const voicePermission = voiceCapabilities?.permission;
  const enabledLabel = t('common:labels.enabled');
  const offLabel = t('common:labels.off');
  const unavailableLabel = t('common:labels.unavailable');
  const permissionStatus = !voicePermission || voicePermission.available === false
    ? unavailableLabel
    : voicePermission.restricted
      ? t('settings:voice.check.restricted')
      : voicePermission.granted
        ? enabledLabel
        : offLabel;
  const responseScopeOptions: NativeSelectOption<ResponseScope>[] = RESPONSE_SCOPE_OPTIONS.map((option) => ({
    description: t(`settings:voice.responseScope.${option.value}.description`),
    label: t(`settings:voice.responseScope.${option.value}.label`),
    value: option.value,
  }));
  const workingSoundOptions: NativeSelectOption<WorkingSoundVariant>[] = WORKING_SOUND_OPTIONS.map((option) => ({
    description: t(`settings:voice.workingSoundVariant.${option.value}.description`),
    label: t(`settings:voice.workingSoundVariant.${option.value}.label`),
    value: option.value,
  }));
  const speechVoiceOptions: NativeSelectOption<string>[] = [
    {
      label: t('common:labels.systemDefault'),
      value: '__system__',
    },
    ...availableSpeechVoices.map((voice) => ({
      description: voice.language,
      label: voice.label,
      value: voice.id,
    })),
  ];

  return (
    <View style={styles.section}>
        <View style={[styles.voiceCheckCard, { backgroundColor: palette.surface, borderColor: palette.border }]}>
          <Text variant="titleSmall" style={{ color: palette.text }}>{t('settings:voice.check.title')}</Text>
          <VoiceCheckRow label={t('settings:voice.check.permission')} palette={palette} status={permissionStatus} />
          <VoiceCheckRow
            label={t('settings:voice.check.recognition')}
            palette={palette}
            status={voiceCapabilities ? (voiceCapabilities.recognitionAvailable ? enabledLabel : unavailableLabel) : t('common:labels.unknown')}
          />
          <VoiceCheckRow
            label={t('settings:voice.check.onDevice')}
            palette={palette}
            status={voiceCapabilities ? (voiceCapabilities.onDeviceSupported ? enabledLabel : offLabel) : t('common:labels.unknown')}
          />
          {voiceCapabilities && !voiceCapabilities.recognitionAvailable ? (
            <HelperText type="info">{t('settings:voice.check.unavailableHint')}</HelperText>
          ) : null}
          {voicePermission?.restricted ? (
            <HelperText type="info">{t('settings:voice.check.restrictedHint')}</HelperText>
          ) : null}
          {voicePermission && voicePermission.available && !voicePermission.granted && !voicePermission.canAskAgain ? (
            <HelperText type="info">{t('settings:voice.check.deniedHint')}</HelperText>
          ) : null}
          <View style={styles.actionRow}>
            {voicePermission && voicePermission.available && !voicePermission.granted && voicePermission.canAskAgain ? (
              <Button mode="contained-tonal" onPress={onEnableVoiceInput}>{t('settings:voice.check.enable')}</Button>
            ) : null}
            <Button loading={isRefreshingVoiceCapabilities} mode="outlined" onPress={onRefreshVoiceCapabilities}>{t('settings:voice.check.recheck')}</Button>
            <Button loading={isTestingVoice} mode="outlined" onPress={onTestVoicePlayback}>{t('settings:voice.check.test')}</Button>
            {voicePermission && voicePermission.available && !voicePermission.granted ? (
              <Button mode="text" onPress={onOpenVoiceSettings}>{t('common:actions.openSettings')}</Button>
            ) : null}
          </View>
        </View>
        <List.Section style={styles.infoListSection}>
          <SettingSwitchRow
            description={t('settings:voice.onDeviceInput.description')}
            onValueChange={(value) => updateChatPreferences({ preferOnDeviceRecognition: value })}
            palette={palette}
            title={t('settings:voice.onDeviceInput.title')}
            value={chatPreferences.preferOnDeviceRecognition}
          />
          <SettingSwitchRow
            description={t('settings:voice.autoPlay.description')}
            onValueChange={(value) => updateChatPreferences({ autoPlayAssistantReplies: value })}
            palette={palette}
            title={t('settings:voice.autoPlay.title')}
            value={chatPreferences.autoPlayAssistantReplies}
          />
          <SettingSwitchRow
            description={t('settings:voice.workingSound.description')}
            onValueChange={(value) => updateChatPreferences({ workingSoundEnabled: value })}
            palette={palette}
            title={t('settings:voice.workingSound.title')}
            value={chatPreferences.workingSoundEnabled}
          />
          <SettingSwitchRow
            description={t('settings:voice.resumeListening.description')}
            onValueChange={(value) => updateChatPreferences({ resumeListeningAfterReply: value })}
            palette={palette}
            title={t('settings:voice.resumeListening.title')}
            value={chatPreferences.resumeListeningAfterReply}
          />
        </List.Section>
        <TextInput mode="outlined" label={t('settings:voice.speechLocale.label')} placeholder="en-US" value={chatPreferences.speechLocale || ''} autoCapitalize="none" autoCorrect={false} onChangeText={(value) => updateChatPreferences({ speechLocale: value.trim() || undefined })} />
        <HelperText type="info">{t('settings:voice.speechLocale.helper')}</HelperText>
        <SettingSelectField label={t('settings:voice.responseScope.label')} onValueChange={(value) => updateChatPreferences({ responseScope: value })} options={responseScopeOptions} palette={palette} selectedValue={selectedResponseScope.value} valueLabel={t(`settings:voice.responseScope.${selectedResponseScope.value}.label`)} />
        <HelperText type="info">{t(`settings:voice.responseScope.${selectedResponseScope.value}.description`)}</HelperText>
        <SettingSwitchRow description={t('settings:voice.nextActions.description')} onValueChange={(value) => updateChatPreferences({ includeNextActions: value })} palette={palette} title={t('settings:voice.nextActions.title')} value={chatPreferences.includeNextActions} />
        <NumericSlider label={t('settings:voice.speechRate.label')} minimum={0.5} maximum={1.5} step={0.1} value={chatPreferences.speechRate} valueLabel={`${chatPreferences.speechRate.toFixed(1)}x`} onValueChange={(speechRate) => updateChatPreferences({ speechRate })} palette={palette} />
        <SettingSelectField label={t('settings:voice.workingSoundVariant.label')} onValueChange={(value) => updateChatPreferences({ workingSoundVariant: value })} options={workingSoundOptions} palette={palette} selectedValue={selectedWorkingSound.value} valueLabel={t(`settings:voice.workingSoundVariant.${selectedWorkingSound.value}.label`)} />
        <HelperText type="info">{t(`settings:voice.workingSoundVariant.${selectedWorkingSound.value}.description`)}</HelperText>
        <NumericSlider label={t('settings:voice.workingSoundVolume.label')} minimum={0} maximum={1} step={0.05} value={chatPreferences.workingSoundVolume} valueLabel={`${Math.round(chatPreferences.workingSoundVolume * 100)}%`} onValueChange={(workingSoundVolume) => updateChatPreferences({ workingSoundVolume })} palette={palette} />
        <SettingSelectField
          disabled={isRefreshingSpeechVoices}
          label={t('settings:voice.voiceSelect.label')}
          onValueChange={(value) => {
            if (value === '__system__') {
              updateChatPreferences({ speechVoiceId: undefined });
              return;
            }

            const voice = availableSpeechVoices.find((item) => item.id === value);
            if (!voice) {
              return;
            }

            updateChatPreferences({ speechVoiceId: voice.id, speechLocale: chatPreferences.speechLocale || voice.language });
          }}
          options={speechVoiceOptions}
          palette={palette}
          selectedValue={chatPreferences.speechVoiceId || '__system__'}
          valueLabel={selectedSpeechVoiceLabel}
        />
        <HelperText type="info">
          {t('settings:voice.footer')}
        </HelperText>
    </View>
  );
}

export function LanguageSection({
  chatPreferences,
  palette,
  updateChatPreferences,
}: {
  chatPreferences: ChatPreferences;
  palette: Palette;
  updateChatPreferences: (patch: Partial<ChatPreferences>) => void;
}) {
  const { t } = useTranslation();
  const languageOptions: NativeSelectOption<string>[] = [
    { label: t('common:labels.systemDefault'), value: 'system' },
    ...LANGUAGE_OPTIONS.map((option) => ({ label: option.label, value: option.value })),
  ];
  const selectedValue = chatPreferences.language ?? 'system';
  const valueLabel = languageOptions.find((option) => option.value === selectedValue)?.label
    || t('common:labels.systemDefault');

  return (
    <View style={styles.section}>
      <SettingSelectField
        label={t('settings:language.title')}
        onValueChange={(value) => updateChatPreferences({ language: value === 'system' ? undefined : value })}
        options={languageOptions}
        palette={palette}
        selectedValue={selectedValue}
        valueLabel={valueLabel}
      />
      <HelperText type="info">{t('settings:language.description')}</HelperText>
    </View>
  );
}

export function AppearanceSection({
  chatPreferences,
  palette,
  scheme,
  updateChatPreferences,
}: {
  chatPreferences: ChatPreferences;
  palette: Palette;
  scheme: 'light' | 'dark';
  updateChatPreferences: (patch: Partial<ChatPreferences>) => void;
}) {
  const { t } = useTranslation();
  const fontSize = normalizeTranscriptFontSize(chatPreferences.transcriptFontSize);
  const accentPreview = (mode: AccentMode) => mode === 'system' ? palette.tint : getAccentPreviewColor(mode, scheme);
  const accentOptions: NativeSelectOption<AccentMode>[] = ACCENT_MODES.map((mode) => ({
    value: mode,
    label: t(`settings:appearance.accent.options.${mode}.label`),
    description: t(`settings:appearance.accent.options.${mode}.description`),
    leadingIcon: ({ size }) => (
      <View style={[styles.accentSwatch, { width: size, height: size, backgroundColor: accentPreview(mode) }]} />
    ),
  }));
  const selectedAccent = accentOptions.find((option) => option.value === chatPreferences.accent) ?? accentOptions[0];

  return (
    <View style={styles.section}>
      <NumericSlider
        label={t('settings:appearance.chatTextSize')}
        minimum={TRANSCRIPT_FONT_SIZE_MIN}
        maximum={TRANSCRIPT_FONT_SIZE_MAX}
        step={1}
        value={fontSize}
        valueLabel={`${fontSize} px`}
        onValueChange={(transcriptFontSize) => updateChatPreferences({ transcriptFontSize })}
        palette={palette}
      />
      <HelperText type="info">{t('settings:appearance.chatTextSizeDescription')}</HelperText>
      <SettingSelectField
        label={t('settings:appearance.accent.label')}
        leadingColor={accentPreview(chatPreferences.accent)}
        onValueChange={(accent) => updateChatPreferences({ accent })}
        options={accentOptions}
        palette={palette}
        selectedValue={chatPreferences.accent}
        valueLabel={selectedAccent.label}
      />
      <HelperText type="info">{t('settings:appearance.accent.description')}</HelperText>
      <SettingSwitchRow
        title={t('settings:appearance.flatThread.title')}
        description={t('settings:appearance.flatThread.description')}
        onValueChange={(flatTranscript) => updateChatPreferences({ flatTranscript })}
        palette={palette}
        value={chatPreferences.flatTranscript === true}
      />
      <SettingSwitchRow
        title={t('settings:appearance.slimInterface.title')}
        description={t('settings:appearance.slimInterface.description')}
        onValueChange={(slimInterface) => updateChatPreferences({ slimInterface })}
        palette={palette}
        value={chatPreferences.slimInterface === true}
      />
    </View>
  );
}

export function SettingSwitchRow({
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
      accessible={false}
      title={title}
      description={description}
      titleStyle={{ color: palette.text }}
      descriptionStyle={{ color: palette.muted }}
      right={() => (
        <NativeSwitch
          accessibilityLabel={title}
          accessibilityHint={description}
          ios_backgroundColor={palette.border}
          onValueChange={onValueChange}
          thumbColor={Platform.OS === 'android' ? (value ? palette.tint : '#f4f3f4') : undefined}
          trackColor={{ false: palette.border, true: `${palette.tint}66` }}
          value={value}
        />
      )}
    />
  );
}

export function SettingSelectField<T extends string>({
  disabled = false,
  label,
  leadingColor,
  onValueChange,
  options,
  palette,
  selectedValue,
  valueLabel,
}: {
  disabled?: boolean;
  label: string;
  leadingColor?: string;
  onValueChange: (value: T) => void;
  options: NativeSelectOption<T>[];
  palette: Palette;
  selectedValue?: T;
  valueLabel: string;
}) {
  return (
    <NativeSelect
      disabled={disabled}
      onValueChange={onValueChange}
      options={options}
      selectedValue={selectedValue}
      title={label}
      renderTrigger={({ disabled: triggerDisabled, open, openState }) => (
        <Pressable
          accessibilityRole="button"
          disabled={triggerDisabled}
          onPress={open}
          style={({ pressed }) => [
            styles.settingSelectField,
            {
              backgroundColor: palette.background,
              borderColor: openState ? palette.tint : palette.border,
              opacity: triggerDisabled ? 0.45 : pressed ? 0.82 : 1,
            },
          ]}>
          <View style={styles.settingSelectFieldContent}>
            <View style={styles.settingSelectTextWrap}>
              <NativeText style={[styles.settingSelectLabel, { color: palette.muted }]}>{label}</NativeText>
              <View style={styles.settingSelectValueRow}>
                {leadingColor ? <View style={[styles.settingSelectSwatch, { backgroundColor: leadingColor }]} /> : null}
                <NativeText numberOfLines={1} style={[styles.settingSelectValue, { color: palette.text }]}>
                  {valueLabel}
                </NativeText>
              </View>
            </View>
            <NativeText style={[styles.settingSelectChevron, { color: palette.muted }]}>v</NativeText>
          </View>
        </Pressable>
      )}
    />
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 16 },
  section: { gap: 14, paddingBottom: 8 },
  voiceCheckCard: { borderRadius: 16, borderWidth: 1, gap: 8, padding: 14 },
  voiceCheckRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  title: { fontWeight: '600' },
  connectionStatusCard: { borderRadius: 14, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 12 },
  connectionStatusHeader: { gap: 6 },
  connectionStatusRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  connectionStatusDot: { width: 10, height: 10, borderRadius: 999 },
  providerHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  inlineSelectButton: { minHeight: 36, borderWidth: 1, borderRadius: 999, justifyContent: 'center', paddingHorizontal: 12 },
  inlineSelectButtonLabel: { fontFamily: Fonts.sans, fontSize: 14, fontWeight: '600' },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  infoListSection: { marginVertical: 0 },
  settingSelectField: { borderRadius: 14, borderWidth: 1 },
  settingSelectFieldContent: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, minHeight: 54, paddingHorizontal: 14, paddingVertical: 10 },
  settingSelectTextWrap: { flex: 1, gap: 2 },
  settingSelectValueRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  settingSelectSwatch: { width: 16, height: 16, borderRadius: 999, borderWidth: 1, borderColor: 'rgba(127,127,127,0.4)' },
  accentSwatch: { borderRadius: 999 },
  settingSelectLabel: { fontFamily: Fonts.sans, fontSize: 12, fontWeight: '500' },
  settingSelectValue: { fontFamily: Fonts.sans, fontSize: 16, fontWeight: '600' },
  settingSelectChevron: { fontFamily: Fonts.mono, fontSize: 16, fontWeight: '700' },
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
