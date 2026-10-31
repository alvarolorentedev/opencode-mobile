import type { Command, McpStatus } from '@/shared/protocol/opencode/types';
import { pluginTarget, readCommands, readMcpServers, readPlugins } from '@/shared/protocol/opencode/extensions/jsonc';
import { configDocuments, sourceForPath } from '@/shared/protocol/opencode/extensions/scope';
import type { ConfigEntry, ExtensionCommandRow, ExtensionMcpRow, ExtensionPluginRow, ExtensionRows, ExtensionSkillRow, RawPluginInfo, RawSkillInfo } from '@/shared/protocol/opencode/extensions/types';

type BuildInput = {
  entries: ConfigEntry[];
  projectRoot?: string;
  globalRoot?: string;
  mcpStatuses: Record<string, McpStatus>;
  plugins: RawPluginInfo[];
  skills: RawSkillInfo[];
  commands: Command[];
  generalWritable: boolean;
  projectWritable: boolean;
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

function commandRows({ entries, projectRoot, globalRoot, commands, generalWritable, projectWritable }: BuildInput) {
  const rows = new Map<string, ExtensionCommandRow>();
  for (const document of configDocuments(entries)) {
    const source = sourceForPath(document.path, projectRoot, globalRoot);
    const definitions = readCommands(document.info as Record<string, unknown>);
    for (const [name, definition] of Object.entries(definitions)) {
      const value = definition && typeof definition === 'object' ? definition as Record<string, unknown> : {};
      rows.set(`${source}:${name}`, {
        key: `config:${source}:${name}`,
        name,
        description: typeof value.description === 'string' ? value.description : undefined,
        template: typeof value.template === 'string' ? value.template : undefined,
        definition: value,
        source,
        editable: sourceWritable(source, generalWritable, projectWritable),
      });
    }
  }
  for (const command of commands) {
    if ([...rows.values()].some((row) => row.name === command.name)) continue;
    rows.set(`file:${command.name}`, {
      key: `file:${command.name}`,
      name: command.name,
      description: command.description,
      source: isBuiltinCommand(command) ? 'system' : 'inherited',
      editable: false,
    });
  }
  return byLabel([...rows.values()], (row) => row.name);
}

export function buildExtensionRows(input: BuildInput): ExtensionRows {
  return {
    mcp: mcpRows(input),
    plugins: pluginRows(input),
    skills: skillRows(input),
    commands: commandRows(input),
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
    },
    shared: {
      mcp: rows.mcp.filter(shared),
      plugins: rows.plugins.filter(shared),
      skills: rows.skills.filter(shared),
      commands: rows.commands.filter(shared),
    },
  };
}

