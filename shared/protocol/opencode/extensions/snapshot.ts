import type { Command, McpStatus } from '@/shared/protocol/opencode/types';
import { pluginTarget, readAgents, readCommands, readMcpServers, readPlugins } from '@/shared/protocol/opencode/extensions/jsonc';
import { configDocuments, sourceForPath } from '@/shared/protocol/opencode/extensions/scope';
import { parseAgentMarkdown, parseCommandMarkdown } from '@/shared/protocol/opencode/extensions/markdown';
import type { ConfigEntry, ExtensionAgentRow, ExtensionCommandRow, ExtensionMarkdownFile, ExtensionMcpRow, ExtensionPluginRow, ExtensionRows, ExtensionSkillRow, RawAgentInfo, RawPluginInfo, RawSkillInfo } from '@/shared/protocol/opencode/extensions/types';

type BuildInput = {
  entries: ConfigEntry[];
  projectRoot?: string;
  globalRoot?: string;
  mcpStatuses: Record<string, McpStatus>;
  plugins: RawPluginInfo[];
  skills: RawSkillInfo[];
  commands: Command[];
  agents: RawAgentInfo[];
  commandFiles: ExtensionMarkdownFile[];
  agentFiles: ExtensionMarkdownFile[];
  generalWritable: boolean;
  projectWritable: boolean;
  generalAgentWritable: boolean;
  projectAgentWritable: boolean;
  generalCommandWritable: boolean;
  projectCommandWritable: boolean;
};

/**
 * V2 command listings expose only names and descriptions, not provenance.
 * These descriptions mirror the server's built-in command plugin so the
 * built-in rows can be classified as system entries. Config-backed commands
 * are added first and take precedence, so user overrides stay manageable.
 */
const BUILTIN_COMMANDS = new Map([
  ['init', 'guided AGENTS.md setup'],
  ['review', 'review changes [commit|branch|pr], defaults to uncommitted'],
]);

function isBuiltinCommand(command: Command) {
  const description = BUILTIN_COMMANDS.get(command.name);
  return description !== undefined && command.description === description;
}

function sourceWritable(source: string, generalWritable: boolean, projectWritable: boolean) {
  if (source === 'general') return generalWritable;
  if (source === 'project') return projectWritable;
  return false;
}

function byLabel<T>(items: T[], label: (item: T) => string) {
  return [...items].sort((a, b) => label(a).localeCompare(label(b)));
}

function mcpRows({ entries, projectRoot, globalRoot, mcpStatuses, generalWritable, projectWritable }: BuildInput) {
  const rows = new Map<string, ExtensionMcpRow>();
  const configEntries = configDocuments(entries);
  for (const document of configEntries) {
    const source = sourceForPath(document.path, projectRoot, globalRoot);
    const servers = readMcpServers(document.info as Record<string, unknown>);
    for (const [name, config] of Object.entries(servers)) {
      rows.set(`${source}:${name}`, {
        key: `${source}:${name}`,
        name,
        config: config as Record<string, unknown>,
        status: mcpStatuses[name],
        source,
        editable: sourceWritable(source, generalWritable, projectWritable),
        removeMode: source === 'general' || source === 'project' ? 'config' : 'none',
      });
    }
  }
  for (const [name, status] of Object.entries(mcpStatuses)) {
    if ([...rows.values()].some((row) => row.name === name)) continue;
    rows.set(`runtime:${name}`, {
      key: `runtime:${name}`,
      name,
      status,
      source: 'runtime',
      editable: false,
      removeMode: 'runtime',
    });
  }
  return byLabel([...rows.values()], (row) => row.name);
}

