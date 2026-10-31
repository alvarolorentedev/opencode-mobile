import { cn } from '@/lib/utils';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Text } from '@/components/ui/text';
import { FieldDescription } from '@/components/ui/text-field';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Spinner } from '@/components/ui/spinner';
import { useEffect, useState } from 'react';
import { useIsFocused } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Platform, StyleSheet, View } from 'react-native';


import type { VoiceCapabilities } from '@/lib/voice/capabilities';
import type { SpeechVoiceOption } from '@/lib/voice/speech-output';
import { stopSpeaking } from '@/lib/voice/speech-output';
import type { WorkingSoundVariant } from '@/lib/voice/working-sound';
import type { ChatPreferences } from '@/providers/opencode-provider';
import { useVoiceTest } from '@/providers/use-voice-setup-test';
import type { LocalTtsPackId } from '@/lib/voice/tts/types';
import { isPackLanguageCompatible } from '@/lib/voice/tts/catalog';
import type { useTtsSetup } from '../use-tts-setup';
import { SettingTarget, useSettingsTarget } from '../settings-panel';
import { VoiceInputSetup } from '../voice-input-setup';
import { VoiceFlowScreen } from '../voice-flow-screen';
import { voiceLanguageOptions } from '../voice-language';
import type { LocalVoiceState } from '../use-voice-setup';
import { LocalTtsSection } from './local-tts-section';
import { VoiceMoreSettings } from './voice-more-settings';
import { SettingSelectField, SettingSwitchRow, type Palette } from './setting-rows';
export type VoiceSectionProps = {
  onboarding?: boolean;
  availableSpeechVoices: SpeechVoiceOption[];
  chatPreferences: ChatPreferences;
  isRefreshingSpeechVoices: boolean;
  isTestingVoice: boolean;
  localVoice: LocalVoiceState;
  onEnableVoiceInput: () => void;
  onOpenVoiceSettings: () => void;
  onTestVoicePlayback: () => void;
  palette: Palette;
  selectedSpeechVoiceLabel: string;
  selectedWorkingSound: { value: WorkingSoundVariant };
  ttsSetup: ReturnType<typeof useTtsSetup>;
  updateChatPreferences: (patch: Partial<ChatPreferences>) => void;
  voiceCapabilities?: VoiceCapabilities;
};

