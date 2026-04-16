import type { WorkingSoundVariant } from '@/lib/voice/working-sound';
import type { ResponseScope } from '@/providers/opencode-provider';

export const RESPONSE_SCOPE_OPTIONS: { value: ResponseScope; label: string; description: string }[] = [
  { value: 'brief', label: 'Brief', description: 'Short, tightly scoped answers for natural back-and-forth.' },
  { value: 'balanced', label: 'Balanced', description: 'Concise answers with a little more context when helpful.' },
  { value: 'detailed', label: 'Detailed', description: 'Longer explanations and more supporting detail.' },
];

export const WORKING_SOUND_OPTIONS: { value: WorkingSoundVariant; label: string; description: string }[] = [
  { value: 'soft', label: 'Soft chime', description: 'Warm layered tone with a gentle pulse.' },
  { value: 'glass', label: 'Glass tone', description: 'Brighter, lighter ambient loop.' },
];

const KNOWN_PROVIDER_COPY: Record<string, { label: string; description: string }> = {
  openai: {
    label: 'OpenAI',
    description: 'GPT models from OpenAI, including the newest reasoning and multimodal options.',
  },
  anthropic: {
    label: 'Anthropic',
    description: 'Claude models from Anthropic for coding, analysis, and long-context work.',
  },
  'github-copilot': {
    label: 'GitHub Copilot',
    description: 'Use your GitHub Copilot access to sign in and enable supported foundation models.',
  },
  google: {
    label: 'Google',
    description: 'Gemini models from Google for multimodal and large-context tasks.',
  },
  groq: {
    label: 'Groq',
    description: 'Fast hosted inference for supported open and frontier models.',
  },
  openrouter: {
    label: 'OpenRouter',
    description: 'Route requests across multiple providers and model families from one account.',
  },
  mistral: {
    label: 'Mistral',
    description: 'Mistral AI hosted models for general-purpose and coding workloads.',
  },
  xai: {
    label: 'xAI',
    description: 'Grok models from xAI.',
  },
  azure: {
    label: 'Azure OpenAI',
    description: 'OpenAI-compatible models deployed through Azure.',
  },
};

const KNOWN_OAUTH_PROVIDER_IDS = new Set(['openai', 'github-copilot', 'github_copilot', 'anthropic']);

export function getProviderCopy(providerId: string, fallbackLabel: string) {
  const copy = KNOWN_PROVIDER_COPY[providerId];
  return {
    label: copy?.label || fallbackLabel,
    description: copy?.description,
  };
}

export function shouldUseGenericApiFallback(providerId: string, authMethodsCount: number) {
  if (authMethodsCount > 0) {
    return false;
  }

  return !KNOWN_OAUTH_PROVIDER_IDS.has(providerId);
}