function pluginRows({ entries, projectRoot, globalRoot, plugins, generalWritable, projectWritable }: BuildInput) {
  const rows = new Map<string, ExtensionPluginRow>();
  const disabled = new Set<string>();
  for (const document of configDocuments(entries)) {
    const source = sourceForPath(document.path, projectRoot, globalRoot);
    for (const entry of readPlugins(document.info as Record<string, unknown>)) {
      if (typeof entry === 'string' && entry.startsWith('-')) {
        disabled.add(entry.slice(1));
        continue;
      }
      const target = pluginTarget(entry);
      if (!target) continue;
      rows.set(`${source}:${target}`, {
        key: `${source}:${target}`,
        label: target,
        target,
        source,
        editable: sourceWritable(source, generalWritable, projectWritable),
      });
    }
  }
  for (const plugin of plugins) {
    const target = plugin.source.type === 'package' ? plugin.source.target : plugin.source.type === 'local' ? plugin.source.path : plugin.id;
    if (!target || (plugin.source.type === 'package' && disabled.has(target))) continue;
    const existing = [...rows.values()].filter((row) => row.target === target);
    if (existing.length > 0) {
      for (const row of existing) {
        row.version = plugin.source.type === 'package' ? plugin.source.version : row.version;
        row.outdated = plugin.source.type === 'package' ? plugin.source.outdated : row.outdated;
        row.status = plugin.state.status;
      }
      continue;
    }
    const source = plugin.source.type === 'local'
      ? sourceForPath(plugin.source.path, projectRoot, globalRoot)
      : plugin.source.type === 'package'
        ? 'inherited'
        : 'system';
    rows.set(`effective:${target}`, {
      key: `effective:${target}`,
      label: target,
      target: plugin.source.type === 'package' ? plugin.source.target : undefined,
      version: plugin.source.type === 'package' ? plugin.source.version : undefined,
      outdated: plugin.source.type === 'package' ? plugin.source.outdated : undefined,
      source,
      editable: false,
      status: plugin.state.status,
    });
  }
  return byLabel([...rows.values()], (row) => row.label);
}

function skillRows({ skills, projectRoot, globalRoot, generalWritable, projectWritable }: BuildInput) {
  const byKey = new Map<string, ExtensionSkillRow>();
  for (const skill of skills) {
    const source = sourceForPath(skill.path, projectRoot, globalRoot);
    const key = `${skill.id}\0${skill.path}`;
    byKey.set(key, {
      key,
      id: skill.id,
      name: skill.name,
      description: skill.description,
      path: skill.path,
      content: skill.content,
      source,
      editable: sourceWritable(source, generalWritable, projectWritable),
      removable: sourceWritable(source, generalWritable, projectWritable),
    });
  }
  return byLabel([...byKey.values()], (row) => row.name || row.id);
}

const BUILTIN_AGENTS = new Set(['build', 'plan', 'general', 'explore', 'compaction', 'title', 'summary']);

function modelLabel(value: Record<string, unknown>) {
  const model = value.model;
  if (typeof model === 'string') return model;
  if (!model || typeof model !== 'object' || Array.isArray(model)) return undefined;
  const selection = model as Record<string, unknown>;
  if (typeof selection.providerID !== 'string' || typeof selection.model !== 'string') return undefined;
  return `${selection.providerID}/${selection.model}${typeof selection.variant === 'string' ? `#${selection.variant}` : ''}`;
}

