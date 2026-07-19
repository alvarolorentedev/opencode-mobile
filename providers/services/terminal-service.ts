import type { OpencodeClient } from '@opencode-ai/sdk/v2/client';

import { buildPtyWebSocketUrl, type OpencodeConnectionSettings } from '@/lib/opencode/client';

function requireData<T>(data: T | undefined, operation: string): T {
  if (data === undefined) throw new Error(`OpenCode ${operation} returned no data.`);
  return data;
}

export async function listShells(client: OpencodeClient) {
  return requireData((await client.pty.shells()).data, 'shell list request');
}

export async function listTerminals(client: OpencodeClient) {
  return requireData((await client.pty.list()).data, 'terminal list request');
}

export async function createTerminal(
  client: OpencodeClient,
  input?: { command?: string; args?: string[]; cwd?: string; title?: string; env?: Record<string, string> },
) {
  return requireData((await client.pty.create(input)).data, 'terminal create request');
}

export async function getTerminal(client: OpencodeClient, ptyId: string) {
  return requireData((await client.pty.get({ ptyID: ptyId })).data, 'terminal get request');
}

export async function updateTerminal(
  client: OpencodeClient,
  ptyId: string,
  update: { title?: string; size?: { rows: number; cols: number } },
) {
  return requireData((await client.pty.update({ ptyID: ptyId, ...update })).data, 'terminal update request');
}

export async function removeTerminal(client: OpencodeClient, ptyId: string) {
  return requireData((await client.pty.remove({ ptyID: ptyId })).data, 'terminal remove request');
}

export async function createTerminalConnectToken(client: OpencodeClient, ptyId: string) {
  return requireData((await client.pty.connectToken(
    { ptyID: ptyId },
    { headers: { 'x-opencode-ticket': '1' } },
  )).data, 'terminal connect token request');
}

export function getTerminalWebSocketUrl(
  settings: Pick<OpencodeConnectionSettings, 'serverUrl' | 'directory'>,
  ptyId: string,
  options?: { ticket?: string; cursor?: string },
) {
  return buildPtyWebSocketUrl(settings, ptyId, options);
}
