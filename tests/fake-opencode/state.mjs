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
    sseClients: new Set(),
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
      state = createState(nextScenario);
      return state;
    },
    setState(nextState) {
      state = nextState;
      return state;
    },
  };
}
