import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { List } from 'react-native-paper';

import { LANGUAGE_OPTIONS } from '@/components/settings/settings-utils';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { getNormalizedServerUrl } from '@/lib/opencode/client';
import { getVisibleModels } from '@/providers/opencode-model-selection';
import { useCapabilities, useConnection, usePreferences, useProjects } from '@/providers/opencode-contexts';

export function SetupSummary() {
  const { t } = useTranslation();
  const palette = Colors[useColorScheme() ?? 'light'];
  const { settings, connection, serverCapabilities } = useConnection();
  const { activeProject } = useProjects();
  const { availableModels, configuredProviders } = useCapabilities();
  const { chatPreferences } = usePreferences();
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
    { id: 'transcript', label: t('settings:appearance.transcriptVerbosity.label'), value: t(`settings:appearance.transcriptVerbosity.${chatPreferences.transcriptVerbosity || 'basic'}.label`) },
    ...(connected ? [
      { id: 'default-model', label: t('onboarding:general.defaultModel'), value: selected ? `${selected.label} · ${selected.providerLabel}` : t('common:labels.systemDefault') },
    ] : []),
    ...(connected && serverCapabilities.contract === 'v2' ? [
      { id: 'delivery', label: t('settings:providers.promptDelivery.label'), value: t(`settings:providers.promptDelivery.${chatPreferences.promptDelivery || 'steer'}.label`) },
    ] : []),
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
