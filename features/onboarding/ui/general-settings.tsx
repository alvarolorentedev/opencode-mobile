import { FieldDescription } from '@/shared/ui/text-field';
import { useTranslation } from 'react-i18next';

import { PromptDeliveryField } from '@/features/chat/index';
import { LanguageSection } from '@/shared/i18n/language-section';
import { SettingSelectField } from '@/shared/ui/settings/setting-rows';
import { useCapabilities } from '@/features/ai/context';
import { useConnection } from '@/features/connections/context';
import { usePreferences } from '@/shared/preferences/context';
import { getVisibleModels } from '@/features/ai/index';
import { usePalette } from '@/shared/ui/theme/use-palette';

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
