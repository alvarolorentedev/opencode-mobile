import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

export async function loadTs(relative, imports = {}, globals = {}) {
  const source = await readFile(new URL(`../../${relative}`, import.meta.url), 'utf8');
  /** @type {any} */
  const exports = {};
  runInNewContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, {
    exports, console, Headers, URL, AbortController, TextEncoder, TextDecoder, Response, setTimeout, clearTimeout, setInterval, clearInterval,
    require(name) { if (!(name in imports)) throw new Error(`Missing test import ${name} in ${relative}`); return imports[name]; },
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
