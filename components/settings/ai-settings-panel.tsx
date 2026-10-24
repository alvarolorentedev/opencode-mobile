import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useIsFocused } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Portal, Snackbar } from 'react-native-paper';

import { confirmAction } from '@/lib/confirm-action';
import { findMatchingProfile } from '@/lib/connection-profiles';
import { AiDefaultsSection } from './sections/ai-defaults-section';
import { getProviderCopy } from './settings-utils';
import { useProviderConfiguration } from './use-provider-configuration';
import { useCapabilities, useConnection, usePreferences } from '@/providers/opencode-contexts';
import { usePalette } from '@/hooks/use-palette';

export function AiSettingsPanel() {
  const { t } = useTranslation();
  const focused = useIsFocused();
  const insets = useSafeAreaInsets();
  const palette = usePalette();
  const { availableModels, availableProviders, configuredProviders, providerAccounts, providerAuthMethodsById, removeProvider } = useCapabilities();
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

  return (
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
      {providerConfig.dialog}
      <Portal>
        <Snackbar
          visible={focused && Boolean(providerConfig.feedback)}
          wrapperStyle={{ bottom: 64 + insets.bottom }}
          onDismiss={providerConfig.clearFeedback}
          duration={4000}>
          {providerConfig.feedback?.message}
        </Snackbar>
      </Portal>
    </>
  );
}
