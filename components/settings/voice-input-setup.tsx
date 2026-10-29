import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AppState, Image, StyleSheet, View } from 'react-native';
import { HelperText, Icon, ProgressBar, Text } from 'react-native-paper';

import { LOCAL_COMMAND_MODELS, LOCAL_VOICE_BASE_DOWNLOAD_BYTES } from '@/lib/voice/local-wake-word/model-constants';
import { LOCAL_WAKE_PHRASES } from '@/lib/voice/local-wake-word/types';
import type { ChatPreferences } from '@/providers/opencode-preferences';
import type { VoiceSetupTest } from '@/providers/use-voice-setup-test';
import { SettingTarget, SettingsDisclosure } from './settings-panel';
import { SettingButton as Button, SettingSelectField, SettingSwitchRow, type Palette } from './sections/setting-rows';
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
      <Button mode="contained" onPress={() => setStep(2)}>{t('settings:connection.setup.continue')}</Button>
      <Button onPress={close}>{t('settings:voice.setup.notNow')}</Button>
    </> : step === 2 ? <Button mode="contained" loading={localVoice.isInstalling} disabled={localVoice.isInstalling || conversationBusy || localVoice.status === 'unsupported' || !localVoice.microphone?.granted}
      onPress={async () => { if (ready || await localVoice.install()) setStep(3); }}>
      {t(ready ? 'settings:connection.setup.continue' : 'settings:voice.setup.downloadContinue')}
    </Button> : step === 3 ? <>
      <Button mode="contained" disabled={busy || conversationBusy} onPress={() => {
        if (!localVoice.enrollment.hasProfile) updateChatPreferences({ localSpeakerVerification: false });
        setStep(4);
      }}>{t(localVoice.enrollment.hasProfile ? 'settings:connection.setup.continue' : 'settings:voice.setup.skipProfile')}</Button>
      {busy ? <Button onPress={() => void cancelEnrollment()}>{t('common:actions.cancel')}</Button> : null}
    </> : <>
      <Button mode="contained" loading={test?.status === 'starting'} disabled={!ready || conversationBusy || !test} onPress={async () => {
        if (test?.status === 'detected') finish();
        else { await cancelEnrollment(); if (testing) await test?.stop(); else await test?.start(); }
      }}>{t(test?.status === 'detected' ? 'common:actions.done' : testing ? 'settings:voice.setup.stopTest' : test?.status === 'error' ? 'common:actions.retry' : 'settings:voice.setup.startTest')}</Button>
      {test?.status !== 'detected' ? <Button disabled={!ready || conversationBusy} onPress={finish}>{t('settings:voice.setup.skipTest')}</Button> : null}
    </>}
  </>}>
    <View style={{ height: 4 }}><ProgressBar progress={step / 4} color={palette.tint} style={{ borderRadius: 4 }} /></View>
    <Text variant="labelLarge" style={{ color: palette.muted, textAlign: 'center' }}>{t('settings:voice.setup.step', { step, total: 4 })}</Text>
    <Image accessible={false} source={art[step - 1]} resizeMode="contain" style={[styles.art, { tintColor: palette.tint }]} />
    <Text accessibilityRole="header" variant="headlineSmall" style={{ color: palette.text, fontWeight: '700' }}>{t(`settings:voice.setup.${titles[step - 1]}.title`, { phrase })}</Text>
    <Text variant="bodyLarge" style={{ color: palette.muted }}>{t(`settings:voice.setup.${titles[step - 1]}.description`, { phrase })}</Text>
    {conversationBusy ? <HelperText type="info">{t('settings:voice.setup.busy')}</HelperText> : null}
    {step === 1 ? <>
      <View style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}>
        <View style={styles.sequence} aria-hidden accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <Icon source="microphone-outline" size={32} color={palette.tint} /><Icon source="chevron-right" size={20} color={palette.muted} />
          <Icon source="message-processing-outline" size={32} color={palette.tint} /><Icon source="chevron-right" size={20} color={palette.muted} /><Icon source="send" size={32} color={palette.tint} />
        </View>
        <Text variant="titleMedium" style={{ color: palette.text, textAlign: 'center' }}>{t('settings:voice.setup.sequence')}</Text>
        <Text variant="bodyMedium" style={{ color: palette.muted }}>{t('settings:voice.setup.serverNote')}</Text>
      </View>
    </> : step === 2 ? <>
      <SettingSelectField compact label={t('settings:voice.speechLocale.label')} options={languages} palette={palette} selectedValue={language}
        valueLabel={languages.find((option) => option.value === language)!.label} disabled={localVoice.isInstalling}
        onValueChange={(value) => updateChatPreferences({ speechLocale: value || undefined,
          localCommandModel: (value || i18n.resolvedLanguage || i18n.language || 'en').toLowerCase().startsWith('en') ? 'moonshine-tiny-en' : 'whisper-tiny-multi' })} />
      <View style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}>
        <Text variant="titleMedium" style={{ color: palette.text }}>{t('settings:voice.setup.tools')}</Text>
        <Text variant="bodyMedium" style={{ color: palette.muted }}>{t(missingBytes ? 'settings:voice.setup.downloadSize' : 'settings:voice.localTts.installed', { size })}</Text>
        <Text variant="bodySmall" style={{ color: palette.muted }}>{t(prefs.localCommandModel === 'moonshine-tiny-en' ? 'settings:voice.setup.englishModel' : 'settings:voice.setup.multilingualModel')}</Text>
      </View>
      <View style={styles.permission}>
        <Text style={{ flex: 1, color: palette.text }}>{t('settings:voice.setup.microphone')}</Text>
        {localVoice.microphone?.granted ? <Text style={{ color: palette.success }}>{t('settings:voice.check.allowed')}</Text> :
          <Button mode="outlined" disabled={conversationBusy} onPress={localVoice.microphone?.canAskAgain === false ? onOpenSettings : () => void localVoice.enableMicrophone()}>
            {t(localVoice.microphone?.canAskAgain === false ? 'common:actions.openSettings' : 'settings:voice.setup.allow')}
          </Button>}
      </View>
      <SettingsDisclosure id="voice-setup-prepare" title={t('settings:voice.setup.advanced')}>
        <SettingSelectField compact label={t('settings:voice.localWake.commandModelLabel')} disabled={localVoice.isInstalling} palette={palette}
          options={Object.values(LOCAL_COMMAND_MODELS).map((model) => ({ label: model.label, value: model.id }))}
          selectedValue={prefs.localCommandModel} valueLabel={LOCAL_COMMAND_MODELS[prefs.localCommandModel].label} onValueChange={(value) => updateChatPreferences({ localCommandModel: value })} />
        <SettingSelectField compact label={t('settings:voice.localWake.phraseLabel')} disabled={localVoice.isInstalling} palette={palette}
          options={Object.values(LOCAL_WAKE_PHRASES).map((item) => ({ label: item.label, value: item.id }))}
          selectedValue={prefs.localWakePhrase} valueLabel={phrase} onValueChange={(value) => updateChatPreferences({ localWakePhrase: value })} />
        {localVoice.status === 'ready' ? <Button mode="text" disabled={conversationBusy} onPress={() => void localVoice.remove()}>{t('settings:voice.localWake.remove')}</Button> : null}
      </SettingsDisclosure>
      {localVoice.error ? <HelperText type="error" accessibilityLiveRegion="polite">{localVoice.error}</HelperText> : null}
      {localVoice.status === 'unsupported' ? <HelperText type="info">{t('settings:voice.localWake.unsupportedHint')}</HelperText> : null}
    </> : step === 3 ? <SettingTarget label={t('settings:voice.localWake.voiceProfile')}>
      <Text variant="bodyMedium" style={{ color: palette.muted }}>{t('settings:voice.setup.profileNote')}</Text>
      <Text accessibilityLiveRegion="polite" style={{ color: palette.text }}>{t(localVoice.enrollment.status === 'recording' ? 'settings:voice.localWake.recording' : localVoice.enrollment.status === 'saving' ? 'settings:voice.localWake.saving' : localVoice.enrollment.hasProfile ? 'settings:voice.localWake.enrolled' : 'settings:voice.localWake.notEnrolled')}</Text>
      <Button mode="outlined" loading={busy} disabled={busy || !ready || conversationBusy} onPress={async () => { await stopTest?.(); await localVoice.enrollment.enroll(); }}>
        {t(localVoice.enrollment.hasProfile ? 'settings:voice.localWake.reEnroll' : 'settings:voice.localWake.enroll')}
      </Button>
      {localVoice.enrollment.hasProfile ? <>
        <SettingSwitchRow title={t('settings:voice.localWake.speakerVerification')} description={t('settings:voice.localWake.speakerVerificationDescription')} palette={palette}
          value={prefs.localSpeakerVerification} disabled={busy} onValueChange={(value) => updateChatPreferences({ localSpeakerVerification: value })} />
        <Button disabled={busy} onPress={async () => { await localVoice.enrollment.clearProfile(); updateChatPreferences({ localSpeakerVerification: false }); }}>{t('settings:voice.localWake.removeVoice')}</Button>
      </> : null}
      {localVoice.enrollment.error ? <HelperText type="error">{localVoice.enrollment.error}</HelperText> : null}
    </SettingTarget> : <>
      <Text accessibilityLiveRegion="polite" variant="titleMedium" style={{ color: palette.tint }}>{t(`settings:voice.setup.test.${test?.status ?? 'idle'}`)}</Text>
      {test?.error ? <HelperText type="error">{test.error}</HelperText> : null}
      <Text variant="bodySmall" style={{ color: palette.muted }}>{t('settings:voice.setup.testNote')}</Text>
    </>}
  </VoiceFlowScreen>;
}
const styles = StyleSheet.create({
  art: { width: '100%', height: 160 },
  sequence: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', paddingVertical: 12 },
  card: { borderWidth: 1, borderRadius: 18, padding: 16, gap: 8 },
  permission: { flexDirection: 'row', alignItems: 'center', gap: 12 },
});
