import { describe, expect, it } from 'vitest';

import { addPlugin, parseConfigText, readCommands, readMcpServers, readPlugins, removeCommand, removeMcpServer, setCommand, setMcpServer } from '@/shared/protocol/opencode/extensions/jsonc';
import { buildExtensionRows, splitRows } from '@/shared/protocol/opencode/extensions/snapshot';
import { visibleSharedRows } from '@/shared/presentation/extension-rows';
import { configBackupPath, restoreConfigBackup, writeConfigTransaction, type ShellResult, type TransactionIo } from '@/shared/protocol/opencode/extensions/transaction';
import { assertSkillId, skillDocument } from '@/shared/protocol/opencode/extensions/skills';
import { slugifySkillId } from '@/shared/contracts/skill-id';
import { resolveGlobalConfigRoot, selectConfigTarget, sourceForPath } from '@/shared/protocol/opencode/extensions/scope';
import type { ConfigEntry } from '@/shared/protocol/opencode/extensions/types';

function fakeIo(initial: Record<string, string>) {
  const files = new Map(Object.entries(initial));
  let failRename = false;
  const io: TransactionIo = {
    read: async (path) => files.get(path),
    write: async (path, content) => { files.set(path, content); },
    shell: async (_root, command): Promise<ShellResult> => {
      if (failRename && command.startsWith('mv ')) return { output: 'rename failed', exit: 1, status: 'exited' };
      const args = [...command.matchAll(/'([^']+)'/g)].map((match) => match[1]);
      if (command.startsWith('cp -p ')) {
        const source = files.get(args[0]);
        if (source === undefined) return { output: 'missing', exit: 1, status: 'exited' };
        files.set(args[1], source);
      } else if (command.startsWith('mv ')) {
        const source = files.get(args[0]);
        if (source === undefined) return { output: 'missing', exit: 1, status: 'exited' };
        files.delete(args[0]);
        files.set(args[1], source);
      } else if (command.startsWith('rm ')) {
        files.delete(args[0]);
      }
      return { output: '', exit: 0, status: 'exited' };
    },
  };
  return { files, io, fail: () => { failRename = true; } };
}

const target = '/work/app/opencode.jsonc';
const original = '{\n  "$schema": "https://opencode.ai/config.json",\n  // keep this comment\n  "mcp": { "servers": { "old": { "type": "local", "command": ["old"] } } }\n}\n';

describe('extension configuration scope', () => {
  const entries: ConfigEntry[] = [
    { type: 'directory', path: '/home/me/.config/opencode' },
    { type: 'document', path: '/home/me/.config/opencode/opencode.json', info: {} },
    { type: 'directory', path: '/work/app/.opencode' },
    { type: 'document', path: '/work/app/opencode.jsonc', info: {} },
  ];

  it('resolves the user global directory and project target without guessing when ambiguous', () => {
    expect(resolveGlobalConfigRoot(entries, '/work/app')).toBe('/home/me/.config/opencode');
    expect(selectConfigTarget(entries, 'project', '/work/app').path).toBe('/work/app/opencode.jsonc');
    expect(selectConfigTarget(entries, 'general', '/home/me/.config/opencode').path).toBe('/home/me/.config/opencode/opencode.json');
    expect(sourceForPath('/work/app/opencode.jsonc', '/work/app', '/home/me/.config/opencode')).toBe('project');
    expect(sourceForPath('/home/me/.config/opencode/skills/x/SKILL.md', '/work/app', '/home/me/.config/opencode')).toBe('general');
    expect(sourceForPath('/opt/company/skill.md', '/work/app', '/home/me/.config/opencode')).toBe('inherited');
  });

  it('refuses to edit system config', () => {
    expect(sourceForPath('/etc/opencode/opencode.json', '/work/app', '/home/me/.config/opencode')).toBe('system');
    expect(sourceForPath('/builtin/opencode.md', '/work/app', '/home/me/.config/opencode')).toBe('system');
  });
});

