import type { ScopedOpencodeClient } from '@/shared/protocol/opencode/client';
import { createServerAdapter } from '@/shared/protocol/opencode/contracts/server-adapter';

export function findFiles(client: ScopedOpencodeClient, query: string, includeDirectories = false) {
  return createServerAdapter(client).projects.findFiles(query, includeDirectories);
}
export function listFiles(client: ScopedOpencodeClient, path: string) {
  return createServerAdapter(client).projects.listFiles(path);
}
export function readFile(client: ScopedOpencodeClient, path: string) {
  return createServerAdapter(client).projects.readFile(path);
}
export function readProjectFile(client: ScopedOpencodeClient, path: string) {
  return createServerAdapter(client).projects.readProjectFile(path);
}
export function getProjectFileDownloadSource(client: ScopedOpencodeClient, path: string) {
  return createServerAdapter(client).projects.downloadSource(path);
}
export function getFileStatus(client: ScopedOpencodeClient) {
  return createServerAdapter(client).projects.fileStatus();
}
export function getVcsInfo(client: ScopedOpencodeClient) {
  return createServerAdapter(client).projects.vcsInfo();
}
export function getVcsDiff(client: ScopedOpencodeClient, mode: 'git' | 'branch', context?: number) {
  return createServerAdapter(client).projects.vcsDiff(mode, context);
}
export function saveFile(client: ScopedOpencodeClient, path: string, content: string, patch: string) {
  return createServerAdapter(client).projects.saveFile(path, content, patch);
}
export function listWorktrees(client: ScopedOpencodeClient, projectId?: string) {
  return createServerAdapter(client).projects.listWorktrees(projectId);
}
export function createWorktree(client: ScopedOpencodeClient, name?: string) {
  return createServerAdapter(client).projects.createWorktree(name);
}
export function removeWorktree(client: ScopedOpencodeClient, directory: string) {
  return createServerAdapter(client).projects.removeWorktree(directory);
}

export function projectEntryOperations(client: ScopedOpencodeClient) {
  return createServerAdapter(client).projects.entryOperations;
}
