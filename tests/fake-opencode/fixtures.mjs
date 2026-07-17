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

export function commandsPayload() {
  return [
    {
      name: 'review',
      description: 'Review the current workspace',
      source: 'command',
      template: 'Review $ARGUMENTS',
      hints: ['scope'],
    },
    {
      name: 'test',
      description: 'Run deterministic tests',
      source: 'command',
      template: 'Test $ARGUMENTS',
      hints: ['target'],
    },
  ];
}

export function diagnosticsPayload() {
  return {
    formatter: [{ name: 'prettier', extensions: ['.ts', '.tsx', '.md'], enabled: true }],
    lsp: [{ id: 'typescript', name: 'TypeScript', root: '/workspace/demo-project', status: 'connected' }],
    mcp: { filesystem: { status: 'connected' } },
  };
}

export function fileStatusesPayload() {
  return [{ path: 'src/demo.ts', added: 2, removed: 1, status: 'modified' }];
}

export function vcsPayload() {
  return { branch: 'main', default_branch: 'main' };
}
