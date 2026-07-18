const now = () => Date.now();

export function getNow() {
  return now();
}

export function createState(scenario) {
  const rootPath = '/workspace';
  const projectPath = '/workspace/demo-project';
  const project = {
    id: 'project-demo',
    worktree: projectPath,
    time: {
      created: now() - 60_000,
      initialized: now() - 30_000,
    },
  };

  return {
    scenario,
    rootPath,
    project,
    nextSessionId: 1,
    nextMessageId: 1,
    nextPendingId: 1,
    nextEventId: 1,
    sseClients: new Set(),
    completionTimers: new Set(),
    sessions: [],
    messagesBySession: {},
    sessionStatuses: {},
    diffsBySession: {},
    todosBySession: {},
    pendingPermissions: [],
    pendingQuestions: [],
    configuredProviderIds: new Set(['openai']),
    config: {
      model: 'openai/gpt-4.1-mini',
      enabled_providers: ['openai'],
      permission: {
        edit: 'ask',
        bash: 'ask',
        webfetch: 'ask',
        doom_loop: 'ask',
        external_directory: 'ask',
      },
      provider: {},
      agent: {
        build: {},
        general: {},
      },
    },
    authByProvider: {},
    files: {
      'README.md': '# Demo project\n\nDeterministic fake OpenCode workspace.\n',
      'src/demo.ts': 'export const demo = "OpenCode 1.18.3";\n',
      'src/feature.ts': 'export function feature() {\n  return true;\n}\n',
    },
  };
}

export function createStateStore(initialScenario) {
  let state = createState(initialScenario);

  return {
    getState() {
      return state;
    },
    resetState(nextScenario) {
      for (const client of state.sseClients) {
        client.end();
      }
      for (const timer of state.completionTimers) {
        clearTimeout(timer);
      }
      state = createState(nextScenario);
      return state;
    },
  };
}
