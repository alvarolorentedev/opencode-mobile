import * as solid from 'solid-js';
import * as solidWeb from 'solid-js/web';
import * as solidStore from 'solid-js/store';
import * as sdk from '@/features/extensions/ui/plugin-gui-sdk';
import { pluginGuiBrowser, pluginGuiFile, pluginGuiReview } from '@/features/extensions/ui/plugin-gui-sdk';

const nodeBuiltins = new Set([
  'assert',
  'buffer',
  'child_process',
  'crypto',
  'events',
  'fs',
  'fs/promises',
  'http',
  'https',
  'module',
  'net',
  'os',
  'path',
  'process',
  'stream',
  'timers',
  'tls',
  'tty',
  'url',
  'util',
  'zlib',
]);

function isNodeBuiltin(name: string) {
  return name.startsWith('node:') || nodeBuiltins.has(name);
}

/** A placeholder for a module a window never provides. It accepts any read, call or construction. */
export function inertModule(name: string): unknown {
  const label = `[inert module ${name}]`;
  const handler: ProxyHandler<() => void> = {
    get: (_, key) => {
      if (key === 'then') return undefined;
      if (key === Symbol.toPrimitive || key === 'toString') return () => label;
      if (key === Symbol.hasInstance) return () => false;
      return placeholder;
    },
    set: () => true,
    defineProperty: () => true,
    deleteProperty: () => true,
    apply: () => placeholder,
    construct: () => placeholder,
  };
  const placeholder = new Proxy<() => void>(function inert() {}, handler);
  return placeholder;
}

/**
 * The modules the mobile host provides to a plugin GUI bundle. Everything else
 * fails closed; the bundle's Vite preset keeps these names external.
 */
export function createPluginRequire(): (name: string) => unknown {
  const modules = new Map<string, unknown>([
    ['solid-js', solid],
    ['solid-js/web', solidWeb],
    ['solid-js/store', solidStore],
    ['@opencode/plugin/gui', sdk],
    ['@opencode/plugin/gui/main', sdk],
    ['@opencode/plugin/rpc', { Rpc: sdk.Rpc }],
    ['@opencode/schema/rpc', { Rpc: sdk.Rpc }],
    ['@opencode/plugin/gui/file', pluginGuiFile],
    ['@opencode/plugin/gui/review', pluginGuiReview],
    ['@opencode/plugin/gui/browser', pluginGuiBrowser],
  ]);

  return (name) => {
    const module = modules.get(name);
    if (module) return module;
    if (name === 'electron' || isNodeBuiltin(name)) return inertModule(name);
    throw new Error(`Plugin GUI requires a module this host does not provide: ${name}`);
  };
}
