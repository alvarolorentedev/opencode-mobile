import { createSignal, untrack } from 'solid-js';
import type { PluginBundle } from '@/features/extensions/ui/plugin-gui-loader';
import type {
  PluginGuiRpcRequest,
  PluginGuiServer,
  PluginGuiSession,
  PluginGuiTheme,
} from '@/features/extensions/model/plugin-gui';
import { createUi } from '@/features/extensions/ui/plugin-gui-ui';
import { createOverlays } from '@/features/extensions/ui/plugin-gui-dialogs';

export type PluginHostBridge = {
  openSession(sessionID: string): void;
  openExternal(url: string): void;
  rpc(request: PluginGuiRpcRequest): Promise<unknown>;
  sessionGet(request: { sessionID: string }): Promise<unknown>;
  closePanel?(): void;
  openPanel?(key: string): void;
  openSettings?(): void;
  openProject?(server: string, title: string): void;
  openDraft?(input: { server: string; directory: string; prompt: string }): void;
};

export type PanelContribution = {
  id: string;
  region?: string;
  mobile?: { title: string; order: number; kind: 'tab' | 'menu' | 'drawer'; icon?: string; cached?: boolean };
  list?(input: unknown): unknown[];
  render(props: unknown): unknown;
  [key: string]: unknown;
};

type Args = {
  definition: PluginBundle;
  pluginId: string;
  options: Record<string, unknown>;
  session: PluginGuiSession;
  server: PluginGuiServer;
  bridge: PluginHostBridge;
  theme: PluginGuiTheme;
  locale: string;
  appVersion: string;
  signal: AbortSignal;
  root: ShadowRoot;
};

type Persisted = {
  readonly value: unknown;
  ready(): boolean;
  update(mutate: (draft: never) => void): void;
  set(next: unknown): void;
};

function persisted(initial: unknown): Persisted {
  const [value, setValue] = createSignal(initial);
  return {
    get value() {
      return value();
    },
    ready: () => true,
    update(mutate) {
      setValue((current) => {
        const draft = clone(current);
        mutate(draft as never);
        return draft;
      });
    },
    set: setValue,
  };
}

function clone<T>(value: T): T {
  try {
    return structuredClone(value);
  } catch {
    return JSON.parse(JSON.stringify(value)) as T;
  }
}

