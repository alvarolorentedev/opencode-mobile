
import { workspaceEntries, workspaceWorktrees } from '@/lib/opencode/workspace';
import type { OpencodeClient } from '@opencode-ai/sdk/v2/client';

import { requireData } from '@/providers/services/require-data';

export async function findFiles(client: OpencodeClient, query: string, includeDirectories = false) {
  return requireData((await client.find.files({ query, dirs: includeDirectories ? 'true' : 'false' })).data, 'file search');
}

export async function listFiles(client: OpencodeClient, path: string) {
  return workspaceEntries(requireData((await client.file.list({ path })).data, 'directory listing'), '');
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

export async function getVcsDiff(client: OpencodeClient, mode: 'git' | 'branch', context?: number) {
  return requireData((await client.vcs.diff({ mode, context })).data, 'VCS diff request');
}

export async function applyVcsPatch(client: OpencodeClient, patch: string) {
  return requireData((await client.vcs.apply({ patch })).data, 'VCS apply request');
}

export async function listWorktrees(client: OpencodeClient) {
  return workspaceWorktrees(requireData((await client.worktree.list()).data, 'worktree list request'));
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
