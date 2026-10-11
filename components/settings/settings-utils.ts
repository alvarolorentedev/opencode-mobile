import type { TFunction } from 'i18next';

import { SUPPORTED_LANGUAGES } from '@/lib/i18n/languages';
import type { ServerContract } from '@/lib/opencode/client';
import type { ProviderAuthMethod } from '@/lib/opencode/types';
import type { WorkingSoundVariant } from '@/lib/voice/working-sound';
import { UPDATE_CHECK_PERIODS, type UpdateCheckPeriod } from '@/providers/app-update-policy';
import type { ProviderOption, ResponseScope } from '@/providers/opencode-provider';

export const RESPONSE_SCOPE_OPTIONS: { value: ResponseScope }[] = [
  { value: 'brief' },
  { value: 'balanced' },
  { value: 'detailed' },
];

export const WORKING_SOUND_OPTIONS: { value: WorkingSoundVariant }[] = [
  { value: 'soft' },
  { value: 'glass' },
];

export const UPDATE_CHECK_PERIOD_OPTIONS: { value: UpdateCheckPeriod }[] = UPDATE_CHECK_PERIODS.map((value) => ({ value }));

export const LANGUAGE_OPTIONS: { value: string; label: string }[] = SUPPORTED_LANGUAGES.map((language) => ({ value: language.code, label: language.nativeName }));

// Curated copy is independent of credential support. V1 providers offer
// API-key entry alongside auth metadata, except known OAuth-only providers.
const PROVIDER_DESCRIPTORS = new Map<string, { genericApiKey: boolean }>([
  ['anthropic', { genericApiKey: true }],
  ['azure', { genericApiKey: true }],
  ['github-copilot', { genericApiKey: false }],
  ['google', { genericApiKey: true }],
  ['groq', { genericApiKey: true }],
  ['mistral', { genericApiKey: true }],
  ['openai', { genericApiKey: true }],
  ['openrouter', { genericApiKey: true }],
  ['xai', { genericApiKey: true }],
]);

export function supportsGenericApiKey(providerId?: string) {
  return Boolean(providerId && (PROVIDER_DESCRIPTORS.get(providerId)?.genericApiKey ?? true));
}

export function getProviderCopy(providerId: string, fallbackLabel: string, t: TFunction) {
  if (!PROVIDER_DESCRIPTORS.has(providerId)) {
    return {
      label: fallbackLabel,
      description: undefined,
    };
  }

  return {
    label: t(`settings:providerCopy.${providerId}.label`),
    description: t(`settings:providerCopy.${providerId}.description`),
  };
}

// A provider can be configured when the server exposes an interactive login
// method or, on V1, when the app may fall back to a plain API key. Providers
// that only offer environment/command methods are excluded.
export function hasConfigurableAuth(
  providerId: string,
  methods: ProviderAuthMethod[] | undefined,
  contract: ServerContract,
) {
  if (methods && methods.length > 0) {
    return true;
  }
  return contract !== 'v2' && supportsGenericApiKey(providerId);
}

// The "Add provider" list: every provider the user can log in to, whether or
// not it already has an account. Configured providers stay selectable so a
// second account (another login) can be added for any provider that exposes an
// interactive login method.
export function getAddableProviders(
  availableProviders: ProviderOption[],
  providerAuthMethodsById: Record<string, ProviderAuthMethod[]>,
  contract: ServerContract,
) {
  return availableProviders.filter(
    (provider) => hasConfigurableAuth(provider.id, providerAuthMethodsById[provider.id], contract),
  );
}
