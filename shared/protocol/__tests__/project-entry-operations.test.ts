import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, symlink, access, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { entryCommand, inspectEntry, mutateEntry, type EntryOperation, type EntryShell } from '@/shared/protocol/opencode/project-entry-operations';

const exec = promisify(execFile);
describe('project entry shell operations', () => {
  let root: string, other: string;
  let environment: NodeJS.ProcessEnv;
  const shell: EntryShell = async (cwd, command) => {
    try { return { output: (await exec('/bin/sh', ['-c', command], { cwd, env: environment })).stdout, exit: 0, status: 'exited' }; }
    catch (error: any) { return { output: error.stdout || '', exit: error.code, status: 'exited' }; }
  };
  const operation = (source = 'source.txt', destination = 'target.txt', type: 'file' | 'directory' = 'file'): EntryOperation => ({
    kind: 'copy', source: { root, path: source, type }, destination: { root: other, path: destination },
  });
  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'project-entry-'));
    other = path.join(root, 'other'); await mkdir(other);
    environment = { ...process.env };
    await writeFile(path.join(root, 'source.txt'), 'original');
  });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  it('copies bytes across workspaces and only removes a cut source after success', async () => {
    const op = operation();
    expect(await inspectEntry(shell, op)).toBe('missing');
    await mutateEntry(shell, op, 'missing');
    expect(await readFile(path.join(other, 'target.txt'), 'utf8')).toBe('original');
    expect(await readFile(path.join(root, 'source.txt'), 'utf8')).toBe('original');
    const moved = { ...operation('source.txt', 'moved.txt'), kind: 'move' as const };
    await mutateEntry(shell, moved, 'missing');
    await expect(access(path.join(root, 'source.txt'))).rejects.toThrow();
    expect(await readFile(path.join(other, 'moved.txt'), 'utf8')).toBe('original');
  });
  it('quotes spaces, apostrophes, option-like names and shell metacharacters', async () => {
    const name = "-a b'$(touch INJECTED);.txt";
    await writeFile(path.join(root, name), 'safe');
    const op = operation(name, name);
    await mutateEntry(shell, op, await inspectEntry(shell, op));
    expect(await readFile(path.join(other, name), 'utf8')).toBe('safe');
    await expect(access(path.join(other, 'INJECTED'))).rejects.toThrow();
  });
  it('copies recursive and empty directories without merging existing folders', async () => {
    await mkdir(path.join(root, 'folder', 'empty'), { recursive: true });
    await writeFile(path.join(root, 'folder', '.hidden'), 'hidden');
    const op = operation('folder', 'folder', 'directory');
    await mutateEntry(shell, op, 'missing');
    expect(await readFile(path.join(other, 'folder', '.hidden'), 'utf8')).toBe('hidden');
    await access(path.join(other, 'folder', 'empty'));
    await expect(inspectEntry(shell, op)).rejects.toMatchObject({ code: 'collision' });
  });
  it('requires an unchanged destination token before replacing a regular file', async () => {
    const op = operation(); await writeFile(path.join(other, 'target.txt'), 'existing');
    const token = await inspectEntry(shell, op);
    await writeFile(path.join(other, 'target.txt'), 'changed externally');
    await expect(mutateEntry(shell, op, token)).rejects.toMatchObject({ code: 'changed' });
    expect(await readFile(path.join(other, 'target.txt'), 'utf8')).toBe('changed externally');
    await mutateEntry(shell, op, await inspectEntry(shell, op));
    expect(await readFile(path.join(other, 'target.txt'), 'utf8')).toBe('original');
  });
  it('allows diagnostic-looking filenames in a successful replacement fingerprint', async () => {
    const op = operation('source.txt', 'OCF:unsafe');
    await writeFile(path.join(other, 'OCF:unsafe'), 'existing');
    await mutateEntry(shell, op, await inspectEntry(shell, op));
    expect(await readFile(path.join(other, 'OCF:unsafe'), 'utf8')).toBe('original');
  });
  it('rejects traversal, root operations, external paths and control characters', () => {
    for (const name of ['../escape', '/outside', '', './source.txt', 'a\nfile', 'a\\file']) {
      expect(() => entryCommand(operation(name))).toThrow();
    }
  });
  it('rejects identical paths, nested destinations and symlinks in either tree', async () => {
    const same = operation(); same.destination = { root, path: 'source.txt' };
    await expect(inspectEntry(shell, same)).rejects.toMatchObject({ code: 'unsafe' });
    await mkdir(path.join(root, 'folder')); await mkdir(path.join(root, 'folder', 'nested'));
    const nested = operation('folder', 'folder/nested/child', 'directory'); nested.destination.root = root;
    await expect(inspectEntry(shell, nested)).rejects.toMatchObject({ code: 'unsafe' });
    await symlink(other, path.join(root, 'link'));
    await expect(inspectEntry(shell, operation('link/a'))).rejects.toMatchObject({ code: 'unsafe' });
    await symlink(path.join(root, 'source.txt'), path.join(other, 'target.txt'));
    await expect(inspectEntry(shell, operation())).rejects.toMatchObject({ code: 'unsafe' });
    await symlink(other, path.join(root, 'folder', 'link'));
    await expect(inspectEntry(shell, operation('folder', 'folder', 'directory'))).rejects.toMatchObject({ code: 'unsafe' });
  });
  it('keeps source and existing destination intact after a partial staging-copy failure', async () => {
    await writeFile(path.join(other, 'target.txt'), 'existing');
    const op = { ...operation(), kind: 'move' as const }, token = await inspectEntry(shell, operation());
    const bin = path.join(root, 'bin'); await mkdir(bin);
    await writeFile(path.join(bin, 'cp'), '#!/bin/sh\nprintf partial > "$3/partial"\nexit 1\n', { mode: 0o755 });
    environment = { ...process.env, PATH: `${bin}:${process.env.PATH}` };
    await expect(mutateEntry(shell, op, token)).rejects.toMatchObject({ code: 'failed' });
    expect(await readFile(path.join(root, 'source.txt'), 'utf8')).toBe('original');
    expect(await readFile(path.join(other, 'target.txt'), 'utf8')).toBe('existing');
  });
  it('reports incomplete shell execution without retrying the mutation', async () => {
    let calls = 0;
    await expect(mutateEntry(async () => { calls++; return { status: 'timeout', output: '' }; }, operation(), 'missing')).rejects.toMatchObject({ code: 'uncertain' });
    expect(calls).toBe(1);
  });
});
