import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { HelperText, Text } from 'react-native-paper';

import { WORKING_SOUND_OPTIONS } from '../settings-utils';
import { SettingTarget, SettingsDisclosure } from '../settings-panel';
import { DEFAULT_WAKE_PHRASE, normalizeWakePhrase } from '@/lib/voice/wake-phrase';
import { SettingButton as Button, SettingSlider, SettingSwitchRow, SettingSelectField, SettingTextInput, type Palette } from './setting-rows';
import type { VoiceSectionProps } from './voice-section';

export function VoiceMoreSettings({ localInput, chatPreferences: prefs, isTestingVoice, onEnableVoiceInput, onOpenVoiceSettings, onTestVoicePlayback, palette, updateChatPreferences, voiceCapabilities }: VoiceSectionProps & { localInput: boolean }) {
  const { t } = useTranslation();
  const permission = voiceCapabilities?.permission;
  return <SettingsDisclosure id="voice-more" title={t('settings:voice.setup.more')}>
    {!localInput ? <>
      <SettingSwitchRow title={t('settings:voice.onDeviceInput.title')} description={t('settings:voice.onDeviceInput.description')} palette={palette} value={prefs.preferOnDeviceRecognition} onValueChange={(value) => updateChatPreferences({ preferOnDeviceRecognition: value })} />
      {prefs.wakePhraseRequired ? <>
        <SettingTextInput label={t('settings:voice.wakePhrase.label')} mode="outlined" autoCapitalize="none" autoCorrect={false} placeholder={DEFAULT_WAKE_PHRASE} value={prefs.conversationWakePhrase}
          onBlur={() => updateChatPreferences({ conversationWakePhrase: normalizeWakePhrase(prefs.conversationWakePhrase) })} onChangeText={(conversationWakePhrase) => updateChatPreferences({ conversationWakePhrase })} />
        <HelperText type="info">{t('settings:voice.wakePhrase.helper')}</HelperText>
      </> : null}
    </> : null}
    <SettingSwitchRow title={t('settings:voice.readInterim.title')} description={t('settings:voice.readInterim.description')} palette={palette} value={prefs.readInterimAssistantReplies} onValueChange={(value) => updateChatPreferences({ readInterimAssistantReplies: value })} />
    <SettingSlider label={t('settings:voice.speechRate.label')} minimum={0.5} maximum={1.5} step={0.1} value={prefs.speechRate} valueLabel={`${prefs.speechRate.toFixed(1)}x`} palette={palette} onValueChange={(speechRate) => updateChatPreferences({ speechRate })} />
    <SettingSwitchRow title={t('settings:voice.workingSound.title')} description={t('settings:voice.workingSound.description')} palette={palette} value={prefs.workingSoundEnabled} onValueChange={(value) => updateChatPreferences({ workingSoundEnabled: value })} />
    {prefs.workingSoundEnabled ? <>
      <SettingSelectField compact label={t('settings:voice.workingSoundVariant.label')} palette={palette} selectedValue={prefs.workingSoundVariant} valueLabel={t(`settings:voice.workingSoundVariant.${prefs.workingSoundVariant}.label`)}
        options={WORKING_SOUND_OPTIONS.map((option) => ({ value: option.value, label: t(`settings:voice.workingSoundVariant.${option.value}.label`) }))} onValueChange={(workingSoundVariant) => updateChatPreferences({ workingSoundVariant })} />
      <SettingSlider label={t('settings:voice.workingSoundVolume.label')} minimum={0} maximum={1} step={0.05} value={prefs.workingSoundVolume} valueLabel={`${Math.round(prefs.workingSoundVolume * 100)}%`} palette={palette} onValueChange={(workingSoundVolume) => updateChatPreferences({ workingSoundVolume })} />
    </> : null}
    {!localInput ? <SettingTarget label={t('settings:voice.check.title')}>
      <Text variant="titleSmall" style={{ color: palette.text }}>{t('settings:voice.check.title')}</Text>
      <Check label={t('settings:voice.check.permission')} value={t(permission?.granted ? 'settings:voice.check.allowed' : permission?.restricted ? 'settings:voice.check.restricted' : 'common:labels.off')} palette={palette} />
      <Check label={t('settings:voice.check.recognition')} value={t(voiceCapabilities?.recognitionAvailable ? 'settings:voice.check.available' : 'common:labels.unavailable')} palette={palette} />
      <Check label={t('settings:voice.check.onDevice')} value={t(voiceCapabilities?.onDeviceSupported ? 'settings:voice.check.available' : 'common:labels.unavailable')} palette={palette} />
      {!permission?.granted ? <>
        <HelperText type="info">{t(permission?.restricted ? 'settings:voice.check.restrictedHint' : 'settings:voice.check.deniedHint')}</HelperText>
        <Button mode="outlined" onPress={permission?.canAskAgain ? onEnableVoiceInput : onOpenVoiceSettings}>{t(permission?.canAskAgain ? 'settings:voice.check.enable' : 'common:actions.openSettings')}</Button>
      </> : null}
      <Button loading={isTestingVoice} mode="outlined" onPress={onTestVoicePlayback}>{t('settings:voice.check.test')}</Button>
    </SettingTarget> : null}
    <Text variant="bodySmall" style={{ color: palette.muted }}>{t('settings:voice.footer')}</Text>
  </SettingsDisclosure>;
}
function Check({ label, value, palette }: { label: string; value: string; palette: Palette }) {
  return <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}><Text style={{ color: palette.text, flex: 1 }}>{label}</Text><Text style={{ color: palette.muted }}>{value}</Text></View>;
}
