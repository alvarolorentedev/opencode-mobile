import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const source = await readFile(new URL('../lib/opencode/format.ts', import.meta.url), 'utf8');
const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText;
const { getMessagePreview, toTranscriptEntry, deriveTodosFromMessages } = await import(`data:text/javascript,${encodeURIComponent(output)}`);
const info = { id: 'message-1', role: 'assistant', sessionID: 'session-1', time: { created: 1 } };

assert.equal(getMessagePreview({ info, parts: [{ type: 'reasoning', text: 'private reasoning' }, { type: 'text', text: 'Visible reply' }] }), 'Visible reply');

const failedTool = toTranscriptEntry({
  info,
  parts: [{ id: 'tool-1', type: 'tool', tool: 'build', state: { status: 'error', error: 'Build failed' } }],
});
assert.equal(failedTool.details[0].body, 'Build failed');

const toolAttachment = toTranscriptEntry({
  info,
  parts: [{ id: 'tool-2', type: 'tool', tool: 'capture', state: { status: 'completed', output: 'done', attachments: [{ type: 'file', mime: 'image/png', filename: 'result.png' }] } }],
});
assert.equal(toolAttachment.details[1].label, 'result.png');

const todoWritePart = (id, todos) => ({
  id,
  type: 'tool',
  tool: 'todowrite',
  state: { status: 'completed', input: { todos }, output: '', title: 'todowrite', metadata: {} },
});

assert.deepEqual(
  deriveTodosFromMessages([
    { info, parts: [todoWritePart('tool-todo-1', [
      { content: 'First task', status: 'completed', priority: 'high' },
      { content: 'Second task', status: 'in_progress', priority: 'low' },
    ])] },
  ]),
  [
    { content: 'First task', status: 'completed', priority: 'high' },
    { content: 'Second task', status: 'in_progress', priority: 'low' },
  ],
);

// The latest write wins, including a clearing write.
assert.deepEqual(
  deriveTodosFromMessages([
    { info, parts: [todoWritePart('tool-todo-2', [{ content: 'Stale', status: 'pending', priority: 'low' }])] },
    { info, parts: [todoWritePart('tool-todo-3', [])] },
  ]),
  [],
);

// Non-todo tools never contribute a plan.
assert.deepEqual(
  deriveTodosFromMessages([
    { info, parts: [{ id: 'tool-bash', type: 'tool', tool: 'bash', state: { status: 'completed', input: { todos: [{ content: 'Nope' }] } } }] },
  ]),
  [],
);

console.log('format tests passed');
