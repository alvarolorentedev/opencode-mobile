import type { McpLocalConfig, McpRemoteConfig, McpStatus } from '@/shared/protocol/opencode/types';

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
  agents?: Record<string, unknown>;
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

export type ExtensionDefinitionOrigin = 'config' | 'file' | 'server';

export type ExtensionCommandRow = {
  key: string;
  name: string;
  description?: string;
  template?: string;
  definition?: Record<string, unknown>;
  source: ExtensionSource;
  origin: ExtensionDefinitionOrigin;
  path?: string;
  content?: string;
  editable: boolean;
  removable: boolean;
  shadowedBy?: string;
  readOnlyReason?: string;
};

export type ExtensionAgentMode = 'primary' | 'subagent' | 'all';

export type ExtensionAgentRow = {
  key: string;
  id: string;
  name: string;
  description?: string;
  mode?: ExtensionAgentMode;
  model?: string;
  modelComplex?: boolean;
  permissions?: unknown;
  permissionsText?: string;
  permissionsKey?: 'permission' | 'permissions';
  permissionsFormat: 'yaml' | 'json';
  instructions?: string;
  definition?: Record<string, unknown>;
  source: ExtensionSource;
  origin: ExtensionDefinitionOrigin;
  path?: string;
  content?: string;
  advancedFrontmatter?: string;
  editable: boolean;
  removable: boolean;
  shadowedBy?: string;
  readOnlyReason?: string;
};

export type ExtensionRows = {
  mcp: ExtensionMcpRow[];
  plugins: ExtensionPluginRow[];
  skills: ExtensionSkillRow[];
  commands: ExtensionCommandRow[];
  agents: ExtensionAgentRow[];
};

export type ExtensionMarkdownTarget = {
  scope: ExtensionScope;
  kind: 'agents' | 'commands';
  root: string;
  scopeRoot: string;
  exists: boolean;
  safety: ExtensionSafety;
};

export type ExtensionScopeSnapshot = {
  target?: ConfigTarget;
  safety: ExtensionSafety;
  markdown: {
    agents: ExtensionMarkdownTarget;
    commands: ExtensionMarkdownTarget;
  };
  items: ExtensionRows;
  shared: ExtensionRows;
};

export type ExtensionSnapshot = {
  general: ExtensionScopeSnapshot;
  project: ExtensionScopeSnapshot;
  errors: {
    agents?: string;
    commands?: string;
  };
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
  features?: { server?: true; tui?: true; rpc?: true; gui?: true };
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

export type ExtensionFormat = 'markdown' | 'jsonc';

export type ExtensionCommandDraft = {
  name: string;
  description?: string;
  template: string;
  format?: ExtensionFormat;
};

export type ExtensionAgentDraft = {
  id: string;
  description?: string;
  mode: ExtensionAgentMode;
  model?: string;
  permissions?: string;
  instructions: string;
  advancedFrontmatter?: string;
  format?: ExtensionFormat;
};

export type ExtensionSkillDraft = {
  id: string;
  name: string;
  description?: string;
  instructions: string;
  autoinvoke?: boolean;
};

export type ExtensionMarkdownFile = {
  kind: 'agents' | 'commands';
  scope: ExtensionScope;
  root: string;
  name: string;
  path: string;
  content?: string;
  symlink: boolean;
  error?: string;
};

export type RawAgentInfo = {
  id: string;
  name?: string;
  description?: string;
  mode?: ExtensionAgentMode;
  hidden?: boolean;
  model?: { id: string; providerID: string; variant?: string };
  permissions?: unknown;
  system?: string;
};
