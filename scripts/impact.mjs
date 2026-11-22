#!/usr/bin/env node
// Lists test files that depend on a source file, directly or transitively.
// Usage: npm run impact -- features/chat/ui/chat-view.tsx
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const SOURCE_DIRS = ['app', 'features', 'runtime', 'shared', 'tests'];
const RESOLVE_EXTENSIONS = ['.ts', '.tsx', '.mjs', '.js', '/index.ts', '/index.tsx'];

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('._') || entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(?:ts|tsx|mjs|js)$/.test(entry.name)) out.push(full);
  }
  return out;
}

function sourceFiles(root) {
  return SOURCE_DIRS.flatMap((dir) => {
    const full = path.join(root, dir);
    return fs.existsSync(full) ? walk(full) : [];
  }).map((file) => path.relative(root, file).split(path.sep).join('/'));
}

function resolveImport(root, from, specifier) {
  const base = specifier.startsWith('@/')
    ? specifier.slice(2)
    : specifier.startsWith('.')
      ? path.posix.normalize(path.posix.join(path.posix.dirname(from), specifier))
      : undefined;
  if (!base) return undefined;
  for (const ending of ['', ...RESOLVE_EXTENSIONS]) {
    const candidate = `${base}${ending}`;
    if (fs.existsSync(path.join(root, candidate))) return candidate;
  }
  return undefined;
}

export function collectImpact(root, target) {
  const files = sourceFiles(root);
  const known = new Set(files);
  const normalized = path.relative(root, path.resolve(root, target)).split(path.sep).join('/');
  if (!known.has(normalized)) throw new Error(`Unknown source file: ${normalized}`);
  const importers = new Map();
  for (const file of files) {
    const source = fs.readFileSync(path.join(root, file), 'utf8')
      .replace(/^\s*(?:import|export)\s+type\s[^;]+;/gm, '');
    for (const match of source.matchAll(/(?:from\s*|import\s*\(|require\s*\()\s*['"]([^'"]+)['"]/g)) {
      const resolved = resolveImport(root, file, match[1]);
      if (!resolved || !known.has(resolved) || resolved === file) continue;
      const list = importers.get(resolved) ?? [];
      list.push(file);
      importers.set(resolved, list);
    }
  }
  const affected = new Set([normalized]);
  const queue = [normalized];
  while (queue.length) {
    const current = queue.shift();
    for (const importer of importers.get(current) ?? []) {
      if (affected.has(importer)) continue;
      affected.add(importer);
      queue.push(importer);
    }
  }
  return [...affected].filter((file) => /(?:^|\/)(?:__tests__\/)?[^/]+\.test\.[^/]+$/.test(file)).sort();
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const target = process.argv[2];
  if (!target) {
    console.error('Usage: npm run impact -- <source-file>');
    process.exit(1);
  }
  try {
    const affected = collectImpact(process.cwd(), target);
    console.log(affected.length ? affected.join('\n') : 'No affected tests found.');
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
