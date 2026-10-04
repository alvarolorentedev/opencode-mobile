import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text as NativeText, View } from 'react-native';
import { Button, HelperText, Text } from 'react-native-paper';

import { ModelPicker } from '@/components/chat/model-picker';
import { LanguageSection, SettingSelectField, SettingSwitchRow } from '@/components/settings/settings-sections';
import {
  getProviderCopy,
  RESPONSE_SCOPE_OPTIONS,
} from '@/components/settings/settings-utils';
import { useProviderConfiguration } from '@/components/settings/use-provider-configuration';
import { OnboardingStep } from '@/components/onboarding/onboarding-step';
import { NativeSelect } from '@/components/ui/native-select';
import { renderProviderIcon } from '@/components/ui/provider-icon';
import { Fonts } from '@/constants/theme';
import { usePalette } from '@/providers/theme-provider';
import { useCapabilities, usePreferences } from '@/providers/opencode-contexts';
import type { ResponseScope } from '@/providers/opencode-provider-types';

export default function OnboardingPreferencesScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const palette = usePalette();
  const { availableModels, availableProviders, configuredProviders } = useCapabilities();
  const { chatPreferences, updateChatPreferences } = usePreferences();
  const providerConfig = useProviderConfiguration();

  const responseScopeOptions = RESPONSE_SCOPE_OPTIONS.map((option) => ({
    label: t(`settings:voice.responseScope.${option.value}.label`),
    value: option.value,
  }));
  const selectedScope = RESPONSE_SCOPE_OPTIONS.find((option) => option.value === chatPreferences.responseScope) || RESPONSE_SCOPE_OPTIONS[0];
  const unconfiguredProviders = availableProviders.filter((provider) => !provider.configured);

  return (
    <OnboardingStep
      step={4}
      totalSteps={6}
      title={t('onboarding:preferences.title')}
      subtitle={t('onboarding:preferences.subtitle')}
      testID="onboarding-preferences"
      onBack={() => router.back()}
      footer={
        <>
          <Button
            mode="text"
            style={{ marginRight: 'auto' }}
            testID="onboarding-preferences-skip"
            onPress={() => router.push('/onboarding/permissions')}>
            {t('onboarding:preferences.skip')}
          </Button>
          <Button
            mode="contained"
            testID="onboarding-preferences-continue"
            onPress={() => router.push('/onboarding/permissions')}>
            {t('onboarding:preferences.continue')}
          </Button>
        </>
      }>
      {availableModels.length > 0 ? (
        <View style={styles.field}>
          <Text variant="labelLarge" style={{ color: palette.text }}>{t('onboarding:preferences.model')}</Text>
          <ModelPicker
            models={availableModels}
            onSelect={(model) => updateChatPreferences({ providerId: model.providerID, modelId: model.id })}
            recentModelIds={chatPreferences.recentModelIds}
            selectedModelId={chatPreferences.modelId}
          />
          <HelperText type="info">{t('onboarding:preferences.modelHint')}</HelperText>
        </View>
      ) : null}

      {configuredProviders.length === 0 ? (
        <View style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}>
          <Text variant="titleSmall" style={{ color: palette.text }}>{t('onboarding:preferences.provider.title')}</Text>
          <Text variant="bodySmall" style={{ color: palette.muted }}>{t('onboarding:preferences.provider.body')}</Text>
          {unconfiguredProviders.length > 0 ? (
            <NativeSelect
              onValueChange={providerConfig.startProviderConfiguration}
              options={unconfiguredProviders.map((provider) => ({
                label: getProviderCopy(provider.id, provider.label, t).label,
                leadingIcon: (props) => renderProviderIcon(provider.id, props.size, props.color),
                value: provider.id,
              }))}
              title={t('settings:providers.addProvider')}
              renderTrigger={({ open, openState }) => (
                <Pressable
                  accessibilityRole="button"
                  onPress={open}
                  testID="onboarding-add-provider"
                  style={({ pressed }) => [
                    styles.addProviderButton,
                    {
                      backgroundColor: palette.background,
                      borderColor: openState ? palette.tint : palette.border,
                      opacity: pressed ? 0.82 : 1,
                    },
                  ]}>
                  <NativeText style={[styles.addProviderLabel, { color: palette.text }]}>
                    {t('settings:providers.addProvider')}
                  </NativeText>
                </Pressable>
              )}
            />
          ) : null}
          {providerConfig.feedback ? <HelperText type="info">{providerConfig.feedback.message}</HelperText> : null}
        </View>
      ) : null}

      <SettingSelectField
        label={t('settings:voice.responseScope.label')}
        onValueChange={(value) => updateChatPreferences({ responseScope: value as ResponseScope })}
        options={responseScopeOptions}
        palette={palette}
        selectedValue={selectedScope.value}
        valueLabel={t(`settings:voice.responseScope.${selectedScope.value}.label`)}
      />
      <SettingSwitchRow
        description={t('settings:voice.nextActions.description')}
        onValueChange={(value) => updateChatPreferences({ includeNextActions: value })}
        palette={palette}
        title={t('settings:voice.nextActions.title')}
        value={chatPreferences.includeNextActions}
      />
      <SettingSwitchRow
        description={t('settings:voice.autoPlay.description')}
        onValueChange={(value) => updateChatPreferences({ autoPlayAssistantReplies: value })}
        palette={palette}
        title={t('settings:voice.autoPlay.title')}
        value={chatPreferences.autoPlayAssistantReplies}
      />
      <SettingSwitchRow
        description={t('settings:voice.workingSound.description')}
        onValueChange={(value) => updateChatPreferences({ workingSoundEnabled: value })}
        palette={palette}
        title={t('settings:voice.workingSound.title')}
        value={chatPreferences.workingSoundEnabled}
      />

      <LanguageSection chatPreferences={chatPreferences} palette={palette} updateChatPreferences={updateChatPreferences} />

      {providerConfig.dialog}
    </OnboardingStep>
  );
}

const styles = StyleSheet.create({
  field: { gap: 4 },
  card: { borderRadius: 16, borderWidth: 1, gap: 6, padding: 16 },
  addProviderButton: { minHeight: 44, borderWidth: 1, borderRadius: 999, justifyContent: 'center', paddingHorizontal: 14 },
  addProviderLabel: { fontFamily: Fonts.sans, fontSize: 14, fontWeight: '600' },
});
