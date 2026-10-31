import type { OpencodeClient } from '@opencode-ai/sdk/v2/client';

import { requireData } from '@/shared/protocol/opencode/require-data';

export async function listTerminals(client: OpencodeClient) {
  return requireData((await client.pty.list()).data, 'terminal list request');
}

export async function createTerminal(client: OpencodeClient, cwd?: string) {
  return requireData((await client.pty.create(cwd ? { cwd } : undefined)).data, 'terminal create request');
}

export async function removeTerminal(client: OpencodeClient, ptyId: string) {
  await client.pty.remove({ ptyID: ptyId });
}

export async function resizeTerminal(client: OpencodeClient, ptyId: string, size: { cols: number; rows: number }) {
  return requireData((await client.pty.update({ ptyID: ptyId, size })).data, 'terminal resize request');
}

export async function createTerminalConnectToken(client: OpencodeClient, ptyId: string) {
  return requireData((await client.pty.connectToken(
    { ptyID: ptyId },
    { headers: { 'x-opencode-ticket': '1' } },
  )).data, 'terminal connect token request');
}
