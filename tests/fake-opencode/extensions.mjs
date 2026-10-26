import path from 'node:path';
import { parse } from 'jsonc-parser/lib/umd/main.js';

const GLOBAL_CONFIG = 'opencode.jsonc';
const PROJECT_CONFIG = 'opencode.jsonc';

function parseConfig(text) {
  const errors = [];
  const value = parse(text || '{}', errors, { allowTrailingComma: true });
  return errors.length || !value || typeof value !== 'object' || Array.isArray(value) ? {} : value;
}

function configText(config) {
  return `${JSON.stringify(config, null, 2)}\n`;
}

function skillName(content, id) {
  const name = content.match(/^name:\s*"?([^"\n]+)"?/m)?.[1]?.trim();
  const description = content.match(/^description:\s*"?([^"\n]+)"?/m)?.[1]?.trim();
  return { name: name || id, description };
}

export function createExtensionState(state) {
  const root = state.rootPath;
  const project = state.project.canonical;
  const files = new Map();
  files.set(path.posix.join(root, GLOBAL_CONFIG), configText(state.config));
  files.set(path.posix.join(project, '.opencode/skills/opencode/SKILL.md'), '---\nname: opencode\ndescription: Use this skill for any question about OpenCode.\n---\n\nOpenCode skill fixture.\n');
  files.set(path.posix.join(project, '.opencode/skills/report/SKILL.md'), '---\nname: report\ndescription: Use when the user wants to report an OpenCode issue.\n---\n\nReport skill fixture.\n');
  return {
    root,
    project,
    files,
    baseCommands: [{ name: 'review', description: 'Review code' }],
    nextShellId: 1,
  };
}

function readText(state, file) {
  return state.extensions.files.get(file);
}

function isInside(root, value) {
  return value === root || value.startsWith(`${root}/`);
}

function configForScope(state, directory) {
  const globalPath = path.posix.join(state.extensions.root, GLOBAL_CONFIG);
  const projectPath = path.posix.join(state.extensions.project, PROJECT_CONFIG);
  const global = parseConfig(readText(state, globalPath));
  const project = parseConfig(readText(state, projectPath));
  const inProject = directory && isInside(state.extensions.project, directory);
  return { globalPath, projectPath, global, project, inProject };
}

export function configEntries(state, directory) {
  const { globalPath, projectPath, global, project, inProject } = configForScope(state, directory);
  const entries = [
    { type: 'directory', path: state.rootPath },
    { type: 'document', path: globalPath, info: global },
  ];
  if (inProject) {
    entries.push({ type: 'directory', path: path.posix.join(state.extensions.project, '.opencode') });
    if (readText(state, projectPath) !== undefined) entries.push({ type: 'document', path: projectPath, info: project });
  }
  return entries;
}

function configServerMap(config) {
  const servers = config?.mcp?.servers;
  return servers && typeof servers === 'object' && !Array.isArray(servers) ? servers : {};
}

function commandMap(config) {
  const commands = config?.commands;
  return commands && typeof commands === 'object' && !Array.isArray(commands) ? commands : {};
}

function pluginTargets(config) {
  return Array.isArray(config?.plugins)
    ? config.plugins.flatMap((entry) => {
      if (typeof entry === 'string') return entry.startsWith('-') ? [] : [entry];
      return typeof entry?.package === 'string' ? [entry.package] : [];
    })
    : [];
}

