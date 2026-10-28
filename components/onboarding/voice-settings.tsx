import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { HelperText, Text } from 'react-native-paper';

import { ResponsesSection } from '@/components/settings/sections/responses-section';
import { VoiceSection } from '@/components/settings/sections/voice-section';
import { WORKING_SOUND_OPTIONS } from '@/components/settings/settings-utils';
import { useTtsSetup } from '@/components/settings/use-tts-setup';
import { useVoiceSetup } from '@/components/settings/use-voice-setup';
import { useSpeechVoices } from '@/components/settings/use-speech-voices';
import { usePalette } from '@/hooks/use-palette';
import { getSpeechPlayback } from '@/lib/voice/speech-config';
import { usePreferences } from '@/providers/opencode-contexts';

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
        isRefreshingVoiceCapabilities={voiceSetup.isRefreshing}
        isTestingVoice={voiceSetup.isTesting}
        localVoice={voiceSetup.localVoice}
        onEnableVoiceInput={() => void voiceSetup.enable()}
        onOpenVoiceSettings={() => void voiceSetup.openAppSettings()}
        onRefreshVoiceCapabilities={() => void voiceSetup.refreshStatus()}
        onTestVoicePlayback={() => void voiceSetup.testPlayback()}
        palette={palette}
        selectedSpeechVoiceLabel={voices.find((voice) => voice.id === speechVoiceId)?.label || t('settings:voice.voiceSelect.automatic')}
        selectedWorkingSound={WORKING_SOUND_OPTIONS.find((option) => option.value === chatPreferences.workingSoundVariant) || WORKING_SOUND_OPTIONS[0]}
        ttsSetup={ttsSetup}
        updateChatPreferences={updateChatPreferences}
        voiceCapabilities={voiceSetup.capabilities}
      />
      {voiceSetup.feedback ? <HelperText type="info">{voiceSetup.feedback}</HelperText> : null}
      <View style={[styles.divider, { backgroundColor: palette.border }]} />
      <Text variant="titleMedium" style={{ color: palette.text }}>{t('onboarding:voice.responses')}</Text>
      <ResponsesSection chatPreferences={chatPreferences} palette={palette} selectedResponseScope={{ value: chatPreferences.responseScope }} updateChatPreferences={updateChatPreferences} />
      <Text variant="bodySmall" style={{ color: palette.muted }}>{t('onboarding:ready.footnote')}</Text>
    </>
  );
}

const styles = StyleSheet.create({
  divider: { height: StyleSheet.hairlineWidth, marginVertical: 4 },
});
