import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { useCallback, useMemo, useRef, useState } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';

import { ProviderConfigDialog, type ProviderOAuthStage, type ProviderSetupStep } from '@/components/settings/provider-config-dialog';
import { getProviderCopy, supportsGenericApiKey } from '@/components/settings/settings-utils';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import type { ServerContract } from '@/lib/opencode/client';
import { parseProviderOAuthRedirect } from '@/lib/opencode/oauth';
import { useCapabilities, useConnection } from '@/providers/opencode-contexts';
import type { ProviderAuthMethod, ProviderAuthValues } from '@/providers/opencode-provider';

type ProviderFeedback = { type: 'success' | 'info' | 'error'; message: string };

export function initialAuthValues(method?: ProviderAuthMethod): ProviderAuthValues {
  const values: ProviderAuthValues = {};
  method?.prompts?.forEach((prompt) => {
    if (prompt.type === 'select' && prompt.options?.length) {
      values[prompt.key] = typeof prompt.defaultValue === 'string' ? prompt.defaultValue : prompt.options[0].value;
    } else if (prompt.type === 'multiselect') {
      values[prompt.key] = Array.isArray(prompt.defaultValue) ? prompt.defaultValue : [];
    } else if (prompt.type === 'boolean') {
      values[prompt.key] = prompt.defaultValue === true;
    } else if (prompt.defaultValue !== undefined) {
      values[prompt.key] = prompt.defaultValue;
    }
  });
  return values;
}

// Ensure API-key methods always expose a credential field, then prepend it to
// any method-specific form fields.
function ensureApiKeyPrompt(method: ProviderAuthMethod, t: TFunction): ProviderAuthMethod {
  if (method.type !== 'api') return method;
  const hasCredentialPrompt = method.prompts?.some((prompt) => prompt.key === 'key' || prompt.key === 'token');
  if (hasCredentialPrompt) return method;
  return {
    ...method,
    prompts: [
      { type: 'text', key: 'key', message: t('settings:providers.apiKey'), placeholder: t('settings:providers.pasteApiKey') },
      ...(method.prompts ?? []),
    ],
  };
}

// The methods a provider actually offers for login: server metadata plus the V1
// generic API-key fallback for known key providers.
export function buildEffectiveMethods(
  methods: ProviderAuthMethod[],
  providerId: string | undefined,
  contract: ServerContract,
  t: TFunction,
): ProviderAuthMethod[] {
  const list = [...methods];
  if (contract !== 'v2' && supportsGenericApiKey(providerId) && !list.some((method) => method.type === 'api')) {
    list.push({ type: 'api', label: t('settings:providers.apiKey') });
  }
  return list.map((method) => ensureApiKeyPrompt(method, t));
}

/**
 * Provider credential configuration state machine for Settings.
 * It owns only dialog/UI state; provider requests go
 * through the provider context (`setProviderAuth`, `startProviderOAuth`, ...).
 *
 * The flow is two full-screen steps: pick a login method, then configure it
 * (key form, automatic OAuth wait, or a pairing/authorization-code step).
 */