export function VoiceSection(props: VoiceSectionProps) {
  const { availableSpeechVoices, chatPreferences: prefs, isRefreshingSpeechVoices, isTestingVoice, localVoice, onEnableVoiceInput, onOpenVoiceSettings, onTestVoicePlayback, palette, selectedSpeechVoiceLabel, ttsSetup, updateChatPreferences, voiceCapabilities } = props;
  const { t } = useTranslation();
  const focused = useIsFocused();
  const target = useSettingsTarget();
  const voiceSetupTest = useVoiceTest();
  const setupTarget = target?.group?.startsWith('voice-setup');
  const [flow, setFlow] = useState<'setup' | 'downloads' | undefined>(setupTarget ? 'setup' : target?.group === 'voice-tts' ? 'downloads' : undefined);
  const [inputTab, setInputTab] = useState<'system' | 'local'>();
  const [playbackTab, setPlaybackTab] = useState<'system' | 'local'>();
  const [downloadPack, setDownloadPack] = useState<LocalTtsPackId>();
  const localInput = (inputTab ?? (prefs.voiceWakeMode === 'local' ? 'local' : 'system')) === 'local';
  const localPlayback = (playbackTab ?? prefs.ttsEngine) === 'local';
  const activePack = ttsSetup.activePack;
  const packReady = Boolean(activePack && ttsSetup.statuses[activePack.id] === 'ready');
  const localReady = localVoice.status === 'ready' && localVoice.microphone?.granted && (!prefs.localSpeakerVerification || localVoice.enrollment.hasProfile);
  const languageOptions = voiceLanguageOptions(t, prefs.speechLocale);
  const permission = voiceCapabilities?.permission;
  const cancelEnrollment = localVoice.enrollment.cancel;
  const stopTest = voiceSetupTest?.stop;
  useEffect(() => () => { void cancelEnrollment(); void stopTest?.(); void stopSpeaking(); }, [cancelEnrollment, stopTest, focused]);
  function modes(value: string, onChange: (value: string) => void) {
    return <ToggleGroup type="single" value={value} onValueChange={(next) => { if (next) onChange(next); }} className="flex-row flex-wrap">{([
      { label: t('settings:voice.mode.system'), value: 'system' },
      { label: t('settings:voice.mode.local'), value: 'local' },
    ]).map((option) => <ToggleGroupItem key={option.value} value={option.value} disabled={'disabled' in option && option.disabled === true}><Text>{option.label}</Text></ToggleGroupItem>)}</ToggleGroup>;
  }
  const voiceOptions = [{ label: t('settings:voice.voiceSelect.automatic'), value: '__system__' }, ...availableSpeechVoices.map((voice) => ({ label: voice.label, value: voice.id, description: voice.language }))];
  const playbackError = localPlayback && ttsSetup.error;
  return <View className={cn(stylesClasses.section)}>
    <SettingTarget label={t('settings:voice.mode.label')}>
      <Text className={cn("text-foreground")} variant="title">{t('settings:voice.mode.label')}</Text>
      {modes(localInput ? 'local' : 'system', (value) => {
        localVoice.clearError(); localVoice.refresh();
        if (value === 'system') { setInputTab(undefined); updateChatPreferences({ voiceWakeMode: 'phrase' }); }
        else if (localReady) { setInputTab(undefined); updateChatPreferences({ voiceWakeMode: 'local' }); }
        else setInputTab('local');
      })}
    </SettingTarget>
    <Text className={cn("text-muted-foreground")} variant="label">{t(localInput ? 'settings:voice.mode.localDescription' : 'settings:voice.mode.systemDescription')}</Text>
    <SettingSwitchRow
      title={t('settings:voice.requireWakePhrase.title')}
      description={t('settings:voice.requireWakePhrase.description')}
      palette={palette}
      value={prefs.wakePhraseRequired}
      onValueChange={(wakePhraseRequired) => updateChatPreferences({ wakePhraseRequired })}
    />
    {!localInput && !prefs.wakePhraseRequired ? (
      <FieldDescription  invalid={false}>{t('settings:voice.requireWakePhrase.systemWarning')}</FieldDescription>
    ) : null}
    <SettingSwitchRow
      title={t('settings:voice.confirmCommands.title')}
      description={t('settings:voice.confirmCommands.description')}
      palette={palette}
      value={prefs.confirmVoiceCommands}
      onValueChange={(confirmVoiceCommands) => updateChatPreferences({ confirmVoiceCommands })}
    />
    {localInput ? <>
      <SettingTarget label={t('settings:voice.localWake.title')}>
        <Button disabled={voiceSetupTest?.status === 'busy'} onPress={() => setFlow('setup')} variant="outline" className={cn("flex-row-reverse")} ><Icon name={"chevron-right"} size={20} /><Text>{t(localReady ? 'settings:voice.setup.manageInput' : 'settings:voice.setup.setUpInput')}</Text></Button>
      </SettingTarget>
      <Text className={cn("text-muted-foreground")} variant="label">{t(localReady ? 'settings:voice.localWake.statusReady' : 'settings:voice.setup.notActive')}</Text>
      {voiceSetupTest?.status === 'busy' ? <FieldDescription  invalid={false}>{t('settings:voice.setup.busy')}</FieldDescription> : null}
    </> : <>
      <SettingSelectField compact label={t('settings:voice.speechLocale.label')} palette={palette} selectedValue={prefs.speechLocale ?? ''} options={languageOptions}
        valueLabel={languageOptions.find((language) => language.value === (prefs.speechLocale ?? ''))!.label} onValueChange={(value) => updateChatPreferences({ speechLocale: value || undefined })} />
      {permission?.available && !permission.granted ? <Button onPress={permission.canAskAgain ? onEnableVoiceInput : onOpenVoiceSettings} variant="outline"><Text>{t(permission.canAskAgain ? 'settings:voice.check.enable' : 'common:actions.openSettings')}</Text></Button> : null}
      {voiceCapabilities && !voiceCapabilities.recognitionAvailable ? <FieldDescription  invalid={false}>{t('onboarding:permissions.voice.unsupported')}</FieldDescription> : null}
    </>}
    <View className={cn("bg-border")} style={[styles.divider]} />
    <SettingTarget label={t('settings:voice.playbackEngine.label')}>
      <Text className={cn("text-foreground")} variant="title">{t('onboarding:voice.playback')}</Text>
      {Platform.OS !== 'web' ? modes(localPlayback ? 'local' : 'system', (value) => {
        if (value === 'system') { setPlaybackTab(undefined); void ttsSetup.setEngine('system'); }
        else if (packReady) { setPlaybackTab(undefined); void ttsSetup.setEngine('local'); }
        else setPlaybackTab('local');
      }) : null}
    </SettingTarget>
    {localPlayback ? <>
      <SettingSelectField compact label={t('settings:voice.voiceSelect.label')} palette={palette} selectedValue={activePack?.id} valueLabel={activePack ? `${activePack.vendor} · ${activePack.languageLabel}` : t('settings:voice.setup.chooseVoice')}
        options={ttsSetup.packs.map((pack) => ({ value: pack.id, label: `${pack.vendor} · ${pack.languageLabel}`, description: t(ttsSetup.statuses[pack.id] === 'ready' ? 'settings:voice.localTts.installed' : 'settings:voice.localTts.notInstalled') }))}
        onValueChange={(id) => { if (ttsSetup.statuses[id] === 'ready') { setPlaybackTab(undefined); void ttsSetup.select(id); } else { setDownloadPack(id); setFlow('downloads'); } }} />
      <View className={cn(stylesClasses.actions)}>
        {activePack ? <Text className={cn("text-muted-foreground")} variant="label">{t(packReady ? 'settings:voice.localTts.installed' : 'settings:voice.localTts.notInstalled')}{' '}· {ttsSetup.sizeLabel(activePack.tarballBytes)}</Text> : null}
        <Button onPress={() => { setDownloadPack(activePack?.id); setFlow('downloads'); }} variant="ghost"><Text>{t('settings:voice.setup.manageDownloads')}</Text></Button>
      </View>
      {packReady && activePack && activePack.speakers.length > 1 ? <SettingSelectField compact label={t('settings:voice.localTts.speaker')} palette={palette} selectedValue={String(prefs.localTtsSpeakerId)} valueLabel={activePack.speakers.find((speaker) => speaker.id === prefs.localTtsSpeakerId)?.label ?? activePack.speakers[0].label}
        options={activePack.speakers.map((speaker) => ({ label: speaker.label, value: String(speaker.id) }))} onValueChange={(value) => ttsSetup.setSpeaker(Number(value))} /> : null}
      {activePack && !isPackLanguageCompatible(activePack, prefs.speechLocale) ? <FieldDescription  invalid={false}>{t('settings:voice.localTts.languageMismatch', { language: activePack.languageLabel })}</FieldDescription> : null}
    </> : <SettingSelectField compact label={t('settings:voice.voiceSelect.label')} palette={palette} disabled={isRefreshingSpeechVoices} selectedValue={availableSpeechVoices.some((voice) => voice.id === prefs.speechVoiceId) ? prefs.speechVoiceId : '__system__'} valueLabel={selectedSpeechVoiceLabel} options={voiceOptions}
      onValueChange={(value) => {
        if (value === '__system__') updateChatPreferences({ speechVoiceId: undefined });
        else { const voice = availableSpeechVoices.find((item) => item.id === value); if (voice) updateChatPreferences({ speechVoiceId: voice.id, speechLocale: prefs.speechLocale || voice.language }); }
      }} />}
    <Button disabled={localPlayback && !packReady} onPress={() => { if (localPlayback && activePack) void ttsSetup.preview(activePack.id, prefs.localTtsSpeakerId); else onTestVoicePlayback(); }} variant="outline" className={cn("self-start")} >{isTestingVoice || ttsSetup.isPreviewing ? <Spinner size="small" /> : null}<Icon name={"play"} size={20} /><Text>{t('settings:voice.localTts.preview')}</Text></Button>
    {playbackError ? <FieldDescription  invalid={true}>{playbackError}</FieldDescription> : null}
    <SettingSwitchRow title={t('settings:voice.autoPlay.title')} description="" palette={palette} value={prefs.autoPlayAssistantReplies} onValueChange={(autoPlayAssistantReplies) => updateChatPreferences({ autoPlayAssistantReplies })} />
    <VoiceMoreSettings {...props} localInput={localInput} />
    {focused && flow === 'setup' ? <VoiceInputSetup chatPreferences={prefs} localVoice={localVoice} palette={palette} test={voiceSetupTest}
      initialStep={target?.group === 'voice-setup-profile' ? 3 : setupTarget ? 2 : 1} onClose={() => { setFlow(undefined); setInputTab(undefined); }} onDone={() => { setFlow(undefined); setInputTab(undefined); }} onOpenSettings={onOpenVoiceSettings} updateChatPreferences={updateChatPreferences} /> : null}
    {focused && flow === 'downloads' ? <VoiceFlowScreen title={t('settings:voice.setup.manageDownloads')} palette={palette} onBack={() => { setFlow(undefined); void stopSpeaking(); }} onClose={() => { setFlow(undefined); void stopSpeaking(); }}>
      <LocalTtsSection chatPreferences={prefs} palette={palette} ttsSetup={ttsSetup} initialPackId={downloadPack} onSelected={() => { setPlaybackTab(undefined); setFlow(undefined); }} />
    </VoiceFlowScreen> : null}
  </View>;
}
const styles = StyleSheet.create({
  divider: { height: StyleSheet.hairlineWidth, marginVertical: 8 }
});

const stylesClasses = {
  "section": "gap-4 pb-2",
  "actions": "flex-row flex-wrap items-center justify-between gap-2"
} as const;
