import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { Button, HelperText, List, Text } from 'react-native-paper';

import { type NativeSelectOption } from '@/components/ui/native-select';
import { NumericSlider } from '@/components/ui/numeric-slider';
import { TextInput } from '@/components/ui/text-input';
import type { VoiceCapabilities } from '@/lib/voice/capabilities';
import type { SpeechVoiceOption } from '@/lib/voice/speech-output';
import { DEFAULT_WAKE_PHRASE, normalizeWakePhrase } from '@/lib/voice/wake-phrase';
import type { WorkingSoundVariant } from '@/lib/voice/working-sound';
import type { ChatPreferences, ResponseScope } from '@/providers/opencode-provider';
import { RESPONSE_SCOPE_OPTIONS, WORKING_SOUND_OPTIONS } from '@/components/settings/settings-utils';
import { SettingSelectField, SettingSwitchRow, type Palette } from './setting-rows';

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
        <TextInput
          autoCapitalize="none"
          autoCorrect={false}
          label={t('settings:voice.wakePhrase.label')}
          mode="outlined"
          placeholder={DEFAULT_WAKE_PHRASE}
          value={chatPreferences.conversationWakePhrase}
          onBlur={() => updateChatPreferences({ conversationWakePhrase: normalizeWakePhrase(chatPreferences.conversationWakePhrase) })}
          onChangeText={(conversationWakePhrase) => updateChatPreferences({ conversationWakePhrase })}
        />
        <HelperText type="info">{t('settings:voice.wakePhrase.helper')}</HelperText>
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

const styles = StyleSheet.create({
  section: { gap: 14, paddingBottom: 8 },
  voiceCheckCard: { borderRadius: 16, borderWidth: 1, gap: 8, padding: 14 },
  voiceCheckRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  infoListSection: { marginVertical: 0 },
});
