import { cn } from '@/lib/utils';
import { Progress } from '@/components/ui/progress';
import { Text } from '@/components/ui/text';
import { FieldDescription } from '@/components/ui/text-field';
import { Icon } from '@/components/ui/icon';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AppState, Image, View } from 'react-native';


import { LOCAL_COMMAND_MODELS, LOCAL_VOICE_BASE_DOWNLOAD_BYTES } from '@/lib/voice/local-wake-word/model-constants';
import { LOCAL_WAKE_PHRASES } from '@/lib/voice/local-wake-word/types';
import type { ChatPreferences } from '@/providers/opencode-preferences';
import type { VoiceSetupTest } from '@/providers/use-voice-setup-test';
import { SettingTarget, SettingsDisclosure } from './settings-panel';
import { SettingSelectField, SettingSwitchRow, type Palette } from './sections/setting-rows';
import type { LocalVoiceState } from './use-voice-setup';
import { voiceLanguageOptions } from './voice-language';
import { VoiceFlowScreen } from './voice-flow-screen';

const art = [
  require('@/assets/images/voice-input-intro.png'),
  require('@/assets/images/voice-input-download.png'),
  require('@/assets/images/voice-input-profile.png'),
  require('@/assets/images/voice-input-test.png'),
];

export function VoiceInputSetup({ chatPreferences: prefs, initialStep = 1, localVoice, onClose, onDone, onOpenSettings, palette, test, updateChatPreferences }: {
  chatPreferences: ChatPreferences; initialStep?: number; localVoice: LocalVoiceState;
  onClose: () => void; onDone: () => void; onOpenSettings: () => void; palette: Palette;
  test?: VoiceSetupTest; updateChatPreferences: (patch: Partial<ChatPreferences>) => void;
}) {
  const { t, i18n } = useTranslation();
  const [step, setStep] = useState(initialStep);
  const cancelEnrollment = localVoice.enrollment.cancel;
  const stopTest = test?.stop;
  const refresh = localVoice.refresh;
  const refreshMicrophone = localVoice.refreshMicrophone;
  const cleanup = useCallback(async () => {
    await cancelEnrollment();
    await stopTest?.();
  }, [cancelEnrollment, stopTest]);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') void cleanup();
      else { refresh(); void refreshMicrophone(); }
    });
    return () => { subscription.remove(); void cleanup(); };
  }, [cleanup, refresh, refreshMicrophone]);
  const busy = localVoice.enrollment.isRecording || localVoice.enrollment.status === 'saving';
  const testing = test?.status === 'starting' || test?.status === 'listening';
  const conversationBusy = test?.status === 'busy';
  const ready = localVoice.status === 'ready' && localVoice.microphone?.granted;
  const language = prefs.speechLocale ?? (prefs.localCommandModel === 'moonshine-tiny-en' ? 'en' : '');
  const languages = voiceLanguageOptions(t, language);
  const missingBytes = (localVoice.baseStatus === 'ready' ? 0 : LOCAL_VOICE_BASE_DOWNLOAD_BYTES)
    + (localVoice.commandStatus === 'ready' ? 0 : LOCAL_COMMAND_MODELS[prefs.localCommandModel].tarballBytes);
  const size = `~${Math.round(missingBytes / 1_000_000)} MB`;
  const phrase = LOCAL_WAKE_PHRASES[prefs.localWakePhrase].label;
  function close() { void cleanup(); onClose(); }
  function back() { void cleanup(); if (step === 1) onClose(); else setStep(step - 1); }
  function finish() {
    if (!ready || conversationBusy) return;
    void cleanup();
    updateChatPreferences({ voiceWakeMode: 'local', ...(!localVoice.enrollment.hasProfile ? { localSpeakerVerification: false } : {}) });
    onDone();
  }
  const titles = ['intro', 'prepare', 'profile', 'test'] as const;
  return <VoiceFlowScreen contentKey={step} title={t('settings:voice.setup.title')} onBack={back} onClose={close} palette={palette} footer={<>
    {step === 1 ? <>
      <Button onPress={() => setStep(2)} variant="default"><Text>{t('settings:connection.setup.continue')}</Text></Button>
      <Button onPress={close} variant="ghost"><Text>{t('settings:voice.setup.notNow')}</Text></Button>
    </> : step === 2 ? <Button disabled={localVoice.isInstalling || conversationBusy || localVoice.status === 'unsupported' || !localVoice.microphone?.granted} onPress={async () => { if (ready || await localVoice.install()) setStep(3); }} variant="default">{localVoice.isInstalling ? <Spinner size="small" /> : null}<Text>{t(ready ? 'settings:connection.setup.continue' : 'settings:voice.setup.downloadContinue')}</Text></Button> : step === 3 ? <>
      <Button disabled={busy || conversationBusy} onPress={() => {
        if (!localVoice.enrollment.hasProfile) updateChatPreferences({ localSpeakerVerification: false });
        setStep(4);
      }} variant="default"><Text>{t(localVoice.enrollment.hasProfile ? 'settings:connection.setup.continue' : 'settings:voice.setup.skipProfile')}</Text></Button>
      {busy ? <Button onPress={() => void cancelEnrollment()} variant="ghost"><Text>{t('common:actions.cancel')}</Text></Button> : null}
    </> : <>
      <Button disabled={!ready || conversationBusy || !test} onPress={async () => {
        if (test?.status === 'detected') finish();
        else { await cancelEnrollment(); if (testing) await test?.stop(); else await test?.start(); }
      }} variant="default">{test?.status === 'starting' ? <Spinner size="small" /> : null}<Text>{t(test?.status === 'detected' ? 'common:actions.done' : testing ? 'settings:voice.setup.stopTest' : test?.status === 'error' ? 'common:actions.retry' : 'settings:voice.setup.startTest')}</Text></Button>
      {test?.status !== 'detected' ? <Button disabled={!ready || conversationBusy} onPress={finish} variant="ghost"><Text>{t('settings:voice.setup.skipTest')}</Text></Button> : null}
    </>}
  </>}>
    <View className={cn("h-1")}><Progress className={cn("rounded-[4px]")} value={(step / 4) * 100}></Progress></View>
    <Text className={cn("text-muted-foreground text-center")} variant="description">{t('settings:voice.setup.step', { step, total: 4 })}</Text>
    <Image accessible={false} source={art[step - 1]} resizeMode="contain" className={cn(stylesClasses.art)} style={[{ tintColor: palette.tint }]} />
    <Text accessibilityRole="header" className={cn("text-foreground font-bold")} variant="display">{t(`settings:voice.setup.${titles[step - 1]}.title`, { phrase })}</Text>
    <Text className={cn("text-muted-foreground")} variant="body">{t(`settings:voice.setup.${titles[step - 1]}.description`, { phrase })}</Text>
    {conversationBusy ? <FieldDescription  invalid={false}>{t('settings:voice.setup.busy')}</FieldDescription> : null}
    {step === 1 ? <>
      <View className={cn(stylesClasses.card, "bg-surface border-border")}>
        <View className={cn(stylesClasses.sequence)} aria-hidden accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <Icon size={32} color={palette.tint} name={"microphone-outline"}></Icon><Icon size={20} color={palette.muted} name={"chevron-right"}></Icon>
          <Icon size={32} color={palette.tint} name={"message-processing-outline"}></Icon><Icon size={20} color={palette.muted} name={"chevron-right"}></Icon><Icon size={32} color={palette.tint} name={"send"}></Icon>
        </View>
        <Text className={cn("text-foreground text-center")} variant="title">{t('settings:voice.setup.sequence')}</Text>
        <Text className={cn("text-muted-foreground")} variant="description">{t('settings:voice.setup.serverNote')}</Text>
      </View>
    </> : step === 2 ? <>
      <SettingSelectField compact label={t('settings:voice.speechLocale.label')} options={languages} palette={palette} selectedValue={language}
        valueLabel={languages.find((option) => option.value === language)!.label} disabled={localVoice.isInstalling}
        onValueChange={(value) => updateChatPreferences({ speechLocale: value || undefined,
          localCommandModel: (value || i18n.resolvedLanguage || i18n.language || 'en').toLowerCase().startsWith('en') ? 'moonshine-tiny-en' : 'whisper-tiny-multi' })} />
      <View className={cn(stylesClasses.card, "bg-surface border-border")}>
        <Text className={cn("text-foreground")} variant="title">{t('settings:voice.setup.tools')}</Text>
        <Text className={cn("text-muted-foreground")} variant="description">{t(missingBytes ? 'settings:voice.setup.downloadSize' : 'settings:voice.localTts.installed', { size })}</Text>
        <Text className={cn("text-muted-foreground")} variant="label">{t(prefs.localCommandModel === 'moonshine-tiny-en' ? 'settings:voice.setup.englishModel' : 'settings:voice.setup.multilingualModel')}</Text>
      </View>
      <View className={cn(stylesClasses.permission)}>
        <Text className={cn("flex-1 text-foreground")}>{t('settings:voice.setup.microphone')}</Text>
        {localVoice.microphone?.granted ? <Text className={cn("text-success")}>{t('settings:voice.check.allowed')}</Text> :
          <Button disabled={conversationBusy} onPress={localVoice.microphone?.canAskAgain === false ? onOpenSettings : () => void localVoice.enableMicrophone()} variant="outline"><Text>{t(localVoice.microphone?.canAskAgain === false ? 'common:actions.openSettings' : 'settings:voice.setup.allow')}</Text></Button>}
      </View>
      <SettingsDisclosure id="voice-setup-prepare" title={t('settings:voice.setup.advanced')}>
        <SettingSelectField compact label={t('settings:voice.localWake.commandModelLabel')} disabled={localVoice.isInstalling} palette={palette}
          options={Object.values(LOCAL_COMMAND_MODELS).map((model) => ({ label: model.label, value: model.id }))}
          selectedValue={prefs.localCommandModel} valueLabel={LOCAL_COMMAND_MODELS[prefs.localCommandModel].label} onValueChange={(value) => updateChatPreferences({ localCommandModel: value })} />
        <SettingSelectField compact label={t('settings:voice.localWake.phraseLabel')} disabled={localVoice.isInstalling} palette={palette}
          options={Object.values(LOCAL_WAKE_PHRASES).map((item) => ({ label: item.label, value: item.id }))}
          selectedValue={prefs.localWakePhrase} valueLabel={phrase} onValueChange={(value) => updateChatPreferences({ localWakePhrase: value })} />
        {localVoice.status === 'ready' ? <Button disabled={conversationBusy} onPress={() => void localVoice.remove()} variant="ghost"><Text>{t('settings:voice.localWake.remove')}</Text></Button> : null}
      </SettingsDisclosure>
      {localVoice.error ? <FieldDescription accessibilityLiveRegion="polite" invalid={true}>{localVoice.error}</FieldDescription> : null}
      {localVoice.status === 'unsupported' ? <FieldDescription  invalid={false}>{t('settings:voice.localWake.unsupportedHint')}</FieldDescription> : null}
    </> : step === 3 ? <SettingTarget label={t('settings:voice.localWake.voiceProfile')}>
      <Text className={cn("text-muted-foreground")} variant="description">{t('settings:voice.setup.profileNote')}</Text>
      <Text accessibilityLiveRegion="polite" className={cn("text-foreground")}>{t(localVoice.enrollment.status === 'recording' ? 'settings:voice.localWake.recording' : localVoice.enrollment.status === 'saving' ? 'settings:voice.localWake.saving' : localVoice.enrollment.hasProfile ? 'settings:voice.localWake.enrolled' : 'settings:voice.localWake.notEnrolled')}</Text>
      <Button disabled={busy || !ready || conversationBusy} onPress={async () => { await stopTest?.(); await localVoice.enrollment.enroll(); }} variant="outline">{busy ? <Spinner size="small" /> : null}<Text>{t(localVoice.enrollment.hasProfile ? 'settings:voice.localWake.reEnroll' : 'settings:voice.localWake.enroll')}</Text></Button>
      {localVoice.enrollment.hasProfile ? <>
        <SettingSwitchRow title={t('settings:voice.localWake.speakerVerification')} description={t('settings:voice.localWake.speakerVerificationDescription')} palette={palette}
          value={prefs.localSpeakerVerification} disabled={busy} onValueChange={(value) => updateChatPreferences({ localSpeakerVerification: value })} />
        <Button disabled={busy} onPress={async () => { await localVoice.enrollment.clearProfile(); updateChatPreferences({ localSpeakerVerification: false }); }} variant="ghost"><Text>{t('settings:voice.localWake.removeVoice')}</Text></Button>
      </> : null}
      {localVoice.enrollment.error ? <FieldDescription  invalid={true}>{localVoice.enrollment.error}</FieldDescription> : null}
    </SettingTarget> : <>
      <Text accessibilityLiveRegion="polite" className={cn("text-primary")} variant="title">{t(`settings:voice.setup.test.${test?.status ?? 'idle'}`)}</Text>
      {test?.error ? <FieldDescription  invalid={true}>{test.error}</FieldDescription> : null}
      <Text className={cn("text-muted-foreground")} variant="label">{t('settings:voice.setup.testNote')}</Text>
    </>}
  </VoiceFlowScreen>;
}


const stylesClasses = {
  "art": "w-full h-40",
  "card": "border rounded-[18px] p-4 gap-2",
  "sequence": "flex-row items-center justify-around py-3",
  "permission": "flex-row items-center gap-3"
} as const;
