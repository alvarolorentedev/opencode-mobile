import * as WebBrowser from 'expo-web-browser';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Dialog, HelperText, Portal } from 'react-native-paper';

import { ProviderConfigDialog } from '@/components/settings/provider-config-dialog';
import { getProviderCopy, supportsGenericApiKey } from '@/components/settings/settings-utils';
import { TextInput } from '@/components/ui/text-input';
import { usePalette } from '@/providers/theme-provider';
import { useCapabilities, useConnection } from '@/providers/opencode-contexts';

type ProviderFeedback = { type: 'success' | 'info' | 'error'; message: string };

type PendingOAuth = { providerId: string; methodIndex: number; instructions?: string };

/**
 * Provider credential configuration state machine shared by Settings and the
 * onboarding assistant. It owns only dialog/UI state; provider requests go
 * through the provider context (`setProviderAuth`, `startProviderOAuth`, ...).
 *
 * Returns the dialogs as `dialog` so callers render them once, and
 * `feedback`/`setFeedback` so callers can also surface provider-related
 * messages (for example credential removal).
 */
export function useProviderConfiguration() {
  const { t } = useTranslation();
  const palette = usePalette();
  const { availableProviders, providerAuthMethodsById, setProviderAuth, startProviderOAuth, completeProviderOAuth, completeAutomaticProviderOAuth } = useCapabilities();
  const { connect } = useConnection();

  const [selectedProviderId, setSelectedProviderId] = useState<string>();
  const [selectedMethodIndex, setSelectedMethodIndex] = useState(0);
  const [authValues, setAuthValues] = useState<Record<string, string>>({});
  const [isConfiguringProvider, setIsConfiguringProvider] = useState(false);
  const [providerDialogError, setProviderDialogError] = useState<string>();
  const [feedback, setFeedback] = useState<ProviderFeedback>();
  const [pendingOAuth, setPendingOAuth] = useState<PendingOAuth>();
  const [oauthCode, setOAuthCode] = useState('');
  const [oauthError, setOAuthError] = useState<string>();

  const selectedProvider = useMemo(
    () => availableProviders.find((provider) => provider.id === selectedProviderId),
    [availableProviders, selectedProviderId],
  );
  const selectedProviderCopy = useMemo(
    () => (selectedProvider ? getProviderCopy(selectedProvider.id, selectedProvider.label, t) : undefined),
    [selectedProvider, t],
  );
  const authMethods = useMemo(
    () => (selectedProviderId ? providerAuthMethodsById[selectedProviderId] || [] : []),
    [providerAuthMethodsById, selectedProviderId],
  );
  const effectiveAuthMethods = useMemo(
    () =>
      (authMethods.length > 0
        ? authMethods
        : supportsGenericApiKey(selectedProviderId)
          ? [{ type: 'api' as const, label: t('settings:providers.apiKey') }]
          : [])
        .map((method) => method.type === 'api' && !method.prompts?.length
          ? {
              ...method,
              prompts: [{
                type: 'text' as const,
                key: 'key',
                message: t('settings:providers.apiKey'),
                placeholder: t('settings:providers.pasteApiKey'),
              }],
            }
          : method),
    [authMethods, selectedProviderId, t],
  );
  const selectedMethod = effectiveAuthMethods[selectedMethodIndex];
  const visiblePrompts = useMemo(
    () =>
      (selectedMethod?.prompts || []).filter((prompt) => {
        if (!prompt.when) {
          return true;
        }

        const value = authValues[prompt.when.key];
        return prompt.when.op === 'eq' ? value === prompt.when.value : value !== prompt.when.value;
      }),
    [authValues, selectedMethod],
  );

  const resetProviderDialog = useCallback(() => {
    setSelectedProviderId(undefined);
    setSelectedMethodIndex(0);
    setAuthValues({});
    setProviderDialogError(undefined);
  }, []);

  const dismissPendingOAuth = useCallback(() => {
    setPendingOAuth(undefined);
    setOAuthCode('');
    setOAuthError(undefined);
  }, []);

  const startProviderConfiguration = useCallback((providerId: string) => {
    setProviderDialogError(undefined);
    setSelectedMethodIndex(0);

    const methods = providerAuthMethodsById[providerId] || [];
    const initialValues: Record<string, string> = {};
    const initialMethod = methods[0];
    initialMethod?.prompts?.forEach((prompt) => {
      if (prompt.type === 'select') {
        initialValues[prompt.key] = prompt.options?.[0]?.value || '';
      }
    });

    setSelectedProviderId(providerId);
    setAuthValues(initialValues);
  }, [providerAuthMethodsById]);

  const submitProviderConfiguration = useCallback(async () => {
    if (!selectedProviderId || !selectedMethod) {
      return;
    }

    const providerLabel = selectedProviderCopy?.label || selectedProviderId;
    setIsConfiguringProvider(true);
    setProviderDialogError(undefined);

    try {
      if (selectedMethod.type === 'oauth') {
        const authorization = await startProviderOAuth(selectedProviderId, selectedMethodIndex, authValues);
        await WebBrowser.openBrowserAsync(authorization.url);
        if (authorization.method === 'code') {
          setPendingOAuth({ providerId: selectedProviderId, methodIndex: selectedMethodIndex, instructions: authorization.instructions });
          setSelectedProviderId(undefined);
          return;
        }
        await completeAutomaticProviderOAuth(selectedProviderId);
        await connect();
        setFeedback(
          authorization.instructions
            ? { type: 'info', message: authorization.instructions }
            : { type: 'success', message: t('settings:providers.signInFinished', { provider: providerLabel }) },
        );
      } else {
        await setProviderAuth(selectedProviderId, authValues);
        setFeedback({
          type: 'success',
          message: t('settings:providers.configuredSuccess', { provider: providerLabel }),
        });
      }

      resetProviderDialog();
    } catch (error) {
      setProviderDialogError(error instanceof Error ? error.message : t('settings:providers.couldNotConfigure'));
    } finally {
      setIsConfiguringProvider(false);
    }
  }, [
    authValues,
    completeAutomaticProviderOAuth,
    connect,
    resetProviderDialog,
    selectedMethod,
    selectedMethodIndex,
    selectedProviderCopy?.label,
    selectedProviderId,
    setProviderAuth,
    startProviderOAuth,
    t,
  ]);

  const handleProviderMethodChange = useCallback((nextIndex: number) => {
    const nextMethod = effectiveAuthMethods[nextIndex];
    const nextValues: Record<string, string> = {};
    nextMethod?.prompts?.forEach((prompt) => {
      if (prompt.type === 'select') {
        nextValues[prompt.key] = prompt.options?.[0]?.value || '';
      }
    });
    setSelectedMethodIndex(nextIndex);
    setAuthValues(nextValues);
  }, [effectiveAuthMethods]);

  const dialog = (
    <Portal>
      <Dialog visible={Boolean(pendingOAuth)} onDismiss={dismissPendingOAuth}>
        <Dialog.Title>{t('settings:providers.signInTitle')}</Dialog.Title>
        <Dialog.Content>
          {pendingOAuth?.instructions ? <TextInput mode="flat" disabled value={pendingOAuth.instructions} /> : null}
          <TextInput mode="outlined" label={t('settings:providers.authorizationCode')} value={oauthCode} onChangeText={setOAuthCode} autoCapitalize="none" />
          {oauthError ? <HelperText type="error">{oauthError}</HelperText> : null}
        </Dialog.Content>
        <Dialog.Actions>
          <Button onPress={dismissPendingOAuth}>{t('common:actions.cancel')}</Button>
          <Button
            disabled={!oauthCode.trim()}
            onPress={() => {
              if (!pendingOAuth) return;
              void completeProviderOAuth(pendingOAuth.providerId, pendingOAuth.methodIndex, oauthCode).then(() => {
                setPendingOAuth(undefined);
                setOAuthCode('');
                setOAuthError(undefined);
                resetProviderDialog();
              }).catch((error) => setOAuthError(error instanceof Error ? error.message : t('settings:providers.couldNotComplete')));
            }}>
            {t('settings:providers.complete')}
          </Button>
        </Dialog.Actions>
      </Dialog>
      {selectedProvider ? (
        <ProviderConfigDialog
          authValues={authValues}
          effectiveAuthMethods={effectiveAuthMethods}
          isConfiguringProvider={isConfiguringProvider}
          onAuthValueChange={(key, value) => setAuthValues((current) => ({ ...current, [key]: value }))}
          onDismiss={resetProviderDialog}
          onMethodChange={handleProviderMethodChange}
          onSubmit={() => void submitProviderConfiguration()}
          palette={palette}
          providerDialogError={providerDialogError}
          selectedMethod={selectedMethod}
          selectedMethodIndex={selectedMethodIndex}
          selectedProviderDescription={selectedProviderCopy?.description}
          selectedProviderLabel={selectedProviderCopy?.label || selectedProvider.id}
          visiblePrompts={visiblePrompts}
        />
      ) : null}
    </Portal>
  );

  return {
    dialog,
    feedback,
    setFeedback,
    clearFeedback: useCallback(() => setFeedback(undefined), []),
    startProviderConfiguration,
  };
}
