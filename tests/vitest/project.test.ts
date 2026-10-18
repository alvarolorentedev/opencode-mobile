import { describe, expect, it, vi } from 'vitest';

import { projectPath, projectEntries, projectWorktrees } from '@/lib/opencode/project';
import { findFiles, listFiles, readFile, listWorktrees } from '@/providers/services/project-service';
import { decodeFile } from '@/lib/opencode/v2/shared';

vi.mock('@/lib/opencode/client', () => ({ getServerBase: () => ({ origin: 'http://test', pathPrefix: '' }) }));

describe('project protocol', () => {
  it('keeps paths within the selected root and sorts folders first', () => {
    expect(projectPath('/repo/src/a.ts', '/repo')).toBe('src/a.ts');
    expect(projectPath('.', '/repo', true)).toBe('');
    for (const path of ['../secret', '/repo-other/file', '/repo/../secret']) expect(() => projectPath(path, '/repo')).toThrow();
    expect(() => projectPath('file', '')).toThrow(/Choose a project/);
    expect(projectEntries([{ path: 'z.ts', type: 'file' }, { path: 'src', type: 'directory' }, { path: 'app', type: 'directory' }], '/repo').map((entry) => entry.name)).toEqual(['app', 'src', 'z.ts']);
  });
  it('normalizes worktree names without inventing branch information', () => {
    expect(projectWorktrees(['/worktrees/task', { directory: '/worktrees/fix', name: 'Fix', branch: 'fix' }])).toEqual([
      { directory: '/worktrees/task', name: 'task', branch: undefined }, { directory: '/worktrees/fix', name: 'Fix', branch: 'fix' },
    ]);
  });
  it('rejects binary and malformed UTF-8 before text preview', () => {
    expect(decodeFile('\0binary')).toMatchObject({ type: 'binary' });
    expect(decodeFile(new Uint8Array([0, 65]))).toMatchObject({ type: 'binary' });
    expect(decodeFile(new Uint8Array([255, 254]))).toMatchObject({ type: 'binary' });
    expect(decodeFile(new TextEncoder().encode('hello'))).toEqual({ type: 'text', content: 'hello' });
  });
  it('scopes every V2 filesystem request and maps directory-only worktrees', async () => {
    const api = { file: { find: vi.fn(async () => ({ data: [{ path: 'src/a.ts', type: 'file' }] })), list: vi.fn(async () => ({ data: [{ path: 'src', type: 'directory' }] })), read: vi.fn(async () => new TextEncoder().encode('hello')) }, worktree: { list: vi.fn(async () => [{ directory: '/worktrees/task' }]) } };
    const client = { api: { ...api, location: { get: async () => ({ project: { id: 'parent-project' } }) } }, __opencode: { contract: 'v2', directory: '/worktrees/task' } } as never;
    await findFiles(client, 'a'); await listFiles(client, 'src'); await readFile(client, 'src/a.ts');
    for (const method of [api.file.find, api.file.list, api.file.read]) expect(method).toHaveBeenCalledWith(expect.objectContaining({ location: { directory: '/worktrees/task' } }));
    expect(await listWorktrees(client)).toEqual([{ directory: '/worktrees/task', name: 'task', branch: undefined }]);
    expect(api.worktree.list).toHaveBeenCalledWith({ projectID: 'parent-project' });
  });
});