describe('JSONC extension edits', () => {
  it('preserves comments and unrelated keys while adding and removing MCP servers', () => {
    const added = setMcpServer(original, 'web', { type: 'remote', url: 'https://example.test/mcp' });
    expect(added).toContain('// keep this comment');
    expect(readMcpServers(parseConfigText(added))).toHaveProperty('web');
    expect(readMcpServers(parseConfigText(added))).toHaveProperty('old');
    const removed = removeMcpServer(added, 'old');
    expect(readMcpServers(parseConfigText(removed))).not.toHaveProperty('old');
    expect(readMcpServers(parseConfigText(removed))).toHaveProperty('web');
  });

  it('manages plugins and commands safely', () => {
    const withPlugin = addPlugin(original, 'opencode-example');
    expect(readPlugins(parseConfigText(withPlugin))).toContain('opencode-example');
    const withCommand = setCommand(withPlugin, { name: 'review', description: 'Review code', template: 'Review $ARGUMENTS.' });
    expect(readCommands(parseConfigText(withCommand)).review).toMatchObject({ template: 'Review $ARGUMENTS.' });
    const withoutCommand = removeCommand(withCommand, 'review');
    expect(readCommands(parseConfigText(withoutCommand))).not.toHaveProperty('review');
  });

  it('rejects malformed JSONC and legacy shapes without blocking modern MCP timeout config', () => {
    expect(() => parseConfigText('{ nope')).toThrow(/invalid JSONC/i);
    expect(() => setMcpServer('{\n  "mcp": {\n    "filesystem": { "type": "local", "command": ["x"] }\n  }\n}\n', 'web', { type: 'remote', url: 'https://example.test/mcp' })).toThrow(/legacy "mcp"/i);
    const withTimeout = setMcpServer('{\n  "mcp": {\n    "timeout": { "startup": 1000 }\n  }\n}\n', 'web', { type: 'remote', url: 'https://example.test/mcp' });
    expect(readMcpServers(parseConfigText(withTimeout))).toHaveProperty('web');
    expect(() => setCommand('{\n  "command": { "review": { "template": "x" } }\n}\n', { name: 'review', template: 'x' })).toThrow(/legacy "command"/i);
  });
});

describe('extension snapshots', () => {
  it('keeps global and project rows separate and classifies shared entries', () => {
    const entries: ConfigEntry[] = [
      {
        type: 'document',
        path: '/home/me/.config/opencode/opencode.jsonc',
        info: {
          mcp: { servers: { global: { type: 'local', command: ['global'] } } },
          plugins: ['global-plugin'],
          commands: { global: { template: 'global' } },
        },
      },
      {
        type: 'document',
        path: '/work/app/opencode.jsonc',
        info: {
          mcp: { servers: { project: { type: 'local', command: ['project'] } } },
          plugins: ['project-plugin'],
          commands: { project: { template: 'project' } },
        },
      },
    ];
    const rows = buildExtensionRows({
      entries,
      projectRoot: '/work/app',
      globalRoot: '/home/me/.config/opencode',
      mcpStatuses: { global: { status: 'connected' }, project: { status: 'connected' } },
      plugins: [],
      skills: [
        { id: 'project-skill', name: 'Project', path: '/work/app/.opencode/skills/project-skill/SKILL.md', content: 'x' },
        { id: 'global-skill', name: 'Global', path: '/home/me/.config/opencode/skills/global-skill/SKILL.md', content: 'x' },
      ],
      commands: [],
      generalWritable: true,
      projectWritable: true,
    });
    const general = splitRows(rows, 'general');
    const project = splitRows(rows, 'project');
    expect(general.items.mcp.map((row) => row.name)).toEqual(['global']);
    expect(project.items.mcp.map((row) => row.name)).toEqual(['project']);
    expect(project.shared.mcp.map((row) => row.name)).toEqual(['global']);
    expect(project.items.plugins.map((row) => row.label)).toEqual(['project-plugin']);
    expect(project.shared.plugins.map((row) => row.label)).toEqual(['global-plugin']);
    expect(project.items.skills.map((row) => row.id)).toEqual(['project-skill']);
    expect(project.shared.skills.map((row) => row.id)).toEqual(['global-skill']);
  });

  it('labels built-in entries as system and hides them from shared rows', () => {
    const rows = buildExtensionRows({
      entries: [],
      projectRoot: '/work/app',
      globalRoot: '/home/me/.config/opencode',
      mcpStatuses: {},
      plugins: [
        { id: 'opencode.agent', source: { type: 'builtin' }, state: { status: 'active' } },
        { id: 'custom-plugin', source: { type: 'package', target: 'custom-plugin' }, state: { status: 'active' } },
      ],
      skills: [
        { id: 'opencode', name: 'OpenCode', path: '/builtin/opencode.md', content: 'x' },
        { id: 'custom-skill', name: 'Custom', path: '/work/app/.opencode/skills/custom-skill/SKILL.md', content: 'x' },
      ],
      commands: [
        { name: 'init', description: 'guided AGENTS.md setup' },
        { name: 'review', description: 'review changes [commit|branch|pr], defaults to uncommitted' },
        { name: 'deploy', description: 'Ship it' },
      ],
      generalWritable: true,
      projectWritable: true,
    });

    expect(rows.plugins.find((row) => row.label === 'opencode.agent')?.source).toBe('system');
    expect(visibleSharedRows(rows.plugins).map((row) => row.label)).toEqual(['custom-plugin']);
    expect(rows.skills.find((row) => row.id === 'opencode')?.source).toBe('system');
    expect(visibleSharedRows(rows.skills).map((row) => row.id)).toEqual(['custom-skill']);
    expect(rows.commands.filter((row) => row.source === 'system').map((row) => row.name)).toEqual(['init', 'review']);
    expect(visibleSharedRows(rows.commands).map((row) => row.name)).toEqual(['deploy']);
  });

  it('keeps config-defined commands that reuse a built-in name', () => {
    const rows = buildExtensionRows({
      entries: [{
        type: 'document',
        path: '/work/app/opencode.jsonc',
        info: { commands: { review: { template: 'custom review' } } },
      }],
      projectRoot: '/work/app',
      globalRoot: '/home/me/.config/opencode',
      mcpStatuses: {},
      plugins: [],
      skills: [],
      commands: [{ name: 'review', description: 'review changes [commit|branch|pr], defaults to uncommitted' }],
      generalWritable: true,
      projectWritable: true,
    });

    expect(rows.commands).toHaveLength(1);
    expect(rows.commands[0]).toMatchObject({ name: 'review', source: 'project', editable: true });
  });
});

