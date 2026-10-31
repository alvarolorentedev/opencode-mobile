import type { Config, ProviderAuthMethod, ProviderAuthValues } from '@/shared/protocol/opencode/types';

import type { AgentOption, ModelOption } from '@/shared/contracts/model-options';

// A stored provider credential. V2 integrations can hold several labeled
// accounts (exactly one active); V1 providers have no account list.
export type ProviderAccount = {
  id: string;
  label: string;
  method: 'key' | 'oauth';
  active: boolean;
};

export type ProviderOption = {
  id: string;
  label: string;
  configured: boolean;
  accounts?: ProviderAccount[];
};

export type CapabilitiesContextValue = {
  currentConfig?: Config;
  availableProviders: ProviderOption[];
  providerAuthMethodsById: Record<string, ProviderAuthMethod[]>;
  configuredProviders: ProviderOption[];
  availableModels: ModelOption[];
  availableAgents: AgentOption[];
  setProviderAuth: (providerId: string, values: ProviderAuthValues) => Promise<void>;
  removeProvider: (providerId: string) => Promise<void>;
  // Grouped so the capabilities context grows one member, not one per action.
  providerOAuth: {
    start: (providerId: string, methodIndex: number, inputs?: ProviderAuthValues) => Promise<{ url: string; instructions?: string; method: 'auto' | 'code' }>;
    complete: (providerId: string, methodIndex: number, code: string) => Promise<void>;
    completeAutomatic: (providerId: string) => Promise<void>;
    cancel: (providerId: string) => Promise<void>;
  };
  providerAccounts: {
    add: (providerId: string, values: ProviderAuthValues, label?: string) => Promise<void>;
    activate: (credentialId: string) => Promise<void>;
    remove: (credentialId: string) => Promise<void>;
  };
  // Classifier readiness for auto model routing. A missing local model or an
  // unsupported OpenCode endpoint makes the composer option unavailable.
  modelRouting: {
    available: boolean;
    serverStatus: import('@/features/ai/services/model-routing-service').ServerClassifierStatus;
    checkServerClassifier: (modelId?: string) => Promise<import('@/features/ai/services/model-routing-service').ServerClassifierStatus>;
    resetServerClassifier: () => void;
    refreshAvailability: () => void;
  };
};
