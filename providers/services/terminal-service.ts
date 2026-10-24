import { buildPtyWebSocketUrl, type OpencodeConnectionSettings, type ScopedOpencodeClient, type ServerContract } from '@/lib/opencode/client';
import { Platform } from 'react-native';
import * as v1 from '@/lib/opencode/compat/v1/terminal';
const location = (client: ScopedOpencodeClient) => ({ location: { directory: client.__opencode.directory } });
export async function listTerminals(client: ScopedOpencodeClient) {
  return client.compatibility ? v1.listTerminals(client.compatibility) : (await client.api!.pty.list(location(client))).data;
}
export async function createTerminal(client: ScopedOpencodeClient, input?: { command?: string; args?: string[]; cwd?: string; title?: string; env?: Record<string, string> }) {
  return client.compatibility ? v1.createTerminal(client.compatibility, input) : (await client.api!.pty.create({ ...location(client), ...input })).data;
}
export async function removeTerminal(client: ScopedOpencodeClient, ptyID: string) {
  return client.compatibility ? v1.removeTerminal(client.compatibility, ptyID) : client.api!.pty.remove({ ...location(client), ptyID });
}
export async function resizeTerminal(client: ScopedOpencodeClient, ptyID: string, size: { cols: number; rows: number }) {
  return client.compatibility ? v1.resizeTerminal(client.compatibility, ptyID, size) : client.api!.pty.update({ ...location(client), ptyID, size });
}
export async function createTerminalConnectToken(client: ScopedOpencodeClient, ptyID: string) {
  return client.compatibility ? v1.createTerminalConnectToken(client.compatibility, ptyID) : (await client.api!.pty.connect.token({ ...location(client), ptyID }, { headers: { 'x-opencode-ticket': '1' } })).data;
}
export function getTerminalWebSocketUrl(settings: Pick<OpencodeConnectionSettings, 'serverUrl' | 'directory'>, ptyId: string, options?: { ticket?: string; cursor?: string }, contract?: ServerContract) { return buildPtyWebSocketUrl(settings, ptyId, options, contract); }
export function openTerminalWebSocket(url: string, headers?: Record<string, string>) {
  // Browsers cannot attach custom headers to a WebSocket upgrade. Native
  // transports do, and the HTTP ticket request already carries the same headers.
  if (Platform.OS === 'web') return new WebSocket(url);
  const NativeSocket = WebSocket as unknown as { new(url: string, protocols: undefined, options: { headers: Record<string, string> }): WebSocket };
  return new NativeSocket(url, undefined, { headers: headers ?? {} });
}
