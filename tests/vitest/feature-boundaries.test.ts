import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'vitest';
import { cycles, moduleGraph, parseImports, reachable, resolveImport } from '../helpers/architecture.mts';
import policy from '../../config/architecture.json';

const root = fileURLToPath(new URL('../../', import.meta.url));
const owner = (file: string) => file.match(/^features\/([^/]+)\//)?.[1];
const uiException: Record<string, string[]> = {
  'shared/ui/alert-dialog.tsx': ['WorkspaceScopeContext'],
  'shared/ui/select.tsx': ['WorkspaceScopeContext'],
  'shared/ui/portal.tsx': ['WorkspaceScope', 'WorkspaceScopeContext'],
  'shared/ui/overlay-sheet.tsx': ['WorkspaceScopeContext', 'useUpdateBlocker'],
  'shared/ui/catalog-select.tsx': ['useUpdateBlocker'],
  'shared/ui/use-confirmation.tsx': ['useUpdateBlocker'],
};
const isUi = (file: string) => file.startsWith('app/') || file.startsWith('shared/ui/') || /^features\/[^/]+\/ui\//.test(file);

export function importViolations(from: string, target: string, symbols: string[], typeOnly: boolean): string[] {
  const problems: string[] = [];
  const a = owner(from), b = owner(target);
  if (a && b && a !== b) {
    if (!(policy.features[a as keyof typeof policy.features] as readonly string[]).includes(b)) problems.push('undeclared feature dependency');
    if (!/^features\/[^/]+\/(?:index|runtime|context)\.ts$/.test(target)) problems.push('private feature import');
    if (isUi(from) && target.endsWith('/runtime.ts') && !typeOnly) problems.push('headless API in presentation');
  }
  if (from.startsWith('shared/')) {
    if (b) problems.push('shared depends on a feature');
    if (target.startsWith('runtime/')) {
      if (target !== 'runtime/ui.ts' || !uiException[from] || !symbols.length || symbols.some((name) => !uiException[from].includes(name))) problems.push('unauthorized shared runtime import');
    }
  }
  if (a && target.startsWith('runtime/') && !['runtime/ui.ts', 'runtime/workspace.ts'].includes(target)) problems.push('runtime private import');
  if (isUi(from) && !typeOnly && target.startsWith('modules/')) problems.push('native module in presentation');
  if (isUi(from) && !typeOnly && (target.startsWith('shared/protocol/') || target.startsWith('shared/storage/') || target.startsWith('shared/server-data/'))) problems.push('IO in presentation');
  return problems;
}

describe('feature boundaries', () => {
  it('rejects private/aliased imports, secret access and UI exception expansion', () => {
    assert.deepEqual(importViolations('features/chat/ui/example.tsx', 'features/sessions/state/private.ts', ['useSession'], false), ['private feature import']);
    assert.deepEqual(importViolations('shared/ui/button.tsx', 'runtime/ui.ts', ['WorkspaceScope'], false), ['unauthorized shared runtime import']);
    assert.deepEqual(importViolations('shared/ui/portal.tsx', 'runtime/ui.ts', ['WorkspaceScope'], false), []);
    assert.deepEqual(importViolations('shared/ui/portal.tsx', 'runtime/ui.ts', ['*'], false), ['unauthorized shared runtime import']);
    assert.deepEqual(importViolations('shared/ui/portal.tsx', 'runtime/workspace/workspace-context.tsx', ['WorkspaceScope'], false), ['unauthorized shared runtime import']);
    assert.deepEqual(importViolations('features/chat/ui/example.tsx', 'modules/opencode-activity/index.ts', ['default'], false), ['native module in presentation']);
    assert.deepEqual(importViolations('features/chat/ui/example.tsx', 'shared/storage/connection-password.ts', ['getPassword'], false), ['IO in presentation']);
    const names = new Set(['features/sessions/state/private.ts']);
    assert.equal(resolveImport('features/chat/ui/example.tsx', '../../sessions/state/private', names), 'features/sessions/state/private.ts');
    assert.equal(parseImports('x.ts', "export * from '@/features/sessions';")[0].symbols[0], '*');
    assert.equal(parseImports('x.ts', "import type { T } from './other';")[0].typeOnly, true);
    assert.equal(parseImports('x.ts', "const x = import('./other');")[0].typeOnly, false);
    assert.equal(cycles(new Map([['a', new Set(['b'])], ['b', new Set(['a'])]])).length, 1);
  });

  it('enforces public APIs and dependency direction across every production directory', () => {
    const modules = moduleGraph(root), files = new Set(modules.map((mod) => mod.file));
    const graph = new Map<string, Set<string>>(), featureGraph = new Map<string, Set<string>>();
    const problems: string[] = [];
    for (const mod of modules) {
      const values = new Set<string>(); graph.set(mod.file, values);
      const owners: [RegExp, string[]][] = [
        [/new QueryClient\s*\(/, ['shared/server-data/client.tsx']],
        [/<ServerDataProvider(?:\s|>)/, ['runtime/composition/opencode-provider.tsx']],
        [/<ConnectionRuntime(?:\s|>)/, ['runtime/workspace/workspace-provider.tsx']],
        [/<WorkspaceRuntime(?:\s|>)/, ['runtime/workspace/workspace-provider.tsx']],
        [/\buseWorkspaceConnections\s*\(/, ['runtime/workspace/use-workspace-connections.ts', 'runtime/workspace/workspace-provider.tsx']],
        [/\buseOpencodeProviderComposition\s*\(/, ['runtime/composition/use-opencode-provider-composition.ts', 'runtime/workspace/workspace-runtime.tsx']],
      ];
      for (const [mount, allowed] of owners) if (mount.test(mod.source) && !allowed.includes(mod.file)) problems.push(`${mod.file}: duplicate shared runtime owner`);
      for (const edge of mod.imports) {
        const target = resolveImport(mod.file, edge.target, files);
        const local = edge.target.startsWith('@/') ? edge.target.slice(2) : edge.target.startsWith('.') ? path.posix.normalize(path.posix.join(path.posix.dirname(mod.file), edge.target)) : edge.target;
        if (isUi(mod.file) && !edge.typeOnly && local.startsWith('modules/')) problems.push(`${mod.file}: presentation cannot import native modules directly`);
        if (!target) {
          if (edge.target.startsWith('@/') && !/\.(?:json|css|png|jpg|mp4)$/.test(edge.target)) problems.push(`${mod.file}: unresolved ${edge.target}`);
          continue;
        }
        for (const issue of importViolations(mod.file, target, edge.symbols, edge.typeOnly)) problems.push(`${mod.file} -> ${target}: ${issue}`);
        if (!edge.typeOnly) values.add(target);
        const a = owner(mod.file), b = owner(target);
        if (a && b && a !== b) { if (!featureGraph.has(a)) featureGraph.set(a, new Set()); featureGraph.get(a)!.add(b); }
      }
      if (isUi(mod.file)) {
        assert.doesNotMatch(mod.source, /\bfetch\s*\(|new XMLHttpRequest|from ['"](?:axios|expo-secure-store|@react-native-async-storage\/async-storage)['"]/, `${mod.file}: presentation cannot fetch or store secrets`);
        for (const edge of mod.imports.filter((edge) => !edge.typeOnly)) {
          if (/^expo-(?:clipboard|haptics|web-browser|intent-launcher|store-review|application|speech|audio|sharing|notifications|file-system)$/.test(edge.target)) problems.push(`${mod.file}: use the platform interface for ${edge.target}`);
        }
      }
    }
    assert.deepEqual(problems, []);
    assert.deepEqual(cycles(featureGraph), [], 'Feature dependencies, including type imports, must be acyclic.');
    assert.deepEqual(cycles(graph), [], 'Value imports must not create module cycles.');
    const uiReachable = [...reachable(graph, 'runtime/ui.ts')];
    assert.deepEqual(uiReachable.filter((file) => file.startsWith('runtime/shell/') || file.startsWith('runtime/composition/') || /workspace-provider|workspace-runtime|connection-runtime/.test(file) || /^features\/[^/]+\/ui\//.test(file)), [], 'The scope API must not reach root composition or feature presentation.');
    assert.deepEqual(modules.find((mod) => mod.file === 'runtime/ui.ts')!.imports.flatMap((edge) => edge.symbols).sort(), ['WorkspaceScope', 'WorkspaceScopeContext', 'useUpdateBlocker'].sort());
  });

  it('keeps feature export lists bounded and old implementation roots retired', () => {
    for (const [file, expected] of Object.entries(policy.exports)) {
      const source = fs.readFileSync(path.join(root, file), 'utf8');
      assert.doesNotMatch(source, /export\s+(?:type\s+)?\*/);
      const names = [...source.matchAll(/export\s+(?:type\s+)?\{([^}]+)\}/g)].flatMap((match) => match[1].split(',').map((part) => part.trim().split(/\s+as\s+/).at(-1)!.replace(/^type\s+/, ''))).filter(Boolean).sort();
      assert.deepEqual(names, [...expected].sort(), `${file}: public API changes require a deliberate policy update`);
    }
    for (const dir of ['components', 'providers', 'lib', 'hooks', 'constants', 'widgets']) {
      const full = path.join(root, dir);
      assert.ok(!fs.existsSync(full) || fs.readdirSync(full).every((name) => name.startsWith('._')), `${dir}: obsolete implementation root`);
    }
  });
});
