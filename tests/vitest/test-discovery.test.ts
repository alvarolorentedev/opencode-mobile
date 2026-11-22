import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, it } from 'vitest';
import config from '../../vitest.config.mts';

const root = fileURLToPath(new URL('../../', import.meta.url));
function testFiles(dir: string): string[] {
  return readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((entry) => {
    if (entry.name.startsWith('._')) return [];
    const file = `${dir}/${entry.name}`;
    return entry.isDirectory() ? testFiles(file) : /\.test\.tsx?$/.test(file) ? [file] : [];
  });
}

describe('test discovery', () => {
  it('collects and typechecks every existing Vitest suite, including colocated tests', () => {
    const pluginIntegration = 'tests/integration/server-plugin-commands.test.ts';
    const typedFiles = ['tests/vitest', 'tests/integration', 'features', 'shared', 'runtime'].flatMap(testFiles);
    const files = typedFiles.filter((file) => file !== pluginIntegration || process.env.OPENCODE_REAL_SERVER_TEST === '1');
    const includes = config.test?.include ?? [];
    const excludes = config.test?.exclude ?? [];
    assert.ok(files.some((file) => file.includes('/__tests__/')), 'Colocated suites must exist.');
    assert.deepEqual(files.filter((file) => !includes.some((pattern) => path.matchesGlob(file, pattern)) || excludes.some((pattern) => path.matchesGlob(file, pattern))), [], 'Every suite must match Vitest discovery exactly once.');
    for (const file of files) assert.equal(includes.filter((pattern) => path.matchesGlob(file, pattern)).length, 1, `${file}: overlapping discovery globs`);
    const loaded = ts.parseConfigFileTextToJson('tsconfig.tests.json', readFileSync(path.join(root, 'tsconfig.tests.json'), 'utf8'));
    assert.equal(loaded.error, undefined);
    const parsed = ts.parseJsonConfigFileContent(loaded.config, ts.sys, root);
    assert.deepEqual(parsed.errors, []);
    const typed = new Set(parsed.fileNames.map((file) => path.relative(root, file)));
    assert.deepEqual(typedFiles.filter((file) => !typed.has(file)), [], 'No test may disappear from TypeScript test checking.');
  });
});
