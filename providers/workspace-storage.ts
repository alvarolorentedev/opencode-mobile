import { withoutConnectionSecrets } from '@/lib/connection-password';
import { getConnectionUiScope } from '@/lib/connection-scope';
import { isValidServerUrl, type OpencodeConnectionSettings } from '@/lib/opencode/client';
import { parseConnectionSettings, parseChatPreferences } from '@/providers/persisted-preferences';
import type { ConnectionRecord, WorkspaceTarget } from '@/providers/workspace-types';

export const WORKSPACES_STORAGE_KEY = 'opencode-mobile.workspaces';
export type StoredConnection = Pick<ConnectionRecord, 'id' | 'name' | 'enabled' | 'preferences' | 'projects'> & { settings: Omit<OpencodeConnectionSettings, 'password' | 'headers'> };
export type StoredWorkspaces = { version: 1; connections: StoredConnection[]; focus?: WorkspaceTarget };
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
export function parseWorkspaces(raw: string): StoredWorkspaces {
  const value: unknown = JSON.parse(raw);
  if (!object(value) || value.version !== 1 || !Array.isArray(value.connections) || value.connections.length > 50) throw new Error('Invalid workspace registry.');
  const seen = new Set<string>();
  const connections = value.connections.map((item): StoredConnection => {
    if (!object(item) || typeof item.id !== 'string' || typeof item.name !== 'string' || typeof item.enabled !== 'boolean'
      || !object(item.settings) || 'password' in item.settings || 'headers' in item.settings || !object(item.preferences) || !Array.isArray(item.projects)
      || !item.projects.length || item.projects.length > 100 || !item.projects.every((path) => typeof path === 'string')) throw new Error('Invalid saved connection.');
    const settings = parseConnectionSettings(JSON.stringify(item.settings));
    if (!settings.serverUrl || !isValidServerUrl(settings.serverUrl) || typeof settings.username !== 'string'
      || getConnectionUiScope({ ...settings, username: settings.username, serverUrl: settings.serverUrl }) !== item.id || seen.has(item.id)) throw new Error('Invalid connection identity.');
    seen.add(item.id);
    return { id: item.id, name: item.name, enabled: item.enabled, settings: { ...settings, serverUrl: settings.serverUrl, username: settings.username, directory: '' },
      preferences: parseChatPreferences(JSON.stringify(item.preferences)), projects: [...new Set(item.projects as string[])] };
  });
  let focus: WorkspaceTarget | undefined;
  if (value.focus !== undefined) {
    if (!object(value.focus) || typeof value.focus.connectionId !== 'string' || typeof value.focus.projectPath !== 'string' || !seen.has(value.focus.connectionId)) throw new Error('Invalid workspace selection.');
    const selection = { connectionId: value.focus.connectionId, projectPath: value.focus.projectPath };
    if (!connections.find((entry) => entry.id === selection.connectionId)?.projects.includes(selection.projectPath)) throw new Error('Invalid workspace project.');
    focus = selection;
  }
  return { version: 1, connections, focus };
}
export function serializeWorkspaces(connections: ConnectionRecord[], focus?: WorkspaceTarget) {
  return JSON.stringify({ version: 1, connections: connections.map(({ events, settings, ...entry }) => ({ ...entry, settings: withoutConnectionSecrets(settings) })), focus });
}
