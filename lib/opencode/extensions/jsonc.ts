import { applyEdits, modify, parse, type ParseError } from 'jsonc-parser/lib/esm/main.js';

import type { McpLocalConfig, McpRemoteConfig } from '../types';
import type { ExtensionCommandDraft } from './types';

export type ConfigEditErrorCode =
  | 'invalid-jsonc'
  | 'invalid-name'
  | 'not-found'
  | 'already-exists'
  | 'unsupported-shape';

export class ConfigEditError extends Error {
  constructor(readonly code: ConfigEditErrorCode, message: string) {
    super(message);
    this.name = 'ConfigEditError';
  }
}

export const NEW_CONFIG_TEXT = '{\n  "$schema": "https://opencode.ai/config.json"\n}\n';

function toConfigMcp(config: McpLocalConfig | McpRemoteConfig) {
  const enabled = config.enabled !== false;
  if (config.type === 'remote') {
    const oauth = config.oauth;
    return {
      type: 'remote' as const,
      url: config.url,
      disabled: !enabled,
      ...(config.headers ? { headers: config.headers } : {}),
      ...(oauth === false
        ? { oauth: false as const }
        : oauth
          ? { oauth: { client_id: oauth.clientId, client_secret: oauth.clientSecret, scope: oauth.scope } }
          : {}),
    };
  }
  return {
    type: 'local' as const,
    command: config.command,
    disabled: !enabled,
    ...(config.environment ? { environment: config.environment } : {}),
  };
}

export function parseConfigText(text: string): Record<string, unknown> {
  const errors: ParseError[] = [];
  const value: unknown = parse(text.trim() || '{}', errors, { allowTrailingComma: true });
  if (errors.length > 0 || !value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ConfigEditError('invalid-jsonc', 'The configuration file contains invalid JSONC.');
  }
  return value as Record<string, unknown>;
}

export function createConfigText() {
  return NEW_CONFIG_TEXT;
}

export function assertMcpName(name: string) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) {
    throw new ConfigEditError('invalid-name', 'MCP server names may only contain letters, numbers, dots, dashes, and underscores.');
  }
  return name;
}

export function assertCommandName(name: string) {
  if (!/^[a-z0-9][a-z0-9._/-]*$/i.test(name) || name.startsWith('/') || name.endsWith('/')) {
    throw new ConfigEditError('invalid-name', 'Commands need a name such as review or team/review.');
  }
  return name;
}

export function pluginTarget(entry: unknown): string | undefined {
  if (typeof entry === 'string') {
    const target = entry.trim();
    return target && !target.startsWith('-') ? target : undefined;
  }
  if (!entry || typeof entry !== 'object') return undefined;
  const target = (entry as { package?: unknown }).package;
  return typeof target === 'string' && target.trim() ? target.trim() : undefined;
}

export function readMcpServers(config: Record<string, unknown>) {
  const mcp = config.mcp;
  if (!mcp || typeof mcp !== 'object' || Array.isArray(mcp)) return {} as Record<string, Record<string, unknown>>;
  const servers = (mcp as { servers?: unknown }).servers;
  if (!servers || typeof servers !== 'object' || Array.isArray(servers)) return {} as Record<string, Record<string, unknown>>;
  return servers as Record<string, Record<string, unknown>>;
}

export function readPlugins(config: Record<string, unknown>) {
  return Array.isArray(config.plugins) ? [...config.plugins] : [];
}

export function readCommands(config: Record<string, unknown>) {
  const commands = config.commands;
  if (!commands || typeof commands !== 'object' || Array.isArray(commands)) return {} as Record<string, Record<string, unknown>>;
  return commands as Record<string, Record<string, unknown>>;
}

function edit(text: string, path: (string | number)[], value: unknown) {
  const edits = modify(text, path, value, { formattingOptions: { insertSpaces: true, tabSize: 2 } });
  const next = applyEdits(text, edits);
  parseConfigText(next);
  return next.endsWith('\n') ? next : `${next}\n`;
}

function assertModernMcp(config: Record<string, unknown>) {
  const mcp = config.mcp;
  if (mcp === undefined) return;
  if (!mcp || typeof mcp !== 'object' || Array.isArray(mcp)) {
    throw new ConfigEditError('unsupported-shape', 'The "mcp" configuration is not an object.');
  }
  if ('servers' in mcp) {
    const servers = (mcp as { servers?: unknown }).servers;
    if (servers !== undefined && (!servers || typeof servers !== 'object' || Array.isArray(servers))) {
      throw new ConfigEditError('unsupported-shape', 'The "mcp.servers" configuration is not an object.');
    }
    return;
  }
  const legacy = Object.values(mcp).some((entry) => {
    const value = entry && typeof entry === 'object' ? entry as Record<string, unknown> : undefined;
    return value?.type === 'local' || value?.type === 'remote';
  });
  if (legacy) {
    throw new ConfigEditError('unsupported-shape', 'This file uses the legacy "mcp" server shape. Edit it on the server before using the mobile extension editor.');
  }
}

