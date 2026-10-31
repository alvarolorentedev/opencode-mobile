import { cn } from '@/lib/utils';
import { SettingField } from '@/components/settings/sections/setting-rows';
import { FieldDescription } from '@/components/ui/text-field';
import { Text } from '@/components/ui/text';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';


import { WORKING_SOUND_OPTIONS } from '../settings-utils';
import { SettingTarget, SettingsDisclosure } from '../settings-panel';
import { DEFAULT_WAKE_PHRASE, normalizeWakePhrase } from '@/lib/voice/wake-phrase';
import { SettingSlider, SettingSwitchRow, SettingSelectField, type Palette } from './setting-rows';
import type { VoiceSectionProps } from './voice-section';

export function VoiceMoreSettings({ localInput, chatPreferences: prefs, isTestingVoice, onEnableVoiceInput, onOpenVoiceSettings, onTestVoicePlayback, palette, updateChatPreferences, voiceCapabilities }: VoiceSectionProps & { localInput: boolean }) {
  const { t } = useTranslation();
  const permission = voiceCapabilities?.permission;
  return <SettingsDisclosure id="voice-more" title={t('settings:voice.setup.more')}>
    {!localInput ? <>
      <SettingSwitchRow title={t('settings:voice.onDeviceInput.title')} description={t('settings:voice.onDeviceInput.description')} palette={palette} value={prefs.preferOnDeviceRecognition} onValueChange={(value) => updateChatPreferences({ preferOnDeviceRecognition: value })} />
      {prefs.wakePhraseRequired ? <>
        <SettingField label={t('settings:voice.wakePhrase.label')} autoCapitalize="none" autoCorrect={false} placeholder={DEFAULT_WAKE_PHRASE} value={prefs.conversationWakePhrase} onBlur={() => updateChatPreferences({ conversationWakePhrase: normalizeWakePhrase(prefs.conversationWakePhrase) })} onChangeText={(conversationWakePhrase) => updateChatPreferences({ conversationWakePhrase })}></SettingField>
        <FieldDescription  invalid={false}>{t('settings:voice.wakePhrase.helper')}</FieldDescription>
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
      <Text className={cn("text-foreground")} variant="description">{t('settings:voice.check.title')}</Text>
      <Check label={t('settings:voice.check.permission')} value={t(permission?.granted ? 'settings:voice.check.allowed' : permission?.restricted ? 'settings:voice.check.restricted' : 'common:labels.off')} palette={palette} />
      <Check label={t('settings:voice.check.recognition')} value={t(voiceCapabilities?.recognitionAvailable ? 'settings:voice.check.available' : 'common:labels.unavailable')} palette={palette} />
      <Check label={t('settings:voice.check.onDevice')} value={t(voiceCapabilities?.onDeviceSupported ? 'settings:voice.check.available' : 'common:labels.unavailable')} palette={palette} />
      {!permission?.granted ? <>
        <FieldDescription  invalid={false}>{t(permission?.restricted ? 'settings:voice.check.restrictedHint' : 'settings:voice.check.deniedHint')}</FieldDescription>
        <Button onPress={permission?.canAskAgain ? onEnableVoiceInput : onOpenVoiceSettings} variant={"outline"}><Text>{t(permission?.canAskAgain ? 'settings:voice.check.enable' : 'common:actions.openSettings')}</Text></Button>
      </> : null}
      <Button onPress={onTestVoicePlayback} variant={"outline"}>{isTestingVoice ? <Spinner size="small" /> : null}<Text>{t('settings:voice.check.test')}</Text></Button>
    </SettingTarget> : null}
    <Text className={cn("text-muted-foreground")} variant="label">{t('settings:voice.footer')}</Text>
  </SettingsDisclosure>;
}
function Check({ label, value, palette }: { label: string; value: string; palette: Palette }) {
  return <View className={cn("flex-row justify-between gap-3")}><Text className={cn("text-foreground flex-1")}>{label}</Text><Text className={cn("text-muted-foreground")}>{value}</Text></View>;
}
