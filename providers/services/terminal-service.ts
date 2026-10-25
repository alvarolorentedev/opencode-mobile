import { buildPtyWebSocketUrl, type OpencodeConnectionSettings, type ScopedOpencodeClient, type ServerContract } from '@/lib/opencode/client';
import { createServerAdapter } from '@/lib/opencode/contracts/server-adapter';
import { Platform } from 'react-native';

export function listTerminals(client: ScopedOpencodeClient) {
  return createServerAdapter(client).terminals.list();
}
export function createTerminal(client: ScopedOpencodeClient) {
  return createServerAdapter(client).terminals.create();
}
export function removeTerminal(client: ScopedOpencodeClient, ptyID: string) {
  return createServerAdapter(client).terminals.remove(ptyID);
}
export function resizeTerminal(client: ScopedOpencodeClient, ptyID: string, size: { cols: number; rows: number }) {
  return createServerAdapter(client).terminals.resize(ptyID, size);
}
export function createTerminalConnectToken(client: ScopedOpencodeClient, ptyID: string) {
  return createServerAdapter(client).terminals.connectToken(ptyID);
}
export function getTerminalWebSocketUrl(settings: Pick<OpencodeConnectionSettings, 'serverUrl' | 'directory'>, ptyId: string, options?: { ticket?: string; cursor?: string }, contract?: ServerContract) { return buildPtyWebSocketUrl(settings, ptyId, options, contract); }
export function openTerminalWebSocket(url: string, headers?: Record<string, string>) {
  // Browsers cannot attach custom headers to a WebSocket upgrade. Native
  // transports do, and the HTTP ticket request already carries the same headers.
  if (Platform.OS === 'web') return new WebSocket(url);
  const NativeSocket = WebSocket as unknown as { new(url: string, protocols: undefined, options: { headers: Record<string, string> }): WebSocket };
  return new NativeSocket(url, undefined, { headers: headers ?? {} });
}