function commandRows(input: BuildInput) {
  const { entries, projectRoot, globalRoot, commands, commandFiles, generalWritable, projectWritable, generalCommandWritable, projectCommandWritable } = input;
  const rows = new Map<string, ExtensionCommandRow>();
  const filesByName = new Map(commandFiles.map((file) => [`${file.scope}:${file.name}`, file]));
  for (const document of configDocuments(entries)) {
    const source = sourceForPath(document.path, projectRoot, globalRoot);
    const definitions = readCommands(document.info as Record<string, unknown>);
    for (const [name, definition] of Object.entries(definitions)) {
      const value = definition && typeof definition === 'object' ? definition as Record<string, unknown> : {};
      const shadow = filesByName.get(`${source}:${name}`);
      rows.set(`config:${source}:${name}`, {
        key: `config:${source}:${name}`,
        name,
        description: typeof value.description === 'string' ? value.description : undefined,
        template: typeof value.template === 'string' ? value.template : undefined,
        definition: value,
        source,
        origin: 'config',
        editable: !shadow && sourceWritable(source, generalWritable, projectWritable),
        removable: sourceWritable(source, generalWritable, projectWritable),
        shadowedBy: shadow?.path,
        readOnlyReason: shadow ? 'A Markdown command overrides this configuration entry.' : undefined,
      });
    }
  }
  const duplicateFiles = new Map<string, number>();
  for (const file of commandFiles) duplicateFiles.set(`${file.scope}:${file.name}`, (duplicateFiles.get(`${file.scope}:${file.name}`) ?? 0) + 1);
  for (const file of commandFiles) {
    const parsed = file.content === undefined ? undefined : parseCommandMarkdown(file.content);
    const duplicate = (duplicateFiles.get(`${file.scope}:${file.name}`) ?? 0) > 1;
    const writable = file.scope === 'project' ? projectCommandWritable : generalCommandWritable;
    const reason = file.error || parsed?.error || (duplicate ? 'Multiple Markdown files define this command.' : file.symlink ? 'The command file is a symbolic link.' : undefined);
    rows.set(`file:${file.scope}:${file.name}:${file.path}`, {
      key: `file:${file.scope}:${file.name}:${file.path}`,
      name: file.name,
      description: parsed?.description,
      template: parsed?.instructions,
      source: file.scope,
      origin: 'file',
      path: file.path,
      content: file.content,
      editable: Boolean(writable) && !reason,
      removable: Boolean(writable) && !reason,
      readOnlyReason: reason,
    });
  }
  for (const command of commands) {
    if ([...rows.values()].some((row) => row.name === command.name)) continue;
    rows.set(`server:${command.name}`, {
      key: `server:${command.name}`,
      name: command.name,
      description: command.description,
      source: isBuiltinCommand(command) ? 'system' : 'inherited',
      origin: 'server',
      editable: false,
      removable: false,
    });
  }
  return byLabel([...rows.values()], (row) => row.name);
}

