import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

export type ImportEdge = { target: string; symbols: string[]; typeOnly: boolean };
export type SourceModule = { file: string; source: string; imports: ImportEdge[] };
export const sourceRoots = ['app', 'features', 'runtime', 'shared'];

export function sourceFiles(root: string): string[] {
  function walk(dir: string): string[] {
    return fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((entry) => {
      if (entry.name.startsWith('._') || entry.name === '__tests__') return [];
      const file = `${dir}/${entry.name}`;
      return entry.isDirectory() ? walk(file) : /\.(?:tsx?|[cm]?js)$/.test(file) && !/\.(?:test|stories|d)\./.test(file) ? [file] : [];
    });
  }
  return sourceRoots.flatMap(walk).concat('index.js');
}

export function resolveImport(from: string, specifier: string, files: Set<string>): string | undefined {
  const base = specifier.startsWith('@/') ? specifier.slice(2)
    : specifier.startsWith('.') ? path.posix.normalize(path.posix.join(path.posix.dirname(from), specifier)) : undefined;
  if (!base) return undefined;
  for (const suffix of ['', '.ts', '.tsx', '.js', '.mjs', '.native.ts', '.native.tsx', '.web.ts', '.web.tsx', '.ios.ts', '.ios.tsx', '.android.ts', '.android.tsx', '/index.ts', '/index.tsx']) {
    if (files.has(base + suffix)) return base + suffix;
  }
  return undefined;
}

export function parseImports(file: string, source: string): ImportEdge[] {
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const result: ImportEdge[] = [];
  function visit(node: ts.Node) {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.importClause;
      const bindings = clause?.namedBindings;
      const names = bindings && ts.isNamedImports(bindings) ? bindings.elements.map((el) => (el.propertyName ?? el.name).text) : [];
      result.push({ target: node.moduleSpecifier.text, symbols: clause?.name ? ['default', ...names] : bindings && ts.isNamespaceImport(bindings) ? ['*'] : names,
        typeOnly: Boolean(clause?.isTypeOnly || bindings && ts.isNamedImports(bindings) && bindings.elements.length && bindings.elements.every((el) => el.isTypeOnly)) });
      return;
    }
    if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      const bindings = node.exportClause;
      result.push({ target: node.moduleSpecifier.text,
        symbols: bindings && ts.isNamedExports(bindings) ? bindings.elements.map((el) => (el.propertyName ?? el.name).text) : ['*'],
        typeOnly: node.isTypeOnly || Boolean(bindings && ts.isNamedExports(bindings) && bindings.elements.length && bindings.elements.every((el) => el.isTypeOnly)) });
      return;
    }
    if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) {
      result.push({ target: node.argument.literal.text, symbols: [node.qualifier?.getText(ast).split('.')[0] ?? '*'], typeOnly: true });
      return;
    }
    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || ts.isIdentifier(node.expression) && node.expression.text === 'require') && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) {
      result.push({ target: node.arguments[0].text, symbols: ['*'], typeOnly: false });
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return result;
}

export function moduleGraph(root: string): SourceModule[] {
  return sourceFiles(root).map((file) => {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    return { file, source, imports: parseImports(file, source) };
  });
}

export function cycles(graph: Map<string, Set<string>>): string[][] {
  const visiting = new Set<string>(), visited = new Set<string>(), stack: string[] = [], found: string[][] = [];
  function visit(node: string) {
    if (visiting.has(node)) { found.push([...stack.slice(stack.indexOf(node)), node]); return; }
    if (visited.has(node)) return;
    visiting.add(node); stack.push(node);
    for (const target of graph.get(node) ?? []) visit(target);
    stack.pop(); visiting.delete(node); visited.add(node);
  }
  for (const node of graph.keys()) visit(node);
  return found;
}

export function reachable(graph: Map<string, Set<string>>, start: string): Set<string> {
  const seen = new Set<string>();
  function visit(node: string) { if (seen.has(node)) return; seen.add(node); for (const target of graph.get(node) ?? []) visit(target); }
  visit(start);
  return seen;
}
