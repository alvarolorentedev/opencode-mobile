import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

// Real ESM keeps DTO results in the caller's realm for the strict storage assertions.
export async function moduleSourceUri(root, relative, replacements = []) {
  const directory = root instanceof URL ? fileURLToPath(root) : root;
  const require = createRequire(path.join(directory, 'package.json'));
  const cache = new Map();
  async function compile(file) {
    if (cache.has(file)) return cache.get(file);
    const pending = (async () => {
      const source = await readFile(path.join(directory, file), 'utf8');
      let code = file.endsWith('.json') ? `export default ${source};` : ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
      }).outputText;
      for (const [pattern, replacement] of replacements) code = code.replace(pattern, replacement);
      const imports = [...code.matchAll(/(?:from\s+|import\s*\()(['"])([^'"]+)\1/g)];
      for (const match of imports) {
        const specifier = match[2];
        if (/^(?:data:|file:|node:)/.test(specifier)) continue;
        let target;
        if (specifier.startsWith('@/') || specifier.startsWith('.')) {
          const local = specifier.startsWith('@/') ? specifier.slice(2) : path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier));
          const candidates = /\.(?:tsx?|[cm]?js|json)$/.test(local) ? [local] : [local + '.ts', local + '.tsx', local + '/index.ts'];
          for (const candidate of candidates) {
            try { target = await compile(candidate); break; }
            catch (error) { if (error.code !== 'ENOENT') throw error; }
          }
          if (!target) throw new Error(`Cannot resolve ${specifier} from ${file}`);
        } else target = pathToFileURL(require.resolve(specifier)).href;
        code = code.replaceAll(match[1] + specifier + match[1], JSON.stringify(target));
      }
      return `data:text/javascript,${encodeURIComponent(code)}`;
    })();
    cache.set(file, pending);
    return pending;
  }
  return compile(relative);
}
