import { createState as createNativeState } from './state.mjs';
const now = () => Date.now();

export function getNow() {
  return now();
}

export function resolveProject(state, directory) {
  if (!directory) return state.project;
  const worktree = state.worktrees.find((entry) => entry.directory === directory);
  if (worktree) return state.projects.find((entry) => entry.id === worktree.projectID);
  const existing = state.projects.find((project) => project.worktree === directory);
  if (existing) return existing;
  if (!directory.startsWith(`${state.rootPath}/`)) return undefined;
  const project = {
    id: `project-added-${state.projects.length}`,
    worktree: directory,
    time: { created: now(), initialized: now(), updated: now() },
    sandboxes: [],
  };
  state.projects.push(project);
  return project;
}

// Legacy wire fixtures are projected only at this compatibility boundary.
export function createState(scenario) {
  const state = createNativeState(scenario);
  const projects = state.projects.map(({ canonical, ...project }) => ({ ...project, worktree: canonical, time: { ...project.time, initialized: project.time.updated } }));
  const { providers, agents, permissions, mcp, ...config } = state.config;
  return {
    ...state, projects, project: projects[0],
    mcpRuntimeConfigs: Object.fromEntries(Object.entries(state.mcpRuntimeConfigs).map(([name, { disabled, ...entry }]) => [name, { ...entry, enabled: !disabled }])),
    config: {
      ...config, provider: providers, agent: agents, enabled_providers: ['openai'],
      permission: Object.fromEntries(['edit', 'bash', 'webfetch', 'doom_loop', 'external_directory'].map((name) => [name, permissions[0].effect])),
      mcp: Object.fromEntries(Object.entries(mcp.servers).map(([name, { disabled, ...entry }]) => [name, { ...entry, enabled: !disabled }])),
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
