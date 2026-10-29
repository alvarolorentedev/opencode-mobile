import { useEffect, useState } from 'react';
import { useIsFocused } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Platform, StyleSheet, View } from 'react-native';
import { HelperText, SegmentedButtons, Text } from 'react-native-paper';

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
import { SettingButton as Button, SettingSelectField, SettingSwitchRow, type Palette } from './setting-rows';
export type VoiceSectionProps = {
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
    return <SegmentedButtons value={value} onValueChange={onChange} buttons={[
      { label: t('settings:voice.mode.system'), value: 'system' },
      { label: t('settings:voice.mode.local'), value: 'local' },
    ]} />;
  }
  const voiceOptions = [{ label: t('settings:voice.voiceSelect.automatic'), value: '__system__' }, ...availableSpeechVoices.map((voice) => ({ label: voice.label, value: voice.id, description: voice.language }))];
  const playbackError = localPlayback && ttsSetup.error;
  return <View style={styles.section}>
    <SettingTarget label={t('settings:voice.mode.label')}>
      <Text variant="titleMedium" style={{ color: palette.text }}>{t('settings:voice.mode.label')}</Text>
      {modes(localInput ? 'local' : 'system', (value) => {
        localVoice.clearError(); localVoice.refresh();
        if (value === 'system') { setInputTab(undefined); updateChatPreferences({ voiceWakeMode: 'phrase' }); }
        else if (localReady) { setInputTab(undefined); updateChatPreferences({ voiceWakeMode: 'local' }); }
        else setInputTab('local');
      })}
    </SettingTarget>
    <Text variant="bodySmall" style={{ color: palette.muted }}>{t(localInput ? 'settings:voice.mode.localDescription' : 'settings:voice.mode.systemDescription')}</Text>
    {localInput ? <>
      <SettingTarget label={t('settings:voice.localWake.title')}>
        <Button mode="outlined" icon="chevron-right" disabled={voiceSetupTest?.status === 'busy'} contentStyle={{ flexDirection: 'row-reverse' }} onPress={() => setFlow('setup')}>
          {t(localReady ? 'settings:voice.setup.manageInput' : 'settings:voice.setup.setUpInput')}
        </Button>
      </SettingTarget>
      <Text variant="bodySmall" style={{ color: palette.muted }}>{t(localReady ? 'settings:voice.localWake.statusReady' : 'settings:voice.setup.notActive')}</Text>
      {voiceSetupTest?.status === 'busy' ? <HelperText type="info">{t('settings:voice.setup.busy')}</HelperText> : null}
    </> : <>
      <SettingSelectField compact label={t('settings:voice.speechLocale.label')} palette={palette} selectedValue={prefs.speechLocale ?? ''} options={languageOptions}
        valueLabel={languageOptions.find((language) => language.value === (prefs.speechLocale ?? ''))!.label} onValueChange={(value) => updateChatPreferences({ speechLocale: value || undefined })} />
      {permission?.available && !permission.granted ? <Button mode="outlined" onPress={permission.canAskAgain ? onEnableVoiceInput : onOpenVoiceSettings}>{t(permission.canAskAgain ? 'settings:voice.check.enable' : 'common:actions.openSettings')}</Button> : null}
      {voiceCapabilities && !voiceCapabilities.recognitionAvailable ? <HelperText type="info">{t('onboarding:permissions.voice.unsupported')}</HelperText> : null}
    </>}
    <View style={[styles.divider, { backgroundColor: palette.border }]} />
    <SettingTarget label={t('settings:voice.playbackEngine.label')}>
      <Text variant="titleMedium" style={{ color: palette.text }}>{t('onboarding:voice.playback')}</Text>
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
      <View style={styles.actions}>
        {activePack ? <Text variant="bodySmall" style={{ color: palette.muted }}>{t(packReady ? 'settings:voice.localTts.installed' : 'settings:voice.localTts.notInstalled')} · {ttsSetup.sizeLabel(activePack.tarballBytes)}</Text> : null}
        <Button mode="text" onPress={() => { setDownloadPack(activePack?.id); setFlow('downloads'); }}>{t('settings:voice.setup.manageDownloads')}</Button>
      </View>
      {packReady && activePack && activePack.speakers.length > 1 ? <SettingSelectField compact label={t('settings:voice.localTts.speaker')} palette={palette} selectedValue={String(prefs.localTtsSpeakerId)} valueLabel={activePack.speakers.find((speaker) => speaker.id === prefs.localTtsSpeakerId)?.label ?? activePack.speakers[0].label}
        options={activePack.speakers.map((speaker) => ({ label: speaker.label, value: String(speaker.id) }))} onValueChange={(value) => ttsSetup.setSpeaker(Number(value))} /> : null}
      {activePack && !isPackLanguageCompatible(activePack, prefs.speechLocale) ? <HelperText type="info">{t('settings:voice.localTts.languageMismatch', { language: activePack.languageLabel })}</HelperText> : null}
    </> : <SettingSelectField compact label={t('settings:voice.voiceSelect.label')} palette={palette} disabled={isRefreshingSpeechVoices} selectedValue={availableSpeechVoices.some((voice) => voice.id === prefs.speechVoiceId) ? prefs.speechVoiceId : '__system__'} valueLabel={selectedSpeechVoiceLabel} options={voiceOptions}
      onValueChange={(value) => {
        if (value === '__system__') updateChatPreferences({ speechVoiceId: undefined });
        else { const voice = availableSpeechVoices.find((item) => item.id === value); if (voice) updateChatPreferences({ speechVoiceId: voice.id, speechLocale: prefs.speechLocale || voice.language }); }
      }} />}
    <Button icon="play" mode="outlined" style={{ alignSelf: 'flex-start' }} disabled={localPlayback && !packReady} loading={isTestingVoice || ttsSetup.isPreviewing}
      onPress={() => { if (localPlayback && activePack) void ttsSetup.preview(activePack.id, prefs.localTtsSpeakerId); else onTestVoicePlayback(); }}>{t('settings:voice.localTts.preview')}</Button>
    {playbackError ? <HelperText type="error">{playbackError}</HelperText> : null}
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
  section: { gap: 16, paddingBottom: 8 },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: 8 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
});
