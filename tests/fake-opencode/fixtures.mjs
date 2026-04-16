export function listProvidersPayload(state) {
  return {
    all: [
      {
        id: 'openai',
        name: 'OpenAI',
        models: {
          'gpt-4.1-mini': { id: 'gpt-4.1-mini', name: 'GPT-4.1 mini', reasoning: true },
        },
      },
      {
        id: 'openrouter',
        name: 'OpenRouter',
        models: {
          'openrouter/auto': { id: 'openrouter/auto', name: 'Auto', reasoning: false },
        },
      },
    ],
    connected: [...state.configuredProviderIds].sort(),
  };
}

export function providerAuthPayload() {
  return {
    openai: [
      {
        type: 'oauth',
        label: 'Sign in',
        prompts: [],
      },
    ],
    openrouter: [],
  };
}
