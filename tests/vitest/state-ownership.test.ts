import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { moduleGraph, resolveImport } from '../helpers/architecture.mts';

type Fact = { address: string; writers: string[]; selector: string; test: string; storeSetter?: string; keyFactory?: string; valueType?: string };
type CommandSurface = { factory: string; internal: string[]; evidence: Record<string, string> };
const root = fileURLToPath(new URL('../../', import.meta.url));
const config = JSON.parse(readFileSync(join(root, 'config/ownership.json'), 'utf8')) as {
  facts: Record<string, Fact>;
  recordTypes: string[];
  crossDomainCommands: Record<string, CommandSurface>;
};

function collect<T extends ts.Node>(source: ts.Node, matches: (node: ts.Node) => node is T) {
  const result: T[] = [];
  function visit(node: ts.Node) {
    if (matches(node)) result.push(node);
    ts.forEachChild(node, visit);
  }
  visit(source);
  return result;
}

function callName(expression: ts.Expression) {
  return ts.isIdentifier(expression) ? expression.text : ts.isPropertyAccessExpression(expression) ? expression.name.text : undefined;
}

function isFactWrite(fact: Fact, call: ts.CallExpression, keyAliases: Map<string, string>) {
  const name = callName(call.expression);
  if (fact.storeSetter && name === fact.storeSetter) return true;
  if (name !== 'setQueryData' && name !== 'setQueriesData') return false;
  const argument = call.arguments[0];
  if (fact.valueType && call.typeArguments?.some((type) => type.getText() === fact.valueType)) return true;
  if (!fact.keyFactory || !argument) return false;
  return collect(argument, ts.isCallExpression).some(({ expression }) => callName(expression) === fact.keyFactory)
    || collect(argument, ts.isIdentifier).some((node) => keyAliases.get(node.text) === fact.keyFactory);
}

describe('state ownership', () => {
  it('keeps fact writes, server records and presentation imports in their owning layers', () => {
    const modules = moduleGraph(root);
    const files = new Set(modules.map(({ file }) => file));
    const violations: string[] = [];
    for (const fact of Object.values(config.facts)) {
      for (const reference of [...fact.writers, fact.selector, fact.test]) expect(existsSync(join(root, reference)), reference).toBe(true);
    }
    for (const { file, imports, source } of modules) {
      const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
      const declarations = collect(ast, ts.isVariableDeclaration);
      const keyAliases = new Map(declarations.flatMap(({ name, initializer }) =>
        ts.isIdentifier(name) && initializer && ts.isCallExpression(initializer)
          ? [[name.text, callName(initializer.expression) ?? ''] as const] : []));
      for (const call of collect(ast, ts.isCallExpression)) {
        for (const fact of Object.values(config.facts)) {
          if (isFactWrite(fact, call, keyAliases) && !fact.writers.includes(file)) violations.push(`${file} writes ${fact.address}`);
        }
        const localState = callName(call.expression) === 'useState';
        if (localState && call.typeArguments?.some((type) =>
          collect(type, ts.isIdentifier).some((node) => config.recordTypes.includes(node.text)))) {
          violations.push(`${file} puts a server record in React state`);
        }
      }
      for (const edge of imports) {
        const target = resolveImport(file, edge.target, files);
        if (!target) continue;
        if (/^features\/[^/]+\/ui\//.test(file) && /^runtime\/core(?:[./])/.test(target)) {
          violations.push(`${file} imports ${target} directly`);
        }
        if (file.startsWith('runtime/core/') && /^features\/[^/]+\/ui\//.test(target)) {
          violations.push(`${file} imports presentation ${target}`);
        }
        if (file.startsWith('shared/') && target.startsWith('runtime/')) violations.push(`${file} imports ${target}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it('keeps commands hook-free and requires evidence for every exposed cross-domain action', () => {
    const violations: string[] = [];
    const modules = moduleGraph(root);
    const coreCommands = modules.filter(({ file }) => dirname(file) === 'runtime/core/commands');
    for (const { file, source } of coreCommands) {
      const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
      const hooks = collect(ast, ts.isCallExpression).filter(({ expression }) => /^use[A-Z]/.test(callName(expression) ?? ''));
      if (hooks.length) violations.push(`${file} invokes a React hook`);
      const surface = config.crossDomainCommands[file];
      if (!surface) continue;
      const factory = collect(ast, ts.isFunctionDeclaration).find(({ name }) => name?.text === surface.factory);
      const api = factory?.body?.statements.find(ts.isReturnStatement)?.expression;
      expect(api && ts.isObjectLiteralExpression(api), `Missing ${surface.factory} API`).toBe(true);
      if (!api || !ts.isObjectLiteralExpression(api)) continue;
      const actual = api.properties.map((property) => property.name?.getText()).filter(Boolean).sort();
      expect(actual, file).toEqual([...surface.internal, ...Object.keys(surface.evidence)].sort());
      for (const evidence of Object.values(surface.evidence)) {
        expect(
          existsSync(join(root, 'runtime/__tests__', evidence)) || existsSync(join(root, 'tests/integration', evidence)),
          `Missing command evidence ${evidence}`,
        ).toBe(true);
      }
    }
    expect(violations).toEqual([]);
  });
});
