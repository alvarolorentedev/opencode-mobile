const now = () => Date.now();

export function getNow() {
  return now();
}

export function resolveProject(state, directory) {
  if (!directory) return state.project;
  const worktree = state.worktrees.find((entry) => entry.directory === directory);
  if (worktree) return state.projects.find((entry) => entry.id === worktree.projectID);
  const existing = state.projects.find((project) => (project.canonical || project.worktree) === directory);
  if (existing) return existing;
  if (!directory.startsWith(`${state.rootPath}/`)) return undefined;
  const project = {
    id: `project-added-${state.projects.length}`,
    canonical: directory,
    time: { created: now(), updated: now() },
    sandboxes: [],
  };
  state.projects.push(project);
  return project;
}

export function createState(scenario) {
  const rootPath = '/workspace';
  const projectPath = '/workspace/demo-project';
  const project = {
    id: 'project-demo',
    canonical: projectPath,
    time: {
      created: now() - 60_000,
      updated: now() - 30_000,
    },
    sandboxes: [],
  };
  const secondaryProject = {
    ...project,
    id: 'project-secondary',
    canonical: '/workspace/secondary-project',
  };

  return {
    scenario,
    rootPath,
    project,
    projects: [project, secondaryProject],
    nextSessionId: 1,
    nextMessageId: 1,
    nextPendingId: 1,
    nextPtyId: 1,
    nextWorktreeId: 1,
    nextEventId: 1,
    sseClients: new Set(),
    completionTimers: new Set(),
    workspaceTaskCompleted: false,
    sessions: [],
    messagesBySession: {},
    inboxBySession: {},
    activePromptBySession: {},
    sessionInitializations: {},
    sessionStatuses: {},
    instructionsBySession: {},
    todosBySession: {},
    pendingPermissions: [],
    pendingQuestions: [],
    ptys: [],
    worktrees: [],
    mcpStatuses: { filesystem: { status: 'connected' } },
    mcpRuntimeConfigs: { filesystem: { type: 'local', command: ['fake-filesystem'], disabled: false } },
    mcpOauth: {},
    configuredProviderIds: new Set(['openai']),
    // V2 stores credentials as labeled accounts; openai starts with two so
    // account switching/removal is exercised.
    credentials: [
      { id: 'credential-openai', integrationID: 'openai', label: 'Work', active: true, value: { type: 'key', key: 'sk-openai-work' } },
      { id: 'credential-openai-2', integrationID: 'openai', label: 'Personal', active: false, value: { type: 'key', key: 'sk-openai-personal' } },
    ],
    config: {
      model: 'openai/gpt-4.1-mini', providers: { openai: {} },
      permissions: [{ action: '*', resource: '*', effect: 'ask' }],
      agents: { build: {}, general: {} },
      mcp: { servers: { filesystem: { type: 'local', command: ['fake-filesystem'], disabled: false } } },
    },
    diffsByTurn: {},
    integrationAttempts: {},
    authByProvider: {},
    filesByDirectory: {},
    files: {
      'app/(tabs)/index.tsx': 'export default function ChatLandingScreen() {\n  return null;\n}\n',
      'assets/binary.dat': '\0binary',
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
