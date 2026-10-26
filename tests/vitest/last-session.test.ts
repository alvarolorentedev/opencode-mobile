import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';
import { describe, it } from 'vitest';

// The remembered-session map is nested by connection scope, so the same project
// path on two servers remembers different sessions. Legacy flat maps fail
// validation and are removed by the persistence loader.
//
// Migrated from the standalone tests/last-session.test.mjs Node script.
describe('last-session storage scoping', () => {
  it('keys remembered sessions by connection scope and rejects legacy flat maps', async () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const root = path.join(here, '..', '..');

    async function transpileToDataUri(relativePath: string, replacements: [RegExp, string][] = []) {
      const source = await readFile(path.join(root, relativePath), 'utf8');
      let transpiled = ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
      }).outputText;
      for (const [pattern, replacement] of replacements) {
        transpiled = transpiled.replace(pattern, replacement);
      }
      return `data:text/javascript,${encodeURIComponent(transpiled)}`;
    }

    const base64Uri = `data:text/javascript,${encodeURIComponent(
      `import { base64 } from ${JSON.stringify(pathToFileURL(path.join(root, 'node_modules/@scure/base/lib/index.js')).href)}; export { base64 };`,
    )}`;
    const zodUri = `data:text/javascript,${encodeURIComponent(
      `import { z } from ${JSON.stringify(pathToFileURL(path.join(root, 'node_modules/zod/index.cjs')).href)}; export { z };`,
    )}`;
    const connectionScopeUri = await transpileToDataUri('lib/connection-scope.ts', [
      [/from '@scure\/base'/g, `from "${base64Uri}"`],
    ]);
    const lastSessionUri = await transpileToDataUri('providers/last-session-storage.ts', [
      [/from 'zod'/g, `from "${zodUri}"`],
    ]);

    const { getConnectionScope } = await import(connectionScopeUri);
    const { parseLastSessionByConnection, serializeLastSessionByConnection } = await import(lastSessionUri);

    const scopeA = getConnectionScope({ serverUrl: 'https://a.example', username: 'alice' });
    const scopeB = getConnectionScope({ serverUrl: 'https://b.example', username: 'alice' });

    // 1. Same project path, different servers: independent remembered sessions.
    {
      const stored = serializeLastSessionByConnection({
        [scopeA]: { '/srv/same/project': 'session-a' },
        [scopeB]: { '/srv/same/project': 'session-b' },
      });
      const parsed = parseLastSessionByConnection(stored);
      assert.equal(parsed[scopeA]['/srv/same/project'], 'session-a');
      assert.equal(parsed[scopeB]['/srv/same/project'], 'session-b');
      assert.deepEqual(parsed, {
        [scopeA]: { '/srv/same/project': 'session-a' },
        [scopeB]: { '/srv/same/project': 'session-b' },
      });
    }

    // 2. Multiple projects per connection and multiple connections coexist.
    {
      const value = {
        [scopeA]: { '/repo/one': 'a1', '/repo/two': 'a2' },
        [scopeB]: { '/repo/one': 'b1' },
      };
      assert.deepEqual(parseLastSessionByConnection(serializeLastSessionByConnection(value)), value);
    }

    // 3. The legacy flat map cannot be attributed to a server, so it fails
    // validation and the loader removes the key.
    {
      assert.throws(() => parseLastSessionByConnection(JSON.stringify({ '/repo': 'session-1' })));
      assert.throws(() => parseLastSessionByConnection(JSON.stringify({ [scopeA]: { '/repo': 5 } })));
      assert.throws(() => parseLastSessionByConnection(JSON.stringify({ '': { '/repo': 'session-1' } })));
      assert.throws(() => parseLastSessionByConnection(JSON.stringify({ [scopeA]: ['session-1'] })));
    }

    // 4. Non-object payloads are invalid.
    {
      assert.throws(() => parseLastSessionByConnection('[]'));
      assert.throws(() => parseLastSessionByConnection('"map"'));
      assert.throws(() => parseLastSessionByConnection('null'));
      assert.throws(() => parseLastSessionByConnection('{not json'));
    }
  });
});
