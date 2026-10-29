import { describe, expect, it, vi } from 'vitest';

import { projectPath, projectEntries, projectCheckouts, projectWorktrees } from '@/lib/opencode/project';
import { projectFileDownloadUrl } from '@/lib/opencode/project-file';
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
  it('builds a main checkout plus linked worktrees in display order', () => {
    const entries = projectWorktrees([
      { directory: '/worktrees/b', name: 'Beta', branch: 'beta' },
      { directory: '/worktrees/a', name: 'Alpha', branch: 'alpha' },
    ]);
    expect(projectCheckouts('/repo', entries, '/worktrees/b', 'beta')).toEqual([
      { directory: '/repo', name: 'Local', branch: undefined, isMain: true },
      { directory: '/worktrees/a', name: 'Alpha', branch: 'alpha', isMain: false },
      { directory: '/worktrees/b', name: 'Beta', branch: 'beta', isMain: false },
    ]);
    expect(projectCheckouts('/repo', entries, '/repo', 'main')[0].branch).toBe('main');
  });
  it('keeps the active checkout visible while the worktree catalog is loading', () => {
    expect(projectCheckouts('/repo', [], '/worktrees/task', 'task')).toEqual([
      { directory: '/repo', name: 'Local', branch: undefined, isMain: true },
      { directory: '/worktrees/task', name: 'task', branch: 'task', isMain: false },
    ]);
    expect(projectCheckouts(undefined, [], '/worktrees/task', 'task')).toEqual([
      { directory: '/worktrees/task', name: 'task', branch: 'task', isMain: true },
    ]);
  });
  it('rejects binary and malformed UTF-8 before text preview', () => {
    expect(decodeFile('\0binary')).toMatchObject({ type: 'binary' });
    expect(decodeFile(new Uint8Array([0, 65]))).toMatchObject({ type: 'binary' });
    expect(decodeFile(new Uint8Array([255, 254]))).toMatchObject({ type: 'binary' });
    expect(decodeFile(new TextEncoder().encode('hello'))).toEqual({ type: 'text', content: 'hello' });
  });
  it('builds a scoped, path-safe V2 download URL', () => {
    const source = new URL(projectFileDownloadUrl({
      origin: 'http://host',
      pathPrefix: '/api',
      directory: '/repo',
      path: 'src/a b.png',
    }));
    expect(source.pathname).toBe('/api/fs/read/src/a%20b.png');
    expect(source.searchParams.get('location[directory]')).toBe('/repo');
    expect(new URL(projectFileDownloadUrl({ origin: 'http://host', pathPrefix: '/proxy/api', directory: '/repo', path: 'src/a.ts' })).pathname)
      .toBe('/proxy/api/fs/read/src/a.ts');
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
