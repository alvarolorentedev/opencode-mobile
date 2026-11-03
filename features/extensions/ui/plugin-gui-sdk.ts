import {
  createComponent,
  createContext,
  createEffect,
  createRoot,
  createSignal,
  getOwner,
  onCleanup,
  runWithOwner,
  useContext,
  type Accessor,
  type Component,
  type JSX,
} from 'solid-js';
import { createStore } from 'solid-js/store';

export type PluginContextValue = Record<string, any>;
export type PanelFrame = {
  visible(): boolean;
  present(): boolean;
  placement(): 'side' | 'mobile';
  reserve(): boolean;
  animate(): boolean;
  open(): string[];
  sidebar: {
    opened(): boolean;
    width(): number;
    transition(): boolean;
    resize(width: number): void;
    toggle(): void;
  };
};

export type DrawerFrame = {
  close(): void;
  open(view: { title: string; content: JSX.Element; trigger: HTMLElement }): void;
};

/** The host provides this around setup and every contribution it renders. `usePlugin` reads it. */
export const PluginContext = createContext<PluginContextValue | undefined>(undefined);
export const PanelContext = createContext<PanelFrame | undefined>(undefined);
export const DrawerContext = createContext<DrawerFrame | undefined>(undefined);

export function usePlugin(): PluginContextValue {
  const value = useContext(PluginContext);
  if (!value) throw new Error('usePlugin must run inside a plugin contribution');
  return value;
}

export function usePanel(): PanelFrame {
  const value = useContext(PanelContext);
  if (!value) throw new Error('usePanel must run inside a panel render');
  return value;
}

export function useDrawer(): DrawerFrame | undefined {
  return useContext(DrawerContext);
}

export function bindPlugin<P extends Record<string, any>>(component: Component<P>): Component<P> {
  // eslint-disable-next-line react-hooks/rules-of-hooks -- Solid context, not React hooks.
  const context = usePlugin();
  return (props: P) =>
    createComponent(PluginContext.Provider, {
      value: context,
      get children() {
        return createComponent(component, props);
      },
    });
}

export function createVisitState<T>(initial: T): [Accessor<T>, (next: T) => void] {
  const [value, setValue] = createSignal(initial);
  return [value, setValue];
}

export function createKeyed<T>(
  source: () => T | null | undefined | false,
  fn: (value: T) => void,
  options?: { otherwise?(): void; equals?(previous: T, next: T): boolean },
): void {
  let current: T | undefined;
  let dispose: (() => void) | undefined;
  createEffect(() => {
    const raw = source();
    const next = raw === undefined || raw === null || raw === false ? undefined : raw;
    if (next === undefined) {
      if (current === undefined) return;
      dispose?.();
      dispose = undefined;
      current = undefined;
      options?.otherwise?.();
      return;
    }
    if (current !== undefined && (current === next || options?.equals?.(current, next))) {
      current = next;
      return;
    }
    dispose?.();
    current = next;
    const owner = getOwner();
    createRoot((stop) => {
      dispose = stop;
      runWithOwner(owner, () => fn(next));
    });
  });
  onCleanup(() => dispose?.());
}

export function createLatest<S, T>(
  source: () => S | null | undefined | false,
  load: (value: S, signal: AbortSignal) => Promise<T>,
): LatestResult<T> {
  const [state, setState] = createStore<{ latest?: T; loading: boolean; error?: unknown }>({ loading: false });
  createKeyed(
    source,
    (value) => {
      const controller = new AbortController();
      onCleanup(() => controller.abort());
      setState({ loading: true, error: undefined });
      void Promise.resolve(load(value, controller.signal)).then(
        (latest) => {
          if (!controller.signal.aborted) setState({ latest, loading: false, error: undefined });
        },
        (error: unknown) => {
          if (!controller.signal.aborted) setState({ loading: false, error });
        },
      );
    },
    { otherwise: () => setState({ loading: false }) },
  );
  return {
    get latest() {
      return state.latest;
    },
    get loading() {
      return state.loading;
    },
    get error() {
      return state.error;
    },
  };
}

export type LatestResult<T> = { latest: T | undefined; loading: boolean; error: unknown };

const live = Symbol.for('opencode.plugin.live');

export function liveAccessor<T>(read: () => T): Accessor<T> {
  return Object.assign(read, { [live]: true });
}

export function isLiveAccessor(source: Accessor<unknown>): boolean {
  return live in source;
}

export type RegistryToken<T> = { readonly kind: 'registry'; readonly id: string; readonly __type?: T };
export type ContractToken<T> = { readonly kind: 'contract'; readonly id: string; readonly __type?: T };
export type IpcSpec = { readonly id: string; readonly methods: Record<string, unknown>; readonly events?: Record<string, unknown> };
export type IpcToken<S extends IpcSpec = IpcSpec> = { readonly kind: 'ipc'; readonly id: string; readonly spec: S };

export const Registry = {
  define<T>(id: string): RegistryToken<T> {
    return { kind: 'registry', id };
  },
};

export const Contract = {
  define<T, Id extends string = string>(id: Id): ContractToken<T> {
    return { kind: 'contract', id };
  },
};

export const Ipc = {
  define<S extends IpcSpec>(spec: S): IpcToken<S> {
    return { kind: 'ipc', id: spec.id, spec };
  },
};

export const Store = {
  global(schema: unknown, initial: unknown, from?: string | string[]) {
    return { scope: 'global' as const, schema, initial, from };
  },
  session(schema: unknown, initial: unknown, from?: string | string[]) {
    return { scope: 'session' as const, schema, initial, from };
  },
};

export const Plugin = {
  define<T>(definition: T): T {
    return definition;
  },
};

const registry = <T>(id: string) => Registry.define<T>(id);

export const Command = registry<any>('command');
export const MenuItem = registry<any>('menu-item');
export const Panel = registry<any>('panel');
export const SettingsPage = registry<any>('settings-page');
export const Server = registry<any>('server');
export const LinkHandler = registry<any>('link-handler');
export const TitlebarItem = registry<any>('titlebar-item');
export const ComposerPill = registry<any>('composer-pill');
export const Slot = registry<any>('slot');
export const Style = registry<string>('style');

export const FileTree = Contract.define<any, 'file.tree'>('file.tree');
export const OpenInApp = Contract.define<any, 'file.openInApp'>('file.openInApp');
export const FileViewer = registry<any>('file.viewer');
export const Changes = Contract.define<any, 'review.changes'>('review.changes');
export const Browser = Contract.define<any, 'browser'>('browser');

export const Rpc = {
  define<T>(spec: T): T {
    return spec;
  },
};

export const pluginGuiSdk = {
  Plugin,
  Registry,
  Contract,
  Ipc,
  Store,
  Command,
  MenuItem,
  Panel,
  SettingsPage,
  Server,
  LinkHandler,
  TitlebarItem,
  ComposerPill,
  Slot,
  Style,
  usePlugin,
  usePanel,
  useDrawer,
  bindPlugin,
  createKeyed,
  createLatest,
  createVisitState,
  liveAccessor,
  isLiveAccessor,
};

export const pluginGuiFile = { FileTree, OpenInApp, FileViewer };
export const pluginGuiReview = { Changes };
export const pluginGuiBrowser = { Browser };