function agentRows(input: BuildInput) {
  const { entries, projectRoot, globalRoot, agents, agentFiles, generalWritable, projectWritable, generalAgentWritable, projectAgentWritable } = input;
  const rows = new Map<string, ExtensionAgentRow>();
  const filesByName = new Map(agentFiles.map((file) => [`${file.scope}:${file.name}`, file]));
  for (const document of configDocuments(entries)) {
    const source = sourceForPath(document.path, projectRoot, globalRoot);
    const definitions = readAgents(document.info as Record<string, unknown>);
    for (const [id, definition] of Object.entries(definitions)) {
      const value = definition && typeof definition === 'object' ? definition as Record<string, unknown> : {};
      const shadow = filesByName.get(`${source}:${id}`);
      const permissions = value.permissions;
      rows.set(`config:${source}:${id}`, {
        key: `config:${source}:${id}`,
        id,
        name: id,
        description: typeof value.description === 'string' ? value.description : undefined,
        mode: value.mode === 'primary' || value.mode === 'subagent' || value.mode === 'all' ? value.mode : undefined,
        model: modelLabel(value),
        permissions,
        permissionsText: permissions === undefined ? '' : JSON.stringify(permissions, null, 2),
        permissionsFormat: 'json',
        instructions: typeof value.system === 'string' ? value.system : undefined,
        definition: value,
        source,
        origin: 'config',
        editable: !shadow && sourceWritable(source, generalWritable, projectWritable),
        removable: sourceWritable(source, generalWritable, projectWritable),
        shadowedBy: shadow?.path,
        readOnlyReason: shadow ? 'A Markdown agent overrides this configuration entry.' : undefined,
      });
    }
  }
  const duplicateFiles = new Map<string, number>();
  for (const file of agentFiles) duplicateFiles.set(`${file.scope}:${file.name}`, (duplicateFiles.get(`${file.scope}:${file.name}`) ?? 0) + 1);
  for (const file of agentFiles) {
    const parsed = file.content === undefined ? undefined : parseAgentMarkdown(file.content);
    const duplicate = (duplicateFiles.get(`${file.scope}:${file.name}`) ?? 0) > 1;
    const writable = file.scope === 'project' ? projectAgentWritable : generalAgentWritable;
    const legacyMode = /\/modes?\//.test(file.path.replace(/\\/g, '/'));
    const reason = file.error || parsed?.error || (duplicate ? 'Multiple Markdown files define this agent.' : file.symlink ? 'The agent file is a symbolic link.' : legacyMode ? 'Legacy mode directories are read-only in the app.' : undefined);
    rows.set(`file:${file.scope}:${file.name}:${file.path}`, {
      key: `file:${file.scope}:${file.name}:${file.path}`,
      id: file.name,
      name: file.name,
      description: parsed?.description,
      mode: parsed?.mode ?? (legacyMode ? 'primary' : undefined),
      model: parsed?.model,
      modelComplex: parsed?.modelComplex,
      permissions: parsed?.permissions,
      permissionsText: parsed?.permissionsText,
      permissionsKey: parsed?.permissionsKey,
      permissionsFormat: 'yaml',
      instructions: parsed?.instructions,
      source: file.scope,
      origin: 'file',
      path: file.path,
      content: file.content,
      advancedFrontmatter: parsed?.advancedFrontmatter,
      editable: Boolean(writable) && !reason,
      removable: Boolean(writable) && !reason,
      readOnlyReason: reason,
    });
  }
  for (const agent of agents) {
    if ([...rows.values()].some((row) => row.id === agent.id)) continue;
    rows.set(`server:${agent.id}`, {
      key: `server:${agent.id}`,
      id: agent.id,
      name: agent.name || agent.id,
      description: agent.description,
      mode: agent.mode,
      model: agent.model ? `${agent.model.providerID}/${agent.model.id}${agent.model.variant ? `#${agent.model.variant}` : ''}` : undefined,
      permissions: agent.permissions,
      permissionsText: agent.permissions === undefined ? '' : JSON.stringify(agent.permissions, null, 2),
      permissionsFormat: 'json',
      instructions: agent.system,
      source: BUILTIN_AGENTS.has(agent.id) ? 'system' : 'inherited',
      origin: 'server',
      editable: false,
      removable: false,
    });
  }
  return byLabel([...rows.values()], (row) => row.name || row.id);
}

export function buildExtensionRows(input: BuildInput): ExtensionRows {
  return {
    mcp: mcpRows(input),
    plugins: pluginRows(input),
    skills: skillRows(input),
    commands: commandRows(input),
    agents: agentRows(input),
  };
}

export function splitRows(rows: ExtensionRows, scope: 'general' | 'project'): { items: ExtensionRows; shared: ExtensionRows } {
  const own = (row: { source: string }) => scope === 'project'
    ? row.source === 'project' || row.source === 'runtime'
    : row.source === 'general';
  const shared = (row: { source: string }) => scope === 'project'
    ? !own(row)
    : row.source === 'inherited' || row.source === 'system';
  return {
    items: {
      mcp: rows.mcp.filter(own),
      plugins: rows.plugins.filter(own),
      skills: rows.skills.filter(own),
      commands: rows.commands.filter(own),
      agents: rows.agents.filter(own),
    },
    shared: {
      mcp: rows.mcp.filter(shared),
      plugins: rows.plugins.filter(shared),
      skills: rows.skills.filter(shared),
      commands: rows.commands.filter(shared),
      agents: rows.agents.filter(shared),
    },
  };
}

