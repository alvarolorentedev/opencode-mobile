import path from 'node:path';
import { parse } from 'jsonc-parser/lib/umd/main.js';
import { parseDocument } from 'yaml';

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
  const directories = new Set([root, project, path.posix.join(project, '.opencode'), path.posix.join(root, 'skills'), path.posix.join(project, '.opencode/skills')]);
  return {
    root,
    project,
    files,
    directories,
    symlinks: new Set(),
    baseCommands: [{ name: 'review', description: 'Review code' }],
    nextShellId: 1,
  };
}

function markdown(text) {
  const match = String(text || '').match(/^(?:\uFEFF)?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) return { data: {}, body: String(text || '') };
  try {
    const doc = parseDocument(match[1], { schema: 'core', uniqueKeys: true });
    if (doc.errors.length) return { data: {}, body: String(text || '') };
    return { data: (doc.toJS({ maxAliasCount: 0 }) || {}), body: String(text || '').slice(match[0].length) };
  } catch {
    return { data: {}, body: String(text || '') };
  }
}

function markdownName(root, file) {
  return file.slice(root.length + 1).replace(/\.md$/, '').replaceAll('\\', '/');
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
  const applyFiles = (root) => {
    for (const [file, content] of state.extensions.files) {
      if (!file.startsWith(`${root}/`) || !file.endsWith('.md')) continue;
      const name = markdownName(root, file);
      const parsed = markdown(content);
      rows.set(name, { name, description: parsed.data.description, template: parsed.body.trim() });
    }
  };
  applyFiles(path.posix.join(state.extensions.root, 'command'));
  applyFiles(path.posix.join(state.extensions.root, 'commands'));
  if (inProject) {
    for (const [name, command] of Object.entries(commandMap(project))) rows.set(name, { name, description: command?.description });
  }
  applyFiles(path.posix.join(state.extensions.project, '.opencode/command'));
  applyFiles(path.posix.join(state.extensions.project, '.opencode/commands'));
  return [...rows.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function extensionAgents(state, directory) {
  const { global, project, inProject } = configForScope(state, directory);
  const rows = new Map();
  const builtins = [
    { id: 'build', name: 'build', mode: 'primary', hidden: false, permissions: [] },
    { id: 'plan', name: 'plan', mode: 'primary', hidden: false, permissions: [] },
    ...['summary', 'title', 'compaction'].map((id) => ({ id, name: id, mode: 'primary', hidden: true, permissions: [] })),
    { id: 'general', name: 'general', mode: 'subagent', hidden: false, permissions: [], description: 'Delegate a focused task.' },
    { id: 'explore', name: 'explore', mode: 'subagent', hidden: false, permissions: [], description: 'Search the codebase.' },
  ];
  for (const row of builtins) rows.set(row.id, row);
  const applyConfig = (config) => {
    const agents = config?.agents && typeof config.agents === 'object' && !Array.isArray(config.agents) ? config.agents : {};
    for (const [id, value] of Object.entries(agents)) {
      if (value?.disabled === true) { rows.delete(id); continue; }
      const current = rows.get(id) || { id, name: id, mode: 'all', hidden: false, permissions: [] };
      rows.set(id, {
        ...current,
        ...(typeof value?.description === 'string' ? { description: value.description } : {}),
        ...(value?.mode ? { mode: value.mode } : {}),
        ...(typeof value?.hidden === 'boolean' ? { hidden: value.hidden } : {}),
        ...(value?.system !== undefined ? { system: value.system } : {}),
        ...(value?.permissions !== undefined ? { permissions: value.permissions } : {}),
        ...(value?.model ? { model: normalizeModel(value.model) } : {}),
      });
    }
  };
  const applyFiles = (root, recursive) => {
    for (const [file, content] of state.extensions.files) {
      if (!file.startsWith(`${root}/`) || !file.endsWith('.md')) continue;
      const relative = file.slice(root.length + 1);
      if (!recursive && relative.includes('/')) continue;
      const id = markdownName(root, file);
      const parsed = markdown(content);
      if (parsed.data.disabled === true) { rows.delete(id); continue; }
      rows.set(id, {
        id,
        name: id,
        mode: 'primary',
        hidden: parsed.data.hidden === true,
        permissions: [],
        ...(parsed.data.description ? { description: parsed.data.description } : {}),
        ...(parsed.data.mode ? { mode: parsed.data.mode } : {}),
        ...(parsed.data.model ? { model: normalizeModel(parsed.data.model) } : {}),
        system: parsed.body.trim(),
      });
    }
  };
  applyConfig(global);
  for (const dir of ['agents', 'agent', 'modes', 'mode']) applyFiles(path.posix.join(state.extensions.root, dir), dir === 'agents' || dir === 'agent');
  if (inProject) {
    applyConfig(project);
    for (const dir of ['agents', 'agent', 'modes', 'mode']) applyFiles(path.posix.join(state.extensions.project, '.opencode', dir), dir === 'agents' || dir === 'agent');
  }
  return [...rows.values()].sort((a, b) => a.id.localeCompare(b.id));
}

function normalizeModel(value) {
  if (typeof value === 'string') {
    const slash = value.indexOf('/');
    const providerID = value.slice(0, slash);
    const rest = value.slice(slash + 1);
    if (slash <= 0 || !rest) return undefined;
    const [id, variant] = rest.split('#');
    return { providerID, id, ...(variant ? { variant } : {}) };
  }
  if (value && typeof value === 'object' && typeof value.providerID === 'string' && typeof value.model === 'string') {
    return { providerID: value.providerID, id: value.model, ...(value.variant ? { variant: value.variant } : {}) };
  }
  return undefined;
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
  let parent = path.posix.dirname(file);
  while (parent && parent !== '/') {
    state.extensions.directories.add(parent);
    if (parent === state.extensions.root || parent === state.extensions.project) break;
    parent = path.posix.dirname(parent);
  }
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
    const directory = state.extensions.directories.has(file) || [...state.extensions.files.keys()].some((item) => item.startsWith(`${file}/`));
    const exists = state.extensions.files.has(file) || directory || state.extensions.symlinks.has(file);
    if (option === '-e' || option === '-r') return exists ? ok() : fail();
    if (option === '-d') return directory ? ok() : fail();
    if (option === '-f') return state.extensions.files.has(file) ? ok() : fail();
    if (option === '-w' || option === '-x') return ok();
    if (option === '-L') return state.extensions.symlinks.has(file) ? ok() : fail();
    return fail();
  }
  if (command.startsWith('find ')) {
    const root = values[0];
    if (!state.extensions.directories.has(root) && ![...state.extensions.files.keys()].some((item) => item.startsWith(`${root}/`))) return fail('No such directory');
    const type = command.match(/-type (f|l)/)?.[1];
    const markdownOnly = command.includes("-name '*.md'");
    const entries = [...state.extensions.files.keys()]
      .filter((file) => file.startsWith(`${root}/`))
      .filter((file) => !markdownOnly || file.endsWith('.md'))
      .filter((file) => type === 'l' ? state.extensions.symlinks.has(file) : type === 'f' ? !state.extensions.symlinks.has(file) : true)
      .sort();
    return ok(entries.join('\n') + (entries.length ? '\n' : ''));
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
  if (command.startsWith('chmod ')) return ok();
  if (command.startsWith('mkdir ')) {
    let parent = values[0];
    while (parent && parent !== '/') {
      state.extensions.directories.add(parent);
      parent = path.posix.dirname(parent);
    }
    return ok();
  }
  if (command.startsWith('rm ')) {
    state.extensions.files.delete(values[0]);
    for (const file of [...state.extensions.files.keys()]) {
      if (file.startsWith(`${values[0]}/`)) state.extensions.files.delete(file);
    }
    state.extensions.directories.delete(values[0]);
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