export function extensionSkills(state, directory) {
  const inProject = directory && isInside(state.extensions.project, directory);
  const roots = [path.posix.join(state.extensions.root, 'skills')];
  if (inProject) roots.push(path.posix.join(state.extensions.project, '.opencode/skills'));
  return [...state.extensions.files.entries()]
    .flatMap(([file, content]) => {
      const root = roots.find((candidate) => file.startsWith(`${candidate}/`));
      if (!root || !file.endsWith('/SKILL.md')) return [];
      const id = file.slice(root.length + 1).split('/')[0];
      return [{ id, ...skillName(content, id), autoinvoke: true, path: file, content }];
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}

export function extensionCommands(state, directory) {
  const { global, project, inProject } = configForScope(state, directory);
  const rows = new Map(state.extensions.baseCommands.map((command) => [command.name, command]));
  for (const [name, command] of Object.entries(commandMap(global))) rows.set(name, { name, description: command?.description });
  if (inProject) {
    for (const [name, command] of Object.entries(commandMap(project))) rows.set(name, { name, description: command?.description });
  }
  return [...rows.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function extensionPlugins(state, directory) {
  const { global, project, inProject } = configForScope(state, directory);
  const targets = new Map();
  for (const target of pluginTargets(global)) targets.set(target, target);
  if (inProject) for (const target of pluginTargets(project)) targets.set(target, target);
  return [...targets.keys()].map((target) => ({
    id: target,
    source: { type: 'package', target, version: '1.0.0' },
    state: { status: 'active' },
  }));
}

function updateRuntimeMcp(state) {
  const { global, project } = configForScope(state, state.extensions.project);
  const servers = { ...configServerMap(global), ...configServerMap(project) };
  for (const [name, config] of Object.entries(servers)) {
    state.mcpRuntimeConfigs[name] = config;
    state.mcpStatuses[name] = config?.type === 'remote' && config.oauth !== false && !config.disabled
      ? { status: 'needs_auth', error: 'Authentication required' }
      : { status: config?.disabled ? 'disabled' : 'connected' };
  }
  for (const name of Object.keys(state.mcpRuntimeConfigs)) {
    if (!(name in servers)) {
      delete state.mcpRuntimeConfigs[name];
      delete state.mcpStatuses[name];
    }
  }
}

export function writeExtensionFile(state, file, content) {
  state.extensions.files.set(file, content);
  if (file.endsWith(GLOBAL_CONFIG) || file.endsWith(PROJECT_CONFIG)) updateRuntimeMcp(state);
}

export function readExtensionFile(state, file) {
  return state.extensions.files.get(file);
}

function args(command) {
  return [...command.matchAll(/'([^']*)'/g)].map((match) => match[1]);
}

export function runFakeShell(state, root, command) {
  const values = args(command);
  const ok = (output = '') => ({ output, exit: 0, status: 'exited' });
  const fail = (output = '') => ({ output, exit: 1, status: 'exited' });
  if (command === 'true') return ok();
  if (command.startsWith('test ')) {
    const option = command.split(' ')[1];
    const file = values[0];
    const exists = state.extensions.files.has(file);
    if (option === '-e' || option === '-r') return exists ? ok() : fail();
    if (option === '-w') return ok();
    if (option === '-L') return fail();
    return fail();
  }
  if (command.startsWith('cat ')) {
    const value = state.extensions.files.get(values[0]);
    return value === undefined ? fail('No such file') : ok(value);
  }
  if (command.startsWith('cp -p ')) {
    const value = state.extensions.files.get(values[0]);
    if (value === undefined) return fail('No such file');
    state.extensions.files.set(values[1], value);
    return ok();
  }
  if (command.startsWith('mv ')) {
    const source = values[0];
    const destination = values[1];
    const value = state.extensions.files.get(source);
    if (value !== undefined) {
      state.extensions.files.delete(source);
      state.extensions.files.set(destination, value);
    } else {
      const prefix = `${source}/`;
      const children = [...state.extensions.files.entries()].filter(([file]) => file.startsWith(prefix));
      if (children.length === 0) return fail('No such file');
      for (const [file, child] of children) {
        state.extensions.files.delete(file);
        state.extensions.files.set(`${destination}/${file.slice(prefix.length)}`, child);
      }
    }
    if (destination.endsWith(GLOBAL_CONFIG) || destination.endsWith(PROJECT_CONFIG) || destination.endsWith('SKILL.md')) updateRuntimeMcp(state);
    return ok();
  }
  if (command.startsWith('chmod ') || command.startsWith('mkdir ')) return ok();
  if (command.startsWith('rm ')) {
    state.extensions.files.delete(values[0]);
    return ok();
  }
  return fail(`Unsupported fake shell command: ${command}`);
}

export function shellInfo(state, root, command, result) {
  return {
    id: `sh_${state.extensions.nextShellId++}`,
    status: result.status,
    command,
    cwd: root,
    shell: '/bin/bash',
    file: '/tmp/fake-shell-output',
    exit: result.exit,
    metadata: {},
    time: { started: Date.now(), completed: Date.now() },
    output: result.output,
  };
}
