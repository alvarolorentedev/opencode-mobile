import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import path from 'node:path';
import { queryRuntime } from './query-runtime.mjs';

export async function loadTs(relative, imports = {}, globals = {}) {
  const source = await readFile(new URL(`../../${relative}`, import.meta.url), 'utf8');
  /** @type {any} */
  const exports = {};
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const resolved = { ...imports };
  if (imports.react) {
    resolved['@/providers/capabilities-snapshot'] ??= { clearCapabilitiesSnapshots: async () => {} };
    resolved['@/providers/services/session-service'] ??= {};
    resolved['@tanstack/react-query'] ??= queryRuntime(imports.react);
    resolved['@/providers/queries/client'] ??= {
      useQueryIdentity: () => ({ connectionId: 'test', connectionScope: 'scope', authRevision: 0 }),
      useQueryActivity: () => true, useQueryForeground: () => true,
    };
  }
  if (resolved['@/lib/opencode/client']) resolved['@/lib/opencode/client'] = { withReadSignal: (client) => client, ...resolved['@/lib/opencode/client'] };
  for (const match of output.matchAll(/require\("([^"]+)"\)/g)) {
    const name = match[1];
    const relativeClient = name.endsWith('/queries/client');
    if (relativeClient && resolved['@/providers/queries/client']) { resolved[name] = resolved['@/providers/queries/client']; continue; }
    if (name in resolved) continue;
    const local = (relative.startsWith('providers/queries/') && name.startsWith('./')) || name.startsWith('./queries/') || name.startsWith('@/providers/queries/') || ['@/providers/workspace-lifecycle', '@/lib/opencode/server-data-events', './lifecycle', './connection-lifecycle'].includes(name);
    if (local) {
      const file = name.startsWith('@/') ? name.slice(2) : path.join(path.dirname(relative), name);
      const dependencies = { '@/lib/opencode/client': { withReadSignal: (client) => client }, '@/providers/services/capabilities-service': {}, '@/providers/services/session-service': {}, '@/providers/services/project-service': {}, '@/lib/opencode/contracts/server-adapter': {}, '@/providers/opencode-model-selection': {}, ...resolved };
      resolved[name] = await loadTs(`${file}.ts`, dependencies, globals);
    }
  }
  runInNewContext(output, {
    exports, console, Headers, URL, AbortController, TextEncoder, TextDecoder, Response, setTimeout, clearTimeout, setInterval, clearInterval,
    require(name) { if (!(name in resolved)) throw new Error(`Missing test import ${name} in ${relative}`); return resolved[name]; },
    ...globals,
  });
  return exports;
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