export function createPluginContext(args: Args) {
  const { definition, pluginId, options, session, server, bridge, theme, locale, appVersion, signal, root } = args;
  const panels: PanelContribution[] = [];
  const styles: string[] = [];
  const entries = new Map<string, unknown[]>();
  const provided = new Map<string, unknown>();
  const removers = new Set<() => void>();
  const rpcIds = new Set<string>();
  const storage = new Map<string, Persisted>();
  const memory = new Map<string, unknown>();
  const scroll = new Map<string, { x: number; y: number }>();
  const overlays = createOverlays(root, theme);
  const ui = createUi(theme);
  const messages = definition.i18n ?? {};
  const baseLocale = locale.split('-')[0];

  const resolve = (key: string, params?: Record<string, string | number | boolean>) => {
    let value = messages[locale]?.[key] ?? messages[baseLocale]?.[key] ?? messages.en?.[key] ?? key;
    for (const [name, replacement] of Object.entries(params ?? {})) {
      value = value.replaceAll(`{${name}}`, String(replacement));
    }
    return value;
  };

  const stores: Record<string, unknown> = {};
  const sessionStores = new Map<string, Persisted>();
  for (const [key, declaration] of Object.entries(definition.stores ?? {})) {
    const value = declaration as { scope?: string; initial?: unknown };
    if (value.scope !== 'session') {
      stores[key] = persisted(value.initial);
      continue;
    }
    stores[key] = (target: { id?: string } | undefined) => {
      const id = `${key}:${target?.id ?? 'none'}`;
      const existing = sessionStores.get(id);
      if (existing) return existing;
      const next = persisted(value.initial);
      sessionStores.set(id, next);
      return next;
    };
  }

  const owns = (id: string) => id === pluginId || id.startsWith(`${pluginId}.`);

  const add = (registry: { id: string }, item: unknown) => {
    const value = typeof item === 'function' ? untrack(item as () => unknown) : item;
    if (value === undefined) return () => {};
    if (registry.id === 'panel') {
      const panel = value as PanelContribution;
      if (panel && typeof panel.render === 'function') panels.push(panel);
    }
    if (registry.id === 'style' && typeof value === 'string') styles.push(value);
    const list = entries.get(registry.id) ?? [];
    list.push(value);
    entries.set(registry.id, list);
    const remove = () => {
      const current = entries.get(registry.id);
      if (current) entries.set(registry.id, current.filter((entry) => entry !== value));
      const index = panels.indexOf(value as PanelContribution);
      if (index >= 0) panels.splice(index, 1);
      const styleIndex = styles.indexOf(value as string);
      if (styleIndex >= 0) styles.splice(styleIndex, 1);
    };
    removers.add(remove);
    return remove;
  };

  const rpcClient = (contract: unknown) => {
    const id =
      typeof contract === 'string'
        ? contract
        : (contract as { id?: string; rpcID?: string } | undefined)?.id ??
          (contract as { rpcID?: string } | undefined)?.rpcID;
    if (!id) throw new Error('ctx.client.rpc requires an Rpc.define contract.');
    rpcIds.add(id);
    return new Proxy(
      {},
      {
        get(_, property) {
          if (property === 'then') return undefined;
          if (property === 'events') {
            return {
              on: () => () => {},
              subscribe: async function* empty() {},
            };
          }
          return (input?: unknown, requestOptions?: { location?: { directory?: string } }) =>
            bridge.rpc({
              rpcID: id,
              method: String(property),
              input,
              directory: requestOptions?.location?.directory,
            });
        },
      },
    );
  };

  const client = {
    rpc: rpcClient,
    session: {
      get: (input: { sessionID: string }) => bridge.sessionGet(input),
      list: async () => [session],
    },
  };

  const serverRef = {
    ...server,
    password: undefined,
    client,
    data: {
      on: () => () => {},
      sessions: [],
      projects: [],
    },
    local: true,
    compatible: true,
    connected: true,
  };

  const sessionRef = {
    key: `${server.id}\n${session.id}`,
    id: session.id,
    tab: session.id,
    server: serverRef,
    pending: false,
    location: { directory: session.directory },
    project: undefined,
    listedProject: undefined,
    directory: session.directory,
    local: true,
    background: [],
    visit: {},
  };

  const activeKey = () => (panels[0] ? `${pluginId}:${panels[0].id}` : `${pluginId}:panel`);

  const layout = {
    open(key: string, _session: unknown, options?: { background?: boolean }) {
      if (key === activeKey()) return;
      bridge.openPanel?.(key);
    },
    close(key: string) {
      if (key === activeKey()) bridge.closePanel?.();
    },
    toggle(key: string) {
      if (key === activeKey()) bridge.closePanel?.();
      else bridge.openPanel?.(key);
    },
    hide() {},
    state(key: string) {
      return key === activeKey() ? 'visible' : 'closed';
    },
    stored() {
      return panels.map((panel) => panel.id);
    },
    ready: () => true,
    narrow: () => true,
    side: {
      opened: () => true,
      toggle() {},
      menu: () =>
        panels
          .filter((panel) => panel.mobile)
          .map((panel) => ({
            menu: 'session.panel',
            id: panel.id,
            title: panel.mobile?.title ?? panel.id,
            icon: panel.mobile?.icon,
            opened: true,
            run: () => {},
          })),
    },
    sidebar: { opened: () => true },
    scroll: {
      get: (session: { key?: string }, key: string) => scroll.get(`${session.key ?? ''}:${key}`),
      set: (session: { key?: string }, key: string, value: { x: number; y: number }) =>
        scroll.set(`${session.key ?? ''}:${key}`, value),
    },
    settings: () => bridge.openSettings?.(),
    project: (serverID: string, title: string) => bridge.openProject?.(serverID, title),
    draft: (input: { server: string; directory: string; prompt: string }) => bridge.openDraft?.(input),
  };

  const tabs = {
    list: () => [{ key: `${server.id}:${session.id}`, session: sessionRef, active: true }],
    open: (input: { server: string; id: string }) => bridge.openSession(input.id),
    focus() {},
    move() {},
    close() {},
  };

  const system = {
    async copy(text: string) {
      if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
      const area = document.createElement('textarea');
      area.value = text;
      root.appendChild(area);
      area.select();
      document.execCommand('copy');
      area.remove();
    },
    async save(file: { name: string; content: string }) {
      const url = URL.createObjectURL(new Blob([file.content], { type: 'text/plain' }));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = file.name;
      anchor.click();
      URL.revokeObjectURL(url);
      return true;
    },
    openExternal(url: string) {
      bridge.openExternal(url);
    },
  };

  const main = (token: { spec?: { methods?: Record<string, unknown> }; methods?: Record<string, unknown> }) => {
    const methods = token?.spec?.methods ?? token?.methods ?? {};
    const clientMethods = Object.fromEntries(
      Object.keys(methods).map((name) => [
        name,
        () => Promise.reject(new Error('ctx.main is not available in the mobile plugin host.')),
      ]),
    );
    return Object.assign(clientMethods, {
      state: () => undefined,
      on: () => () => {},
    });
  };

  const context = {
    id: pluginId,
    options,
    client,
    app: { name: 'opencode', version: appVersion, channel: 'prod', platform: 'web', packaged: false },
    signal,
    add,
    list: (registry: { id: string }) => entries.get(registry.id) ?? [],
    provide(token: { kind?: string; id: string }, implementation: unknown) {
      if (token.kind === 'ipc') throw new Error('Ipcs are provided by a plugin main entry.');
      if (!owns(token.id)) throw new Error(`${pluginId} provides only its own contracts, not "${token.id}"`);
      provided.set(token.id, implementation);
      const remove = () => provided.delete(token.id);
      removers.add(remove);
      return remove;
    },
    use(token: { kind?: string; id: string }) {
      if (token.kind === 'ipc') return () => ({ status: 'inactive' as const, reason: 'disabled' as const });
      const read = () => {
        const value = provided.get(token.id);
        return value === undefined
          ? ({ status: 'inactive', reason: 'disabled' } as const)
          : ({ status: 'active', value, generation: 1 } as const);
      };
      return Object.assign(read, { [Symbol.for('opencode.plugin.live')]: true });
    },
    main,
    t: resolve,
    plural(key: string, count: number, params?: Record<string, string | number | boolean>) {
      const category = new Intl.PluralRules(locale).select(count);
      return resolve(`${key}.${category}`, { ...params, count });
    },
    layout,
    sessions: { current: () => sessionRef, list: () => [sessionRef] },
    screen: { current: () => undefined },
    servers: {
      list: () => [server.id],
      get: (id: string) => (id === server.id || id === 'sidecar' ? serverRef : undefined),
    },
    storage: {
      store(key: string, storeOptions: { initial?: unknown; scope?: unknown }) {
        const scope = storeOptions.scope;
        const scopeKey =
          scope && typeof scope === 'object' && 'session' in scope
            ? `session:${(scope as { session: { id: string } }).session.id}`
            : typeof scope === 'string'
              ? scope
              : 'global';
        const id = `${key}:${scopeKey}`;
        const existing = storage.get(id);
        if (existing) return existing;
        const next = persisted(storeOptions.initial);
        storage.set(id, next);
        return next;
      },
      memory(key: string, memoryOptions: { initial?: unknown }) {
        if (!memory.has(key)) memory.set(key, memoryOptions.initial);
        const read = () => memory.get(key);
        const write = (mutation: (draft: never) => void) => {
          const draft = clone(memory.get(key));
          mutation(draft as never);
          memory.set(key, draft);
        };
        return [read, write];
      },
      remove(key: string) {
        for (const id of storage.keys()) if (id === key || id.startsWith(`${key}:`)) storage.delete(id);
        memory.delete(key);
      },
    },
    dialogs: overlays.dialogs,
    toast: overlays.toast,
    attention: {
      async notify(input: { title: string; message?: string; variant?: 'default' | 'error' }) {
        overlays.toast.show({ title: input.title, description: input.message, variant: input.variant });
        return { notification: false, sound: false };
      },
    },
    tabs,
    keybinds: { keybind: () => [], keys: (bind: string) => bind.split('+'), matches: () => false },
    commands: { run: () => false },
    links: { open: () => false, exists: () => false },
    embeds: { View: () => null, capture: async () => undefined },
    ui,
    system,
    desktop: undefined,
    locale: { locale: () => locale, direction: () => 'ltr' as const },
    appearance: { font: () => 'monospace', mode: () => theme.mode },
    router: { path: () => '/', routing: () => false },
    workspaces: { on: () => () => {} },
    stores,
  };

  return {
    ctx: context,
    panels,
    styles,
    rpcIds,
    dispose() {
      removers.forEach((remove) => remove());
      removers.clear();
      provided.clear();
      panels.splice(0);
      styles.splice(0);
    },
  };
}
