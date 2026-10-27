import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { Button, HelperText, List, SegmentedButtons, Text } from 'react-native-paper';

import { type NativeSelectOption } from '@/components/ui/native-select';
import { NumericSlider } from '@/components/ui/numeric-slider';
import { TextInput } from '@/components/ui/text-input';
import type { VoiceCapabilities } from '@/lib/voice/capabilities';
import type { SpeechVoiceOption } from '@/lib/voice/speech-output';
import { DEFAULT_WAKE_PHRASE, normalizeWakePhrase } from '@/lib/voice/wake-phrase';
import type { WorkingSoundVariant } from '@/lib/voice/working-sound';
import type { ChatPreferences } from '@/providers/opencode-provider';
import { WORKING_SOUND_OPTIONS } from '@/components/settings/settings-utils';
import { LocalVoiceSection, type LocalVoiceState } from './local-voice-section';
import { SettingSelectField, SettingSwitchRow, type Palette } from './setting-rows';

type VoiceSectionProps = {
  availableSpeechVoices: SpeechVoiceOption[];
  chatPreferences: ChatPreferences;
  isRefreshingSpeechVoices: boolean;
  isRefreshingVoiceCapabilities: boolean;
  isTestingVoice: boolean;
  localVoice: LocalVoiceState;
  onEnableVoiceInput: () => void;
  onOpenVoiceSettings: () => void;
  onRefreshVoiceCapabilities: () => void;
  onTestVoicePlayback: () => void;
  palette: Palette;
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
  localVoice,
  onEnableVoiceInput,
  onOpenVoiceSettings,
  onRefreshVoiceCapabilities,
  onTestVoicePlayback,
  palette,
  selectedSpeechVoiceLabel,
  selectedWorkingSound,
  updateChatPreferences,
  voiceCapabilities,
}: VoiceSectionProps) {
  const { t } = useTranslation();
  const voicePermission = voiceCapabilities?.permission;
  const offLabel = t('common:labels.off');
  const unavailableLabel = t('common:labels.unavailable');
  const localMode = chatPreferences.voiceWakeMode === 'local';
  const systemReady = Boolean(
    voiceCapabilities?.recognitionAvailable && voicePermission?.granted,
  );
  const permissionStatus = !voicePermission || voicePermission.available === false
    ? unavailableLabel
    : voicePermission.restricted
      ? t('settings:voice.check.restricted')
      : voicePermission.granted
        ? t('settings:voice.check.allowed')
        : offLabel;
  const systemStatusLabel = !voiceCapabilities
    ? t('common:labels.unknown')
    : !voiceCapabilities.recognitionAvailable
      ? unavailableLabel
      : voicePermission?.granted
        ? t('common:labels.active')
        : permissionStatus;
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
      <View style={styles.modeBlock}>
        <Text variant="titleSmall" style={{ color: palette.text }}>{t('settings:voice.mode.label')}</Text>
        <SegmentedButtons
          onValueChange={(value) => {
            localVoice.clearError();
            updateChatPreferences({ voiceWakeMode: value === 'local' ? 'local' : 'phrase' });
            localVoice.refresh();
          }}
          buttons={[
            { icon: 'cellphone', label: t('settings:voice.mode.system'), value: 'system' },
            { icon: 'chip', label: t('settings:voice.mode.local'), value: 'local' },
          ]}
          value={localMode ? 'local' : 'system'}
        />
        <HelperText type="info">
          {localMode
            ? t('settings:voice.mode.localDescription')
            : t('settings:voice.mode.systemDescription')}
        </HelperText>
      </View>

      {localMode ? (
        <LocalVoiceSection
          chatPreferences={chatPreferences}
          localVoice={localVoice}
          palette={palette}
          updateChatPreferences={updateChatPreferences}
        />
      ) : (
        <>
          <View style={[styles.statusCard, { backgroundColor: palette.surface, borderColor: palette.border }]}>
            <MaterialCommunityIcons
              color={systemReady ? palette.success : palette.muted}
              name={systemReady ? 'check-circle' : 'alert-circle-outline'}
              size={22}
            />
            <View style={styles.localVoiceStatusText}>
              <Text variant="titleSmall" style={{ color: palette.text }}>{t('settings:voice.mode.system')}</Text>
              <Text variant="bodySmall" style={{ color: palette.muted }}>
                {t('settings:voice.wakePhrase.label')}
                {': '}
                {chatPreferences.conversationWakePhrase || DEFAULT_WAKE_PHRASE}
              </Text>
            </View>
            <Text variant="labelMedium" style={{ color: systemReady ? palette.success : palette.muted }}>
              {systemStatusLabel}
            </Text>
          </View>
          <View style={styles.group}>
            <SettingSwitchRow
              description={t('settings:voice.onDeviceInput.description')}
              onValueChange={(value) => updateChatPreferences({ preferOnDeviceRecognition: value })}
              palette={palette}
              title={t('settings:voice.onDeviceInput.title')}
              value={chatPreferences.preferOnDeviceRecognition}
            />
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
          </View>
        </>
      )}

      <TextInput
        autoCapitalize="none"
        autoCorrect={false}
        label={t('settings:voice.speechLocale.label')}
        mode="outlined"
        placeholder="en-US"
        value={chatPreferences.speechLocale || ''}
        onChangeText={(value) => updateChatPreferences({ speechLocale: value.trim() || undefined })}
      />
      <HelperText type="info">{t('settings:voice.speechLocale.helper')}</HelperText>

      <View style={styles.group}>
        <Text variant="titleSmall" style={{ color: palette.text }}>{t('settings:voice.playback.title')}</Text>
        <HelperText type="info">{t('settings:voice.playback.helper')}</HelperText>
        <SettingSwitchRow
          description={t('settings:voice.autoPlay.description')}
          onValueChange={(value) => updateChatPreferences({ autoPlayAssistantReplies: value })}
          palette={palette}
          title={t('settings:voice.autoPlay.title')}
          value={chatPreferences.autoPlayAssistantReplies}
        />
        <SettingSwitchRow
          description={t('settings:voice.resumeListening.description')}
          onValueChange={(value) => updateChatPreferences({ resumeListeningAfterReply: value })}
          palette={palette}
          title={t('settings:voice.resumeListening.title')}
          value={chatPreferences.resumeListeningAfterReply}
        />
        <NumericSlider
          label={t('settings:voice.speechRate.label')}
          minimum={0.5}
          maximum={1.5}
          step={0.1}
          value={chatPreferences.speechRate}
          valueLabel={`${chatPreferences.speechRate.toFixed(1)}x`}
          onValueChange={(speechRate) => updateChatPreferences({ speechRate })}
          palette={palette}
        />
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
        <SettingSwitchRow
          description={t('settings:voice.workingSound.description')}
          onValueChange={(value) => updateChatPreferences({ workingSoundEnabled: value })}
          palette={palette}
          title={t('settings:voice.workingSound.title')}
          value={chatPreferences.workingSoundEnabled}
        />
        {chatPreferences.workingSoundEnabled ? (
          <>
            <SettingSelectField
              label={t('settings:voice.workingSoundVariant.label')}
              onValueChange={(value) => updateChatPreferences({ workingSoundVariant: value })}
              options={workingSoundOptions}
              palette={palette}
              selectedValue={selectedWorkingSound.value}
              valueLabel={t(`settings:voice.workingSoundVariant.${selectedWorkingSound.value}.label`)}
            />
            <HelperText type="info">{t(`settings:voice.workingSoundVariant.${selectedWorkingSound.value}.description`)}</HelperText>
            <NumericSlider
              label={t('settings:voice.workingSoundVolume.label')}
              minimum={0}
              maximum={1}
              step={0.05}
              value={chatPreferences.workingSoundVolume}
              valueLabel={`${Math.round(chatPreferences.workingSoundVolume * 100)}%`}
              onValueChange={(workingSoundVolume) => updateChatPreferences({ workingSoundVolume })}
              palette={palette}
            />
          </>
        ) : null}
      </View>

      <View style={[styles.voiceCheckCard, { backgroundColor: palette.surface, borderColor: palette.border }]}>
        <List.Accordion id="voice-check" title={t('settings:voice.check.title')}>
          <View style={styles.voiceCheckBody}>
            <VoiceCheckRow label={t('settings:voice.check.permission')} palette={palette} status={permissionStatus} />
            <VoiceCheckRow
              label={t('settings:voice.check.recognition')}
              palette={palette}
              status={voiceCapabilities ? (voiceCapabilities.recognitionAvailable ? t('settings:voice.check.available') : unavailableLabel) : t('common:labels.unknown')}
            />
            <VoiceCheckRow
              label={t('settings:voice.check.onDevice')}
              palette={palette}
              status={voiceCapabilities ? (voiceCapabilities.onDeviceSupported ? t('settings:voice.check.available') : offLabel) : t('common:labels.unknown')}
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
        </List.Accordion>
      </View>

      <HelperText type="info">{t('settings:voice.footer')}</HelperText>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: 14, paddingBottom: 8 },
  modeBlock: { gap: 8 },
  statusCard: { alignItems: 'center', borderRadius: 16, borderWidth: 1, flexDirection: 'row', gap: 12, padding: 14 },
  localVoiceStatusText: { flex: 1, gap: 2 },
  actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  group: { gap: 10 },
  voiceCheckCard: { borderRadius: 16, borderWidth: 1, overflow: 'hidden' },
  voiceCheckBody: { gap: 8, paddingBottom: 12, paddingHorizontal: 14 },
  voiceCheckRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
});
