import type { ScopedOpencodeClient } from '@/lib/opencode/client';
import { workspaceEntries, workspaceWorktrees } from '@/lib/opencode/workspace';
import { decodeFile } from '@/lib/opencode/v2/shared';
import * as v1 from '@/lib/opencode/compat/v1/workspace';
const location = (client: ScopedOpencodeClient) => ({ location: { directory: client.__opencode.directory } });
export async function findFiles(client: ScopedOpencodeClient, query: string, includeDirectories = false) {
  if (client.compatibility) return v1.findFiles(client.compatibility, query, includeDirectories);
  return (await client.api!.file.find({ ...location(client), query, limit: 100, ...(includeDirectories ? {} : { type: 'file' }) })).data.map((entry) => entry.path);
}
export async function listFiles(client: ScopedOpencodeClient, path: string) {
  const data = client.compatibility ? (await client.compatibility.file.list({ path })).data : (await client.api!.file.list({ ...location(client), path })).data;
  return workspaceEntries(data ?? [], client.__opencode.directory || '');
}
export async function readFile(client: ScopedOpencodeClient, path: string) {
  return client.compatibility ? v1.readFile(client.compatibility, path) : decodeFile(await client.api!.file.read({ ...location(client), path }));
}
export async function getFileStatus(client: ScopedOpencodeClient) {
  return client.compatibility ? v1.getFileStatus(client.compatibility) : (await client.api!.vcs.status(location(client))).data.map((status) => ({ path: status.file, added: status.additions, removed: status.deletions, status: status.status }));
}
export async function getVcsInfo(client: ScopedOpencodeClient) {
  if (client.compatibility) return v1.getVcsInfo(client.compatibility);
  const { data } = await client.api!.vcs.get(location(client));
  return { branch: data.branch?.current, default_branch: data.branch?.default };
}
export async function getVcsDiff(client: ScopedOpencodeClient, mode: 'git' | 'branch', context?: number) {
  return client.compatibility ? v1.getVcsDiff(client.compatibility, mode, context) : (await client.api!.vcs.diff({ ...location(client), mode: mode === 'git' ? 'working' : 'branch', ...(context !== undefined ? { context } : {}) })).data;
}
export async function saveFile(client: ScopedOpencodeClient, path: string, content: string, patch: string) {
  if (client.compatibility) return v1.applyVcsPatch(client.compatibility, patch);
  // shortcut: V2 cannot atomically check the pre-read content; concurrent edits can be overwritten until conditional writes exist.
  await client.api!.file.write({ ...location(client), path, payload: new TextEncoder().encode(content) });
}
export async function applyVcsPatch(client: ScopedOpencodeClient, patch: string) {
  if (!client.compatibility) throw new Error('Patch application is unavailable on OpenCode 2.');
  return v1.applyVcsPatch(client.compatibility, patch);
}
async function projectID(client: ScopedOpencodeClient) { return (await client.api!.location.get(location(client))).project.id; }
export async function listWorktrees(client: ScopedOpencodeClient) {
  return client.compatibility ? v1.listWorktrees(client.compatibility) : workspaceWorktrees(await client.api!.worktree.list({ projectID: await projectID(client) }));
}
export async function createWorktree(client: ScopedOpencodeClient, name?: string, startCommand?: string) {
  return client.compatibility ? v1.createWorktree(client.compatibility, name, startCommand) : client.api!.worktree.create({ projectID: await projectID(client), ...(name ? { name } : {}) });
}
export async function resetWorktree(client: ScopedOpencodeClient, directory: string) {
  if (!client.compatibility) throw new Error('Worktree reset is unavailable on OpenCode 2.');
  return v1.resetWorktree(client.compatibility, directory);
}
export async function removeWorktree(client: ScopedOpencodeClient, directory: string) {
  return client.compatibility ? v1.removeWorktree(client.compatibility, directory) : client.api!.worktree.remove({ projectID: await projectID(client), directory, force: true });
}
