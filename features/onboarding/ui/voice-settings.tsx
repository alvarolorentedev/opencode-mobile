import { cn } from '@/shared/ui/cn';
import { FieldDescription } from '@/shared/ui/text-field';
import { Text } from '@/shared/ui/text';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { ResponsesSection } from '@/features/chat/index';
import { VoiceSection , WORKING_SOUND_OPTIONS , useTtsSetup , useVoiceSetup , useSpeechVoices } from '@/features/voice/index';
import { usePalette } from '@/shared/ui/theme/use-palette';
import { getSpeechPlayback } from '@/shared/platform/voice/speech-config';
import { usePreferences } from '@/shared/preferences/context';

export function OnboardingVoiceSettings() {
  const { t } = useTranslation();
  const palette = usePalette();
  const { chatPreferences, updateChatPreferences } = usePreferences();
  const { localTtsPackId, localTtsSpeakerId, speechVoiceId, ttsEngine } = chatPreferences;
  const playback = useMemo(() => getSpeechPlayback({ localTtsPackId, localTtsSpeakerId, speechVoiceId, ttsEngine }), [localTtsPackId, localTtsSpeakerId, speechVoiceId, ttsEngine]);
  const voiceSetup = useVoiceSetup({
    locale: chatPreferences.speechLocale,
    localCommandModel: chatPreferences.localCommandModel,
    localWakePhrase: chatPreferences.localWakePhrase,
    playback,
    rate: chatPreferences.speechRate,
  });
  const ttsSetup = useTtsSetup({ chatPreferences, rate: chatPreferences.speechRate, updateChatPreferences });
  const { voices, isLoading: loadingVoices } = useSpeechVoices();

  return (
    <>
      <VoiceSection
        onboarding
        availableSpeechVoices={voices}
        chatPreferences={chatPreferences}
        isRefreshingSpeechVoices={loadingVoices}
        isTestingVoice={voiceSetup.isTesting}
        localVoice={voiceSetup.localVoice}
        onEnableVoiceInput={() => void voiceSetup.enable()}
        onOpenVoiceSettings={() => void voiceSetup.openAppSettings()}
        onTestVoicePlayback={() => void voiceSetup.testPlayback()}
        palette={palette}
        selectedSpeechVoiceLabel={voices.find((voice) => voice.id === speechVoiceId)?.label || t('settings:voice.voiceSelect.automatic')}
        selectedWorkingSound={WORKING_SOUND_OPTIONS.find((option) => option.value === chatPreferences.workingSoundVariant) || WORKING_SOUND_OPTIONS[0]}
        ttsSetup={ttsSetup}
        updateChatPreferences={updateChatPreferences}
        voiceCapabilities={voiceSetup.capabilities}
      />
      {voiceSetup.feedback ? <FieldDescription  invalid={false}>{voiceSetup.feedback}</FieldDescription> : null}
      <View className={cn("bg-border")} style={[styles.divider]} />
      <Text className={cn("text-foreground")} variant="title">{t('onboarding:voice.responses')}</Text>
      <ResponsesSection chatPreferences={chatPreferences} palette={palette} selectedResponseScope={{ value: chatPreferences.responseScope }} updateChatPreferences={updateChatPreferences} />
      <Text className={cn("text-muted-foreground")} variant="label">{t('onboarding:ready.footnote')}</Text>
    </>
  );
}

const styles = StyleSheet.create({
  divider: { height: StyleSheet.hairlineWidth, marginVertical: 4 }
});
