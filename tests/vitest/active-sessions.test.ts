import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { describe, it } from 'vitest';

// Migrated from the standalone tests/active-sessions.test.mjs Node script.
describe('active session grouping', () => {
  it('orders running first, filters archived/subagents, and caps the list', async () => {
    const source = await readFile(new URL('../../providers/active-sessions.ts', import.meta.url), 'utf8');
    const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText;
    const { getActiveSessions } = await import(`data:text/javascript,${encodeURIComponent(output)}`);

    function session(id: string, directory: string, updated: number, extra: Record<string, unknown> = {}) {
      return { id, directory, title: id, time: { created: 0, updated }, ...extra };
    }

    const demo = '/workspace/demo-project';
    const secondary = '/workspace/secondary-project';
    const tertiary = '/workspace/tertiary-project';

    // The group is connection-wide: running first (newest), then recent, and the
    // current session is flagged rather than filtered out.
    const items = getActiveSessions({
      currentSessionId: 'running-demo',
      sessions: [
        session('running-demo', demo, 100),
        session('running-secondary', secondary, 300),
        session('recent-tertiary', tertiary, 400),
        session('older-secondary', secondary, 50),
      ],
      statuses: {
        'running-demo': { type: 'busy' },
        'running-secondary': { type: 'busy' },
        'recent-tertiary': { type: 'idle' },
        'older-secondary': { type: 'idle' },
      },
    });
    assert.deepEqual(items.map((item) => item.sessionId), ['running-secondary', 'running-demo', 'recent-tertiary', 'older-secondary']);
    assert.equal(items[0].status.type, 'busy');
    assert.equal(items[1].isCurrent, true);
    assert.equal(items[2].projectPath, tertiary);
    assert.equal(items[3].updatedAt, 50);

    // Archived sessions and (optionally) subagent chats never surface.
    const filtered = getActiveSessions({
      hideSubagentChats: true,
      sessions: [
        session('archived', secondary, 900, { time: { created: 0, updated: 900, archived: 1 } }),
        session('subagent', secondary, 800, { parentID: 'parent' }),
        session('visible', secondary, 700),
      ],
      statuses: {},
    });
    assert.deepEqual(filtered.map((item) => item.sessionId), ['visible']);

    // The list is always capped, prefering running sessions over idle recency.
    const capped = getActiveSessions({
      maxTotal: 4,
      sessions: [
        session('run-1', secondary, 1000),
        session('run-2', tertiary, 900),
        session('run-3', secondary, 850),
        session('recent-1', secondary, 800),
        session('recent-2', tertiary, 700),
        session('recent-3', secondary, 600),
      ],
      statuses: { 'run-1': { type: 'busy' }, 'run-2': { type: 'retry', attempt: 1, message: 'x', next: 0 }, 'run-3': { type: 'busy' } },
    });
    assert.deepEqual(capped.map((item) => item.sessionId), ['run-1', 'run-2', 'run-3', 'recent-1']);
  });
});
