import type { OpencodeClient } from '@opencode-ai/sdk/v2/client';

function requireData<T>(data: T | undefined, operation: string): T {
  if (data === undefined) {
    throw new Error(`OpenCode ${operation} returned no data.`);
  }
  return data;
}

export async function findFiles(client: OpencodeClient, query: string, includeDirectories = false) {
  return requireData((await client.find.files({ query, dirs: includeDirectories ? 'true' : 'false' })).data, 'file search');
}

export async function listFiles(client: OpencodeClient, path: string) {
  return requireData((await client.file.list({ path })).data, 'file list');
}

export async function findText(client: OpencodeClient, pattern: string) {
  return requireData((await client.find.text({ pattern })).data, 'text search');
}

export async function findSymbols(client: OpencodeClient, query: string) {
  return requireData((await client.find.symbols({ query })).data, 'symbol search');
}

export async function readFile(client: OpencodeClient, path: string) {
  return requireData((await client.file.read({ path })).data, 'file read');
}

export async function getFileStatus(client: OpencodeClient) {
  return requireData((await client.file.status()).data, 'file status');
}

export async function getVcsInfo(client: OpencodeClient) {
  return requireData((await client.vcs.get()).data, 'VCS request');
}

export async function getVcsStatus(client: OpencodeClient) {
  return requireData((await client.vcs.status()).data, 'VCS status request');
}

export async function getVcsDiff(client: OpencodeClient, mode: 'git' | 'branch', context?: number) {
  return requireData((await client.vcs.diff({ mode, context })).data, 'VCS diff request');
}

export async function getRawVcsDiff(client: OpencodeClient) {
  return requireData((await client.vcs.diff2.raw()).data, 'raw VCS diff request');
}

export async function applyVcsPatch(client: OpencodeClient, patch: string) {
  return requireData((await client.vcs.apply({ patch })).data, 'VCS apply request');
}

export async function listWorktrees(client: OpencodeClient) {
  return requireData((await client.worktree.list()).data, 'worktree list request');
}

export async function createWorktree(client: OpencodeClient, name?: string, startCommand?: string) {
  return requireData((await client.worktree.create({ worktreeCreateInput: { name, startCommand } })).data, 'worktree create request');
}

export async function resetWorktree(client: OpencodeClient, directory: string) {
  return requireData((await client.worktree.reset({ worktreeResetInput: { directory } })).data, 'worktree reset request');
}

export async function removeWorktree(client: OpencodeClient, directory: string) {
  return requireData((await client.worktree.remove({ worktreeRemoveInput: { directory } })).data, 'worktree remove request');
}