export function setMcpServer(
  text: string,
  name: string,
  config: McpLocalConfig | McpRemoteConfig,
  mode: 'add' | 'edit' = 'add',
) {
  assertMcpName(name);
  const parsed = parseConfigText(text);
  assertModernMcp(parsed);
  if (mode === 'add' && readMcpServers(parsed)[name]) {
    throw new ConfigEditError('already-exists', `MCP server "${name}" already exists.`);
  }
  return edit(text, ['mcp', 'servers', name], toConfigMcp(config));
}

export function removeMcpServer(text: string, name: string) {
  assertMcpName(name);
  const parsed = parseConfigText(text);
  assertModernMcp(parsed);
  if (!readMcpServers(parsed)[name]) {
    throw new ConfigEditError('not-found', `MCP server "${name}" is not defined in this configuration.`);
  }
  return edit(text, ['mcp', 'servers', name], undefined);
}

function assertModernShape(config: Record<string, unknown>, legacyKey: string, modernKey: string) {
  if (config[modernKey] === undefined && config[legacyKey] !== undefined) {
    throw new ConfigEditError('unsupported-shape', `This file uses the legacy "${legacyKey}" configuration shape. Edit it on the server before using the mobile extension editor.`);
  }
}

export function addPlugin(text: string, target: string) {
  const value = target.trim();
  if (!value) throw new ConfigEditError('invalid-name', 'Enter a plugin package or path.');
  const config = parseConfigText(text);
  assertModernShape(config, 'plugin', 'plugins');
  if (config.plugins !== undefined && !Array.isArray(config.plugins)) {
    throw new ConfigEditError('unsupported-shape', 'The "plugins" configuration is not an array.');
  }
  const plugins = readPlugins(config);
  if (plugins.some((entry) => pluginTarget(entry) === value)) {
    throw new ConfigEditError('already-exists', `Plugin "${value}" is already configured.`);
  }
  return edit(text, ['plugins'], [...plugins, value]);
}

export function removePlugin(text: string, target: string) {
  const value = target.trim();
  const config = parseConfigText(text);
  assertModernShape(config, 'plugin', 'plugins');
  if (config.plugins !== undefined && !Array.isArray(config.plugins)) {
    throw new ConfigEditError('unsupported-shape', 'The "plugins" configuration is not an array.');
  }
  const plugins = readPlugins(config);
  const next = plugins.filter((entry) => pluginTarget(entry) !== value);
  if (next.length === plugins.length) {
    throw new ConfigEditError('not-found', `Plugin "${value}" is not defined in this configuration.`);
  }
  return edit(text, ['plugins'], next);
}

export function setCommand(text: string, draft: ExtensionCommandDraft) {
  const name = assertCommandName(draft.name.trim());
  const template = draft.template.trim();
  if (!template) throw new ConfigEditError('invalid-name', 'Enter a command template.');
  const parsed = parseConfigText(text);
  assertModernShape(parsed, 'command', 'commands');
  if (parsed.commands !== undefined && (!parsed.commands || typeof parsed.commands !== 'object' || Array.isArray(parsed.commands))) {
    throw new ConfigEditError('unsupported-shape', 'The "commands" configuration is not an object.');
  }
  const commands = readCommands(parsed);
  const previous = commands[name] && typeof commands[name] === 'object' ? commands[name] as Record<string, unknown> : {};
  const next: Record<string, unknown> = { ...previous, template };
  const description = draft.description?.trim();
  if (description) next.description = description;
  else delete next.description;
  return edit(text, ['commands', name], next);
}

export function removeCommand(text: string, name: string) {
  const parsed = parseConfigText(text);
  assertModernShape(parsed, 'command', 'commands');
  if (parsed.commands !== undefined && (!parsed.commands || typeof parsed.commands !== 'object' || Array.isArray(parsed.commands))) {
    throw new ConfigEditError('unsupported-shape', 'The "commands" configuration is not an object.');
  }
  if (!readCommands(parsed)[name]) {
    throw new ConfigEditError('not-found', `Command "${name}" is not defined in this configuration.`);
  }
  return edit(text, ['commands', name], undefined);
}
