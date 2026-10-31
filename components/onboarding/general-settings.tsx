import { FieldDescription } from '@/components/ui/text-field';
import { useTranslation } from 'react-i18next';


import { PromptDeliveryField } from '@/components/settings/sections/chat-preference-fields';
import { LanguageSection } from '@/components/settings/sections/language-section';
import { SettingSelectField } from '@/components/settings/sections/setting-rows';
import { useCapabilities, useConnection, usePreferences } from '@/providers/opencode-contexts';
import { getVisibleModels } from '@/providers/opencode-model-selection';
import { usePalette } from '@/hooks/use-palette';

export function OnboardingGeneralSettings() {
  const { t } = useTranslation();
  const palette = usePalette();
  const { chatPreferences, updateChatPreferences } = usePreferences();
  const { availableModels, configuredProviders } = useCapabilities();
  const { connection, serverCapabilities } = useConnection();
  const models = getVisibleModels(availableModels, configuredProviders, chatPreferences.enabledModelIds);
  const selected = models.find((model) => model.id === chatPreferences.modelId);
  const connected = connection.status === 'connected';

  return (
    <>
      <LanguageSection showDescription={false} chatPreferences={chatPreferences} palette={palette} updateChatPreferences={updateChatPreferences} />
      {connected ? <>
        <SettingSelectField
          searchable
          testID="onboarding-default-model"
          label={t('onboarding:general.defaultModel')}
          valueLabel={selected ? `${selected.label} · ${selected.providerLabel}` : t('common:labels.systemDefault')}
          selectedValue={selected?.id}
          disabled={models.length === 0}
          options={models.map((model) => ({ value: model.id, label: `${model.label} · ${model.providerLabel}` }))}
          onValueChange={(id) => {
            const model = models.find((option) => option.id === id);
            if (model) updateChatPreferences({ providerId: model.providerID, modelId: model.id });
          }}
          palette={palette}
        />
        {models.length === 0 ? <FieldDescription  invalid={false}>{t('settings:providers.noModels')}</FieldDescription> : null}
        {serverCapabilities.promptDeliveryAvailable ? <PromptDeliveryField chatPreferences={chatPreferences} palette={palette} updateChatPreferences={updateChatPreferences} /> : null}
      </> : null}
    </>
  );
}
