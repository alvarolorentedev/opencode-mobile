import type { McpLocalConfig, McpRemoteConfig, McpStatus } from '../types';

export type ExtensionScope = 'general' | 'project';

export type ExtensionSource = 'general' | 'project' | 'inherited' | 'runtime' | 'system';

export type ExtensionSafety = {
  writable: boolean;
  reason?: string;
  shellAvailable: boolean;
  atomicRename: boolean;
  windows: boolean;
  system: boolean;
  symlink: boolean;
  backupPath?: string;
};

export type ConfigTarget = {
  scope: ExtensionScope;
  root: string;
  path: string;
  relativePath: string;
  exists: boolean;
  safety: ExtensionSafety;
};

export type ConfigEntry =
  | { type: 'document'; path?: string; info: ConfigInfo }
  | { type: 'directory'; path: string };

export type ConfigInfo = {
  $schema?: string;
  mcp?: {
    servers?: Record<string, unknown>;
    [key: string]: unknown;
  };
  plugins?: unknown[];
  commands?: Record<string, unknown>;
  [key: string]: unknown;
};

export type ExtensionMcpRow = {
  key: string;
  name: string;
  config?: McpLocalConfig | McpRemoteConfig | Record<string, unknown>;
  status?: McpStatus;
  source: ExtensionSource;
  editable: boolean;
  removeMode: 'config' | 'runtime' | 'none';
};

export type ExtensionPluginRow = {
  key: string;
  label: string;
  target?: string;
  version?: string;
  outdated?: boolean;
  source: ExtensionSource;
  editable: boolean;
  status?: string;
};

export type ExtensionSkillRow = {
  key: string;
  id: string;
  name: string;
  description?: string;
  path?: string;
  content?: string;
  source: ExtensionSource;
  editable: boolean;
  removable: boolean;
};

export type ExtensionCommandRow = {
  key: string;
  name: string;
  description?: string;
  template?: string;
  definition?: Record<string, unknown>;
  source: ExtensionSource;
  editable: boolean;
};

export type ExtensionRows = {
  mcp: ExtensionMcpRow[];
  plugins: ExtensionPluginRow[];
  skills: ExtensionSkillRow[];
  commands: ExtensionCommandRow[];
};

export type ExtensionScopeSnapshot = {
  target?: ConfigTarget;
  safety: ExtensionSafety;
  items: ExtensionRows;
  shared: ExtensionRows;
};

export type ExtensionSnapshot = {
  general: ExtensionScopeSnapshot;
  project: ExtensionScopeSnapshot;
  loadedAt: number;
};

export type RawPluginSource =
  | { type: 'builtin' }
  | { type: 'package'; target: string; version?: string; outdated?: boolean; updating?: boolean }
  | { type: 'local'; path: string }
  | { type: 'sdk' };

export type RawPluginInfo = {
  id?: string;
  source: RawPluginSource;
  state: { status: 'active' } | { status: 'failed'; error: string };
};

export type RawSkillInfo = {
  id: string;
  name: string;
  description?: string;
  autoinvoke?: boolean;
  path: string;
  content: string;
};

export type ExtensionCommandDraft = {
  name: string;
  description?: string;
  template: string;
};

export type ExtensionSkillDraft = {
  id: string;
  name: string;
  description?: string;
  instructions: string;
  autoinvoke?: boolean;
};
