import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { List } from 'react-native-paper';

import { LANGUAGE_OPTIONS } from '@/components/settings/settings-utils';
import { useSpeechVoices } from '@/components/settings/use-speech-voices';
import { LOCAL_COMMAND_MODELS } from '@/lib/voice/local-wake-word/model-constants';
import { getLocalTtsPack } from '@/lib/voice/tts/catalog';
import { getNormalizedServerUrl } from '@/lib/opencode/client';
import { getVisibleModels } from '@/providers/opencode-model-selection';
import { useCapabilities, useConnection, usePreferences, useProjects } from '@/providers/opencode-contexts';
import { usePalette } from '@/hooks/use-palette';

export function SetupSummary() {
  const { t } = useTranslation();
  const palette = usePalette();
  const { settings, connection, serverCapabilities } = useConnection();
  const { activeProject } = useProjects();
  const { availableModels, configuredProviders } = useCapabilities();
  const { chatPreferences } = usePreferences();
  const { voices } = useSpeechVoices();
  const voiceLabel = voices.find((voice) => voice.id === chatPreferences.speechVoiceId)?.label || t('settings:voice.voiceSelect.automatic');
  const ttsPack = getLocalTtsPack(chatPreferences.localTtsPackId);
  const playbackLabel = chatPreferences.ttsEngine === 'local' && ttsPack
    ? `${t('settings:voice.mode.local')} · ${ttsPack.vendor} · ${ttsPack.languageLabel} · ${ttsPack.speakers.find((speaker) => speaker.id === chatPreferences.localTtsSpeakerId)?.label || ttsPack.speakers[0]?.label}`
    : `${t('settings:voice.mode.system')} · ${voiceLabel}`;
  const connected = connection.status === 'connected';
  const models = getVisibleModels(availableModels, configuredProviders, chatPreferences.enabledModelIds);
  const selected = models.find((model) => model.id === chatPreferences.modelId);
  const language = LANGUAGE_OPTIONS.find((option) => option.value === chatPreferences.language)?.label ?? t('common:labels.systemDefault');
  const none = t('common:labels.none');
  const rows = [
    { id: 'server', label: t('onboarding:ready.server'), value: connected ? getNormalizedServerUrl(settings.serverUrl) : t('onboarding:ready.serverMissing') },
    { id: 'project', label: t('onboarding:ready.project'), value: connected && activeProject ? `${activeProject.label} · ${activeProject.path}` : t('onboarding:ready.projectMissing') },
    ...(connected ? [
      { id: 'providers', label: t('onboarding:ready.providers'), value: configuredProviders.map((provider) => provider.label).join(', ') || none },
      { id: 'models', label: t('onboarding:ready.enabledModels'), value: models.map((model) => `${model.label} · ${model.providerLabel}`).join('\n') || none },
    ] : []),
    { id: 'language', label: t('settings:language.title'), value: language },
    ...(connected ? [
      { id: 'default-model', label: t('onboarding:general.defaultModel'), value: selected ? `${selected.label} · ${selected.providerLabel}` : t('common:labels.systemDefault') },
    ] : []),
    ...(connected && serverCapabilities.promptDeliveryAvailable ? [
      { id: 'delivery', label: t('settings:providers.promptDelivery.label'), value: t(`settings:providers.promptDelivery.${chatPreferences.promptDelivery || 'steer'}.label`) },
    ] : []),
    { id: 'voice-input', label: t('onboarding:voice.input'), value: chatPreferences.voiceWakeMode === 'local' ? `${t('settings:voice.mode.local')} · ${LOCAL_COMMAND_MODELS[chatPreferences.localCommandModel].label}` : t('settings:voice.mode.system') },
    { id: 'voice-playback', label: t('onboarding:voice.playback'), value: playbackLabel },
    { id: 'voice-wake-required', label: t('onboarding:voice.wakeRequired'), value: t(chatPreferences.wakePhraseRequired ? 'common:labels.enabled' : 'common:labels.off') },
    { id: 'voice-confirm', label: t('onboarding:voice.confirm'), value: t(chatPreferences.confirmVoiceCommands ? 'common:labels.enabled' : 'common:labels.off') },
    { id: 'voice-autoplay', label: t('onboarding:voice.autoPlay'), value: t(chatPreferences.autoPlayAssistantReplies ? 'common:labels.enabled' : 'common:labels.off') },
    { id: 'response-style', label: t('onboarding:voice.responses'), value: t(`settings:voice.responseScope.${chatPreferences.responseScope}.label`) },
    { id: 'next-actions', label: t('settings:voice.nextActions.title'), value: t(chatPreferences.includeNextActions ? 'common:labels.enabled' : 'common:labels.off') },
  ];

  return (
    <View style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}>
      {rows.map((row, index) => (
        <List.Item
          key={row.id}
          testID={`onboarding-summary-${row.id}`}
          title={row.label}
          description={row.value}
          titleNumberOfLines={0}
          descriptionNumberOfLines={0}
          titleStyle={{ color: palette.muted, fontSize: 13 }}
          descriptionStyle={{ color: palette.text }}
          style={index > 0 ? { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.border } : undefined}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 16, borderWidth: 1, overflow: 'hidden' },
});
