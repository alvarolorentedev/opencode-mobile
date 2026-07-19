import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const source = await readFile(new URL('../lib/opencode/workspace-patch.ts', import.meta.url), 'utf8');
const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText;
const { createFullFilePatch } = await import(`data:text/javascript,${encodeURIComponent(output)}`);

assert.equal(createFullFilePatch({ path: 'src/demo.ts', expectedContent: 'old\n', content: 'new\n' }), [
  '--- a/src/demo.ts',
  '+++ b/src/demo.ts',
  '@@ -1,1 +1,1 @@',
  '-old',
  '+new',
  '',
].join('\n'));
assert.equal(createFullFilePatch({ path: 'safe.txt', expectedContent: 'same', content: 'same' }), '');
assert.throws(() => createFullFilePatch({ path: '../secret', expectedContent: '', content: 'x' }), /safe relative path/);

console.log('workspace patch tests passed');
