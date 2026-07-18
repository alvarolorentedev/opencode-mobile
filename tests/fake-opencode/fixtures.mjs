export function listProvidersPayload(state) {
  return {
    all: [
      {
        id: 'openai',
        name: 'OpenAI',
        models: {
          'gpt-4.1-mini': {
            id: 'gpt-4.1-mini',
            name: 'GPT-4.1 mini',
            capabilities: {
              attachment: true,
              reasoning: true,
              temperature: true,
              toolcall: true,
              input: { text: true, audio: false, image: true, video: false, pdf: true },
              output: { text: true, audio: false, image: false, video: false, pdf: false },
              interleaved: false,
            },
            limit: { context: 1047576, output: 32768 },
          },
        },
      },
      {
        id: 'openrouter',
        name: 'OpenRouter',
        models: {
          'openrouter/auto': {
            id: 'openrouter/auto',
            name: 'Auto',
            capabilities: {
              attachment: false,
              reasoning: false,
              temperature: true,
              toolcall: true,
              input: { text: true, audio: false, image: false, video: false, pdf: false },
              output: { text: true, audio: false, image: false, video: false, pdf: false },
              interleaved: false,
            },
            limit: { context: 200000, output: 16384 },
          },
        },
      },
    ],
    default: { openai: 'gpt-4.1-mini', openrouter: 'openrouter/auto' },
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
    openrouter: [{ type: 'api', label: 'API key' }],
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

export function fileStatusesPayload(state) {
  return [
    { path: 'src/demo.ts', added: 2, removed: 1, status: 'modified' },
    ...(state.workspaceTaskCompleted
      ? [{ path: 'app/(tabs)/index.tsx', added: 6, removed: 1, status: 'modified' }]
      : []),
  ];
}

export function vcsPayload() {
  return { branch: 'main', default_branch: 'main' };
}
