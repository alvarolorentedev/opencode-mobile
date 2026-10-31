import { Feedback } from '@/shared/ui/feedback';
import { Portal } from '@/shared/ui/portal';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useIsFocused } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useConfirmation } from '@/shared/ui/use-confirmation';
import { findMatchingProfile } from '@/shared/contracts/connection-profiles';
import { AiDefaultsSection } from '@/features/ai/ui/settings/ai-defaults-section';
import { AutoModelSection } from '@/features/ai/ui/settings/auto-model-section';
import { getProviderCopy } from '@/features/ai/model/settings-utils';
import { useProviderConfiguration } from '@/features/ai/ui/use-provider-configuration';
import { useCapabilities } from '@/features/ai/context';
import { useConnection } from '@/features/connections/context';
import { usePreferences } from '@/shared/preferences/context';
import { usePalette } from '@/shared/ui/theme/use-palette';

export function AiSettingsPanel() {
  const { confirmAction, confirmation } = useConfirmation();
  const { t } = useTranslation();
  const focused = useIsFocused();
  const insets = useSafeAreaInsets();
  const palette = usePalette();
  const { availableModels, availableProviders, configuredProviders, providerAccounts, providerAuthMethodsById, removeProvider, modelRouting } = useCapabilities();
  const { serverCapabilities, settings, connectionProfiles } = useConnection();
  const { chatPreferences, updateChatPreferences } = usePreferences();
  const providerConfig = useProviderConfiguration();
  const [expandedProviderId, setExpandedProviderId] = useState<string>();
  const enabledModelIds = useMemo(() => new Set(chatPreferences.enabledModelIds), [chatPreferences.enabledModelIds]);

  function handleModelToggle(modelId: string, checked: boolean) {
    const nextEnabledModelIds = checked
      ? chatPreferences.enabledModelIds.filter((id) => id !== modelId)
      : [...chatPreferences.enabledModelIds, modelId];

    updateChatPreferences({ enabledModelIds: nextEnabledModelIds });
  }

  function handleRemoveProvider(providerId: string) {
    const label = getProviderCopy(providerId, providerId, t).label;
    const remove = () => void removeProvider(providerId)
      .then(() => providerConfig.setFeedback({ type: 'success', message: t('settings:providers.credentialsRemoved', { provider: label }) }))
      .catch((error) => providerConfig.setFeedback({ type: 'error', message: error instanceof Error ? error.message : t('settings:providers.couldNotRemove') }));
    const server = findMatchingProfile(connectionProfiles.profiles, settings)?.name ?? settings.serverUrl;
    confirmAction(t('settings:providers.removeTitle', { provider: label }), `${server}\n\n${t('settings:providers.removeMessage')}`,
      t('common:actions.remove'), t('common:actions.cancel'), remove);
  }

  return <>{confirmation}{(
    <>
      <AiDefaultsSection
        availableModels={availableModels}
        availableProviders={availableProviders}
        configuredProviders={configuredProviders}
        contract={serverCapabilities.contract}
        enabledModelIds={enabledModelIds}
        expandedProviderId={expandedProviderId}
        onActivateProviderAccount={(credentialId) => void providerAccounts.activate(credentialId)}
        onExpandedProviderChange={setExpandedProviderId}
        onModelToggle={handleModelToggle}
        onRemoveProvider={handleRemoveProvider}
        onRemoveProviderAccount={(credentialId) => void providerAccounts.remove(credentialId)}
        onStartProviderConfiguration={providerConfig.startProviderConfiguration}
        palette={palette}
        providerAuthMethodsById={providerAuthMethodsById}
      />
      <AutoModelSection
        availableModels={availableModels}
        configuredProviders={configuredProviders}
        chatPreferences={chatPreferences}
        contract={serverCapabilities.contract}
        modelRouting={modelRouting}
        palette={palette}
        updateChatPreferences={updateChatPreferences}
      />
      {providerConfig.dialog}
      <Portal><Feedback duration={4000} open={focused && Boolean(providerConfig.feedback)} onOpenChange={() => (providerConfig.clearFeedback)()} style={{ bottom: 64 + insets.bottom }}>{providerConfig.feedback?.message}</Feedback></Portal>
    </>
  )}</>;
}
