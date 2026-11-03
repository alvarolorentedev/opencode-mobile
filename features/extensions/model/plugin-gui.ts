import type { RawPluginInfo, RawPluginSource } from '@/shared/protocol/opencode/extensions/types';

/** The GUI API profile this host implements. Plugins may declare a higher number and are then refused. */
export const MOBILE_GUI_API = 1;

export type PluginGuiInfo = {
  id: string;
  label: string;
  version?: string;
  source: RawPluginSource;
};

export type PluginGuiBundle = {
  code: string;
  revision: string;
  options: Record<string, unknown>;
};

export type PluginGuiRpcRequest = {
  rpcID: string;
  method: string;
  input?: unknown;
  directory?: string;
};

export type PluginGuiApi = {
  plugins: PluginGuiInfo[];
  load(): Promise<void>;
  read(id: string): Promise<PluginGuiBundle>;
  rpc(request: PluginGuiRpcRequest): Promise<unknown>;
  sessionGet(request: { sessionID: string }): Promise<unknown>;
};

export type PluginGuiSession = {
  id: string;
  directory: string;
  title?: string;
};

export type PluginGuiServer = {
  id: string;
  name: string;
  url: string;
  builtin: boolean;
};

export type PluginGuiTheme = {
  mode: 'light' | 'dark';
  background: string;
  foreground: string;
  border: string;
  tint: string;
  surface: string;
};

export type PluginGuiPanel = {
  id: string;
  title: string;
};

export type PluginGuiHostProps = {
  code: string;
  pluginId: string;
  label: string;
  options: Record<string, unknown>;
  session: PluginGuiSession;
  server: PluginGuiServer;
  theme: PluginGuiTheme;
  locale: string;
  appVersion: string;
  panelId?: string;
  onReady: (title: string) => Promise<void>;
  onPanels: (panels: PluginGuiPanel[]) => Promise<void>;
  onError: (message: string) => Promise<void>;
  onEmpty: () => Promise<void>;
  onClose: () => Promise<void>;
  onOpenSession: (sessionID: string) => Promise<void>;
  onOpenExternal: (url: string) => Promise<void>;
  onRpc: (request: PluginGuiRpcRequest) => Promise<unknown>;
  onSessionGet: (request: { sessionID: string }) => Promise<unknown>;
};

/** A plugin whose GUI can be attempted on this host. */
export function isPluginGui(plugin: RawPluginInfo): plugin is RawPluginInfo & { id: string } {
  return Boolean(
    plugin.id &&
      plugin.features?.gui &&
      plugin.state.status === 'active' &&
      plugin.source.type !== 'builtin',
  );
}

export function pluginGuiLabel(plugin: RawPluginInfo): string {
  if (plugin.source.type === 'package') return plugin.source.target;
  if (plugin.source.type === 'local') return plugin.source.path;
  if (plugin.source.type === 'sdk') return plugin.id ?? 'OpenCode plugin';
  return plugin.id ?? 'OpenCode plugin';
}