describe('config transactions', () => {
  it('writes through a temp file, keeps a backup, and leaves no temp behind', async () => {
    const { files, io } = fakeIo({ [target]: original });
    const next = setMcpServer(original, 'web', { type: 'remote', url: 'https://example.test/mcp' });
    const result = await writeConfigTransaction({ io, root: '/work/app', target, content: next });
    expect(result.created).toBe(false);
    expect(files.get(target)).toBe(next);
    expect(files.get(configBackupPath(target))).toBe(original);
    expect([...files.keys()].some((path) => path.endsWith('.tmp'))).toBe(false);
  });

  it('leaves the live file unchanged when the atomic rename fails', async () => {
    const { files, io, fail } = fakeIo({ [target]: original });
    fail();
    await expect(writeConfigTransaction({ io, root: '/work/app', target, content: '{}\n' })).rejects.toThrow(/replace/);
    expect(files.get(target)).toBe(original);
    expect([...files.keys()].some((path) => path.endsWith('.tmp'))).toBe(false);
  });

  it('restores the backup without overwriting it with the broken current file', async () => {
    const backup = configBackupPath(target);
    const { files, io } = fakeIo({ [target]: 'broken\n', [backup]: original });
    await restoreConfigBackup({ io, root: '/work/app', target, backup });
    expect(files.get(target)).toBe(original);
    expect(files.get(backup)).toBe(original);
    expect(files.get(`${backup}.pre-restore`)).toBe('broken\n');
  });
});

describe('skills', () => {
  it('creates portable skill ids and frontmatter', () => {
    expect(slugifySkillId('Code Review!')).toBe('code-review');
    expect(assertSkillId('code-review')).toBe('code-review');
    expect(() => assertSkillId('Code Review')).toThrow();
    const document = skillDocument({ id: 'code-review', name: 'Code Review', description: 'Review code', instructions: 'Check the diff.' });
    expect(document.text).toContain('name: "Code Review"');
    expect(document.text).toContain('description: "Review code"');
    expect(document.text).toContain('Check the diff.');
  });
});
