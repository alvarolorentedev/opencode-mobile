import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, StyleSheet, View } from 'react-native';
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
import { LocalTtsSection } from './local-tts-section';
import { SettingSelectField, SettingSwitchRow, type Palette } from './setting-rows';
import type { useTtsSetup } from '@/components/settings/use-tts-setup';

type VoiceSectionProps = {
  onboarding?: boolean;
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
  ttsSetup: ReturnType<typeof useTtsSetup>;
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
  onboarding = false,
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
  ttsSetup,
  updateChatPreferences,
  voiceCapabilities,
}: VoiceSectionProps) {
  const { t } = useTranslation();
  const [showLocalTtsSetup, setShowLocalTtsSetup] = useState(false);
  const voicePermission = voiceCapabilities?.permission;
  const offLabel = t('common:labels.off');
  const unavailableLabel = t('common:labels.unavailable');
  const localMode = chatPreferences.voiceWakeMode === 'local';
  const localPlayback = chatPreferences.ttsEngine === 'local';
  const activeTtsStatus = ttsSetup.activePack ? ttsSetup.statuses[ttsSetup.activePack.id] : undefined;
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
      label: t('settings:voice.voiceSelect.automatic'),
      value: '__system__',
    },
    ...availableSpeechVoices.map((voice) => ({
      description: voice.quality === 'enhanced'
        ? t('settings:voice.voiceSelect.enhanced', { language: voice.language })
        : voice.language,
      label: voice.label,
      value: voice.id,
    })),
  ];

  return (
    <View style={styles.section}>
      <View style={styles.modeBlock}>
        <Text variant={onboarding ? 'titleMedium' : 'titleSmall'} style={{ color: palette.text }}>{t(onboarding ? 'onboarding:voice.input' : 'settings:voice.mode.label')}</Text>
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
      ) : onboarding ? null : (
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

      {onboarding && !localMode && voiceCapabilities && !voiceCapabilities.recognitionAvailable && voicePermission?.granted ? (
        <HelperText type="info">{t('onboarding:permissions.voice.unsupported')}</HelperText>
      ) : null}
      {onboarding && voiceCapabilities && !voicePermission?.granted ? (
        voicePermission?.available ? (
          <Button mode="outlined" onPress={voicePermission.canAskAgain ? onEnableVoiceInput : onOpenVoiceSettings}>
            {t(voicePermission.canAskAgain ? 'settings:voice.check.enable' : 'common:actions.openSettings')}
          </Button>
        ) : <HelperText type="info">{t('onboarding:permissions.voice.unsupported')}</HelperText>
      ) : null}

      {onboarding ? <View style={[styles.divider, { backgroundColor: palette.border }]} /> : null}
      {onboarding ? <Text variant="titleMedium" style={{ color: palette.text }}>{t('onboarding:voice.playback')}</Text> : null}
      {Platform.OS === 'web' ? null : (
        <>
          <View style={styles.modeBlock}>
            {onboarding ? null : <Text variant="titleSmall" style={{ color: palette.text }}>{t('settings:voice.playbackEngine.label')}</Text>}
            <SegmentedButtons
              onValueChange={(value) => {
                setShowLocalTtsSetup(value === 'local');
                if (onboarding && value === 'local' && activeTtsStatus !== 'ready') return;
                void ttsSetup.setEngine(value === 'local' ? 'local' : 'system');
              }}
              buttons={[
                { icon: 'cellphone', label: t('settings:voice.mode.system'), value: 'system' },
                { icon: 'chip', label: t('settings:voice.mode.local'), value: 'local' },
              ]}
              value={localPlayback ? 'local' : 'system'}
            />
            <HelperText type="info">
              {localPlayback
                ? t('settings:voice.playbackEngine.localDescription')
                : t('settings:voice.playbackEngine.systemDescription')}
            </HelperText>
          </View>

          {!onboarding || localPlayback || showLocalTtsSetup ? (
            <>
              {onboarding && !localPlayback ? <HelperText type="info">{t('settings:voice.localTts.installFirst')}</HelperText> : null}
              <LocalTtsSection chatPreferences={chatPreferences} palette={palette} ttsSetup={ttsSetup} />
            </>
          ) : null}
        </>
      )}

      {onboarding ? null : <>
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
      </>}

      <View style={styles.group}>
        {onboarding ? null : <>
          <Text variant="titleSmall" style={{ color: palette.text }}>{t('settings:voice.playback.title')}</Text>
          <HelperText type="info">{t('settings:voice.playback.helper')}</HelperText>
        </>}
        {onboarding ? null : <>
          <SettingSwitchRow
            description={t('settings:voice.autoPlay.description')}
            onValueChange={(value) => updateChatPreferences({ autoPlayAssistantReplies: value })}
            palette={palette}
            title={t('settings:voice.autoPlay.title')}
            value={chatPreferences.autoPlayAssistantReplies}
          />
          <SettingSwitchRow
            description={t('settings:voice.readInterim.description')}
            onValueChange={(value) => updateChatPreferences({ readInterimAssistantReplies: value })}
            palette={palette}
            title={t('settings:voice.readInterim.title')}
            value={chatPreferences.readInterimAssistantReplies}
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
        </>}
        {!onboarding || !localPlayback ? <>
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
            selectedValue={availableSpeechVoices.some((voice) => voice.id === chatPreferences.speechVoiceId) ? chatPreferences.speechVoiceId : '__system__'}
            valueLabel={selectedSpeechVoiceLabel}
          />
          {onboarding ? null : <HelperText type="info">{t('settings:voice.enhancedVoices')}</HelperText>}
        </> : null}
        {onboarding ? <>
          <Button style={{ alignSelf: 'flex-start' }} icon="play" mode="outlined" loading={isTestingVoice} onPress={onTestVoicePlayback}>
            {t('settings:voice.localTts.preview')}
          </Button>
          {ttsSetup.error && !showLocalTtsSetup && !localPlayback ? <HelperText type="error">{ttsSetup.error}</HelperText> : null}
          <SettingSwitchRow
            description=""
            onValueChange={(autoPlayAssistantReplies) => updateChatPreferences({ autoPlayAssistantReplies })}
            palette={palette}
            title={t('onboarding:voice.autoPlay')}
            value={chatPreferences.autoPlayAssistantReplies}
          />
        </> : null}
        {onboarding ? null : <>
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
        </>}
      </View>

      {onboarding ? null : <>
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
              {Platform.OS === 'web' ? null : (
                <>
                  <VoiceCheckRow
                    label={t('settings:voice.playbackEngine.label')}
                    palette={palette}
                    status={localPlayback ? t('settings:voice.mode.local') : t('settings:voice.mode.system')}
                  />
                  <VoiceCheckRow
                    label={t('settings:voice.localTts.title')}
                    palette={palette}
                    status={ttsSetup.activePack
                      ? (activeTtsStatus === 'ready'
                        ? ttsSetup.activePack.languageLabel
                        : activeTtsStatus === 'unsupported'
                          ? unavailableLabel
                          : t('settings:voice.localTts.notInstalled'))
                      : t('settings:voice.localTts.notInstalled')}
                  />
                </>
              )}
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
      </>}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: 14, paddingBottom: 8 },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: 4 },
  modeBlock: { gap: 8 },
  statusCard: { alignItems: 'center', borderRadius: 16, borderWidth: 1, flexDirection: 'row', gap: 12, padding: 14 },
  localVoiceStatusText: { flex: 1, gap: 2 },
  actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  group: { gap: 10 },
  voiceCheckCard: { borderRadius: 16, borderWidth: 1, overflow: 'hidden' },
  voiceCheckBody: { gap: 8, paddingBottom: 12, paddingHorizontal: 14 },
  voiceCheckRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
});
