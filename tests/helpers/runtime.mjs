import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import path from 'node:path';
import { queryRuntime } from './query-runtime.mjs';

export async function loadTs(relative, imports = {}, globals = {}) {
  if (Array.isArray(relative)) return Object.assign({}, ...await Promise.all(relative.map((file) => loadTs(file, imports, globals))));
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const resolved = { ...imports };
  if (imports.react) {
    resolved['@/features/ai/services/capabilities-snapshot'] ??= { clearCapabilitiesSnapshots: async () => {} };
    resolved['@/shared/protocol/services/session-service'] ??= {};
    resolved['@tanstack/react-query'] ??= queryRuntime(imports.react);
    resolved['@/shared/server-data/client'] ??= {
      useQueryIdentity: () => ({ connectionId: 'test', connectionScope: 'scope', authRevision: 0 }),
      useQueryActivity: () => true, useQueryForeground: () => true,
    };
  }
  if (resolved['@/shared/protocol/opencode/client']) resolved['@/shared/protocol/opencode/client'] = { withReadSignal: (client) => client, ...resolved['@/shared/protocol/opencode/client'] };
  const cache = new Map();
  function localFile(name, parent) {
    const base = name.startsWith('@/') ? name.slice(2) : name.startsWith('.') ? path.posix.normalize(path.posix.join(path.posix.dirname(parent), name)) : undefined;
    return base && [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`].find((file) => existsSync(path.join(root, file)) && /\.tsx?$/.test(file));
  }
  // Resolve suite-local stand-ins against the source file they were written for.
  for (const [name, value] of Object.entries(imports)) {
    if (!name.startsWith('.')) continue;
    const file = localFile(name, relative);
    if (file) resolved[`@/${file.replace(/\.tsx?$/, '')}`] = value;
  }
  function dependency(name, parent) {
    if (/(?:\/queries\/|shared\/server-data\/)/.test(parent) && name === '@/shared/protocol/opencode/client') return { withReadSignal: (client) => client, ...resolved[name] };
    if (name in resolved) return resolved[name];
    const file = localFile(name, parent);
    if (file) {
      const alias = `@/${file.replace(/\.tsx?$/, '')}`;
      if (alias in resolved) return resolved[alias];
      return evaluate(file);
    }
    throw new Error(`Missing test import ${name} in ${parent}`);
  }
  function evaluate(file) {
    if (cache.has(file)) return cache.get(file);
    const source = readFileSync(path.join(root, file), 'utf8');
    const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    // Public facades contain only exports. Resolve the requested symbol so a
    // focused hook test does not initialize unrelated native feature modules.
    if (ast.statements.length && ast.statements.every((node) => ts.isExportDeclaration(node) || ts.isImportDeclaration(node) && node.importClause?.isTypeOnly)) {
      const facade = new Proxy({}, {
        ownKeys() {
          return ast.statements.flatMap((node) => ts.isExportDeclaration(node) && !node.isTypeOnly
            ? node.exportClause && ts.isNamedExports(node.exportClause)
              ? node.exportClause.elements.filter((entry) => !entry.isTypeOnly).map((entry) => entry.name.text)
              : node.moduleSpecifier ? Object.keys(dependency(node.moduleSpecifier.text, file)) : []
            : []);
        },
        getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true }),
        get(_target, property) {
        if (property === 'then') return undefined;
        if (property === '__esModule') return true;
        for (const node of ast.statements) {
          if (!ts.isExportDeclaration(node) || !node.moduleSpecifier || node.exportClause && !ts.isNamedExports(node.exportClause)) continue;
          if (!node.exportClause) {
            const value = dependency(node.moduleSpecifier.text, file)[property];
            if (value !== undefined) return value;
            continue;
          }
          const entry = node.exportClause.elements.find((item) => item.name.text === property);
          if (entry) return dependency(node.moduleSpecifier.text, file)[(entry.propertyName ?? entry.name).text];
        }
      } });
      cache.set(file, facade);
      return facade;
    }
    const exports = {};
    cache.set(file, exports);
    runInNewContext(ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
    }).outputText, {
      exports, console, Headers, URL, AbortController, TextEncoder, TextDecoder, Response, setTimeout, clearTimeout, setInterval, clearInterval,
      require: (name) => dependency(name, file),
      ...globals,
    });
    return exports;
  }
  return evaluate(relative);
}

// Small deterministic hook driver: exercises provider orchestration with real
// hook source, mocked platform boundaries, and manually advanced timers.
export function hookRuntime() {
  const slots = [];
  let index = 0, dirty = false, mounted = true;
  const effects = { layout: [], passive: [] };
  const timers = new Map();
  let timerId = 0;
  const same = (a, b) => a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
  const memo = (create, deps) => {
    const i = index++;
    if (!slots[i] || !same(slots[i].deps, deps)) slots[i] = { value: create(), deps };
    return slots[i].value;
  };
  const effect = (kind) => (run, deps) => {
    const i = index++;
    if (!slots[i] || !same(slots[i].deps, deps)) effects[kind].push(() => {
      slots[i]?.cleanup?.();
      slots[i] = { deps, cleanup: run() };
    });
  };
  const react = {
    createContext: (value) => ({ value }),
    useContext: (context) => context.value,
    useReducer(reduce, initial) {
      const [value, setValue] = react.useState(initial);
      const dispatch = react.useCallback((event) => setValue((current) => reduce(current, event)), [reduce]);
      return [value, dispatch];
    },
    useState(initial) {
      const i = index++;
      if (!slots[i]) {
        slots[i] = { value: typeof initial === 'function' ? initial() : initial, set(next) {
          if (!mounted) return;
          const value = typeof next === 'function' ? next(slots[i].value) : next;
          if (!Object.is(value, slots[i].value)) { slots[i].value = value; dirty = true; }
        } };
      }
      return [slots[i].value, slots[i].set];
    },
    useRef(initial) { return memo(() => ({ current: initial }), []); },
    useMemo: memo,
    useCallback: (callback, deps) => memo(() => callback, deps),
    useEffect: effect('passive'), useLayoutEffect: effect('layout'),
  };
  let hook, props, value;
  const flush = () => {
    for (let pass = 0; pass < 30; pass++) {
      index = 0; dirty = false; value = hook(props);
      for (const kind of ['layout', 'passive']) while (effects[kind].length) effects[kind].shift()();
      if (!dirty) return value;
    }
    throw new Error('Hook did not settle');
  };
  return {
    react,
    globals: {
      setTimeout(fn, ms) { const id = ++timerId; timers.set(id, { fn, ms, interval: false }); return id; },
      setInterval(fn, ms) { const id = ++timerId; timers.set(id, { fn, ms, interval: true }); return id; },
      clearTimeout: (id) => timers.delete(id), clearInterval: (id) => timers.delete(id),
    },
    mount(fn, initial) { hook = fn; props = initial; return flush(); },
    update(patch) { props = { ...props, ...patch }; return flush(); },
    flush,
    // Async flows can chain several awaits (e.g. a failed production claim
    // followed by a staging re-init and re-claim). 60 microtask turns were not
    // enough for automatic Connect environment routing; keep headroom so the
    // hook reaches its settled state through serialized profile transactions too.
    async settle() { for (let i = 0; i < 240; i++) { await Promise.resolve(); flush(); } return value; },
    get value() { return value; },
    fire(ms) { for (const [id, timer] of [...timers]) if (timer.ms === ms && timers.has(id)) { if (!timer.interval) timers.delete(id); timer.fn(); } return flush(); },
    countTimers(ms) { return [...timers.values()].filter((timer) => timer.ms === ms).length; },
    unmount() { mounted = false; slots.forEach((slot) => slot.cleanup?.()); },
  };
}

export function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

// Mirrors FlashList's useRecyclingState: the value resets when the item
// identity (deps) changes, so tests can prove recycled cells cannot inherit a
// previous row's expansion.
export function recyclingState(runtime) {
  return function useRecyclingState(initial, deps) {
    const store = runtime.react.useRef({ value: initial });
    runtime.react.useMemo(() => {
      store.current.value = typeof initial === 'function' ? initial() : initial;
    }, deps);
    const [, setVersion] = runtime.react.useState(0);
    const setValue = (next) => {
      const value = typeof next === 'function' ? next(store.current.value) : next;
      if (Object.is(value, store.current.value)) return;
      store.current.value = value;
      setVersion((version) => version + 1);
    };
    return [store.current.value, setValue];
  };
}