export function useProviderConfiguration() {
  const { t } = useTranslation();
  const palette = Colors[useColorScheme() ?? 'light'];
  const { availableProviders, providerAuthMethodsById, providerAccounts, setProviderAuth, providerOAuth } = useCapabilities();
  const { connect, serverCapabilities } = useConnection();

  const [selectedProviderId, setSelectedProviderId] = useState<string>();
  const [step, setStep] = useState<ProviderSetupStep>('method');
  const [selectedMethodIndex, setSelectedMethodIndex] = useState(0);
  const [authValues, setAuthValues] = useState<ProviderAuthValues>({});
  const [isConfiguringProvider, setIsConfiguringProvider] = useState(false);
  const [providerDialogError, setProviderDialogError] = useState<string>();
  const [oauthStage, setOAuthStage] = useState<ProviderOAuthStage>('idle');
  const [oauthInstructions, setOAuthInstructions] = useState<string>();
  const [oauthUrl, setOAuthUrl] = useState<string>();
  const [oauthCode, setOAuthCode] = useState('');
  const [oauthError, setOAuthError] = useState<string>();
  const [feedback, setFeedback] = useState<ProviderFeedback>();
  // Invalidates in-flight OAuth completions when the flow is reset or restarted.
  const flowRef = useRef(0);

  const selectedProvider = useMemo(
    () => availableProviders.find((provider) => provider.id === selectedProviderId),
    [availableProviders, selectedProviderId],
  );
  const selectedProviderCopy = useMemo(
    () => (selectedProvider ? getProviderCopy(selectedProvider.id, selectedProvider.label, t) : undefined),
    [selectedProvider, t],
  );
  const effectiveAuthMethods = useMemo(
    () => buildEffectiveMethods(selectedProviderId ? providerAuthMethodsById[selectedProviderId] || [] : [], selectedProviderId, serverCapabilities.contract, t),
    [providerAuthMethodsById, selectedProviderId, serverCapabilities.contract, t],
  );
  const selectedMethod = effectiveAuthMethods[selectedMethodIndex];
  const visiblePrompts = useMemo(
    () =>
      (selectedMethod?.prompts || []).filter((prompt) =>
        (prompt.when ?? []).every((condition) =>
          condition.op === 'eq' ? authValues[condition.key] === condition.value : authValues[condition.key] !== condition.value,
        ),
      ),
    [authValues, selectedMethod],
  );

  const resetProviderDialog = useCallback(() => {
    flowRef.current += 1;
    setSelectedProviderId(undefined);
    setStep('method');
    setSelectedMethodIndex(0);
    setAuthValues({});
    setProviderDialogError(undefined);
    setIsConfiguringProvider(false);
    setOAuthStage('idle');
    setOAuthInstructions(undefined);
    setOAuthUrl(undefined);
    setOAuthCode('');
    setOAuthError(undefined);
  }, []);

  const startProviderConfiguration = useCallback((providerId: string) => {
    const methods = buildEffectiveMethods(providerAuthMethodsById[providerId] || [], providerId, serverCapabilities.contract, t);
    flowRef.current += 1;
    setProviderDialogError(undefined);
    setIsConfiguringProvider(false);
    setOAuthStage('idle');
    setOAuthInstructions(undefined);
    setOAuthUrl(undefined);
    setOAuthCode('');
    setOAuthError(undefined);
    setSelectedProviderId(providerId);
    setSelectedMethodIndex(0);
    setAuthValues(initialAuthValues(methods[0]));
    setStep(methods.length > 1 ? 'method' : 'configure');
  }, [providerAuthMethodsById, serverCapabilities.contract, t]);

  const selectMethod = useCallback((index: number) => {
    setSelectedMethodIndex(index);
    setAuthValues(initialAuthValues(effectiveAuthMethods[index]));
    setOAuthStage('idle');
    setOAuthUrl(undefined);
    setOAuthError(undefined);
    setStep('configure');
  }, [effectiveAuthMethods]);

  const goBack = useCallback(() => {
    if (selectedProviderId) void providerOAuth.cancel(selectedProviderId);
    if (effectiveAuthMethods.length > 1) {
      setStep('method');
      setOAuthStage('idle');
      setProviderDialogError(undefined);
      return;
    }
    resetProviderDialog();
  }, [effectiveAuthMethods.length, providerOAuth, resetProviderDialog, selectedProviderId]);

  const completeOAuthCode = useCallback(async (codeOverride?: string) => {
    if (!selectedProviderId) return;
    const providerId = selectedProviderId;
    const providerLabel = selectedProviderCopy?.label || providerId;
    const flowId = flowRef.current;
    setIsConfiguringProvider(true);
    setOAuthError(undefined);
    try {
      await providerOAuth.complete(providerId, selectedMethodIndex, codeOverride ?? oauthCode);
      if (flowId !== flowRef.current) return;
      setFeedback({ type: 'success', message: t('settings:providers.signInFinished', { provider: providerLabel }) });
      resetProviderDialog();
    } catch (error) {
      if (flowId !== flowRef.current) return;
      setOAuthError(error instanceof Error ? error.message : t('settings:providers.couldNotComplete'));
    } finally {
      if (flowId === flowRef.current) setIsConfiguringProvider(false);
    }
  }, [oauthCode, providerOAuth, resetProviderDialog, selectedMethodIndex, selectedProviderCopy?.label, selectedProviderId, t]);

  const submitProviderConfiguration = useCallback(async () => {
    if (!selectedProviderId || !selectedMethod) return;

    const providerId = selectedProviderId;
    const methodIndex = selectedMethodIndex;
    const providerLabel = selectedProviderCopy?.label || providerId;
    const flowId = flowRef.current;
    setIsConfiguringProvider(true);
    setProviderDialogError(undefined);
    setOAuthError(undefined);

    try {
      if (selectedMethod.type === 'oauth') {
        const authorization = await providerOAuth.start(providerId, methodIndex, authValues);
        if (flowId !== flowRef.current) return;
        const url = authorization.url?.trim();
        setOAuthInstructions(authorization.instructions);
        setOAuthUrl(url || undefined);

        // The server reports one of two modes:
        // - 'code': the provider shows a code after sign-in and expects it back.
        //   A redirect to the app scheme is a bonus, not the expected path, so
        //   the browser must not block the code step.
        if (authorization.method === 'code') {
          if (url) {
            void WebBrowser.openAuthSessionAsync(url, Linking.createURL('')).then((result) => {
              if (flowId !== flowRef.current || result.type !== 'success') return;
              const { code, error } = parseProviderOAuthRedirect(result.url);
              if (error) { setOAuthError(error); return; }
              if (code) void completeOAuthCode(code);
            });
          }
          setOAuthStage('code');
          return;
        }

        // - 'auto': the server completes the exchange (loopback callback or
        //   device/pairing flow). Show the pairing code/instructions and poll;
        //   never ask the user to paste a code back.
        setOAuthStage('pending');
        const waitPromise = providerOAuth.completeAutomatic(providerId);
        if (url) void WebBrowser.openAuthSessionAsync(url, Linking.createURL(''));
        await waitPromise;
        if (flowId !== flowRef.current) return;
        await connect();
        if (flowId !== flowRef.current) return;
        setFeedback({ type: 'success', message: t('settings:providers.signInFinished', { provider: providerLabel }) });
        resetProviderDialog();
        return;
      }

      if (serverCapabilities.contract === 'v2') {
        await providerAccounts.add(providerId, authValues);
      } else {
        await setProviderAuth(providerId, authValues);
      }
      if (flowId !== flowRef.current) return;
      setFeedback({ type: 'success', message: t('settings:providers.configuredSuccess', { provider: providerLabel }) });
      resetProviderDialog();
    } catch (error) {
      if (flowId !== flowRef.current) return;
      setProviderDialogError(error instanceof Error ? error.message : t('settings:providers.couldNotConfigure'));
      setOAuthStage('idle');
    } finally {
      if (flowId === flowRef.current) setIsConfiguringProvider(false);
    }
  }, [
    authValues,
    completeOAuthCode,
    connect,
    providerAccounts,
    providerOAuth,
    resetProviderDialog,
    selectedMethod,
    selectedMethodIndex,
    selectedProviderCopy?.label,
    selectedProviderId,
    serverCapabilities.contract,
    setProviderAuth,
    t,
  ]);

  const closeProviderDialog = useCallback(() => {
    if (selectedProviderId) void providerOAuth.cancel(selectedProviderId);
    resetProviderDialog();
  }, [providerOAuth, resetProviderDialog, selectedProviderId]);

  const handleAuthValueChange = useCallback((key: string, value: string | number | boolean | string[]) => {
    setAuthValues((current) => ({ ...current, [key]: value }));
  }, []);

  const dialog = selectedProvider ? (
    <ProviderConfigDialog
      authValues={authValues}
      error={providerDialogError}
      isConfiguringProvider={isConfiguringProvider}
      methods={effectiveAuthMethods}
      oauthCode={oauthCode}
      oauthError={oauthError}
      oauthInstructions={oauthInstructions}
      oauthStage={oauthStage}
      oauthUrl={oauthUrl}
      onAuthValueChange={handleAuthValueChange}
      onBack={goBack}
      onCancelOAuth={closeProviderDialog}
      onCompleteOAuth={() => void completeOAuthCode()}
      onDismiss={closeProviderDialog}
      onOAuthCodeChange={setOAuthCode}
      onSelectMethod={selectMethod}
      onSubmit={() => void submitProviderConfiguration()}
      palette={palette}
      providerDescription={selectedProviderCopy?.description}
      providerLabel={selectedProviderCopy?.label || selectedProvider.id}
      selectedMethod={selectedMethod}
      selectedMethodIndex={selectedMethodIndex}
      step={step}
      visiblePrompts={visiblePrompts}
    />
  ) : null;

  return {
    dialog,
    feedback,
    setFeedback,
    clearFeedback: useCallback(() => setFeedback(undefined), []),
    startProviderConfiguration,
  };
}
