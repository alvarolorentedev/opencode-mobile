export type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
};

type SetStateAction<T> = T | ((previous: T) => T);
type Dispatch<T> = (value: T) => void;

export type ReactHooks = {
  useState<T>(initial: T | (() => T)): [T, Dispatch<SetStateAction<T>>];
  useState<T = undefined>(): [T | undefined, Dispatch<SetStateAction<T | undefined>>];
  useEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void;
  useLayoutEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void;
  useRef<T>(initial: T): { current: T };
  useRef<T = undefined>(): { current: T | undefined };
  useMemo<T>(factory: () => T, deps?: readonly unknown[]): T;
  useCallback<T extends (...args: any[]) => any>(callback: T, deps?: readonly unknown[]): T;
};

export type HookRuntime = {
  react: ReactHooks;
  globals: any;
  mount: (hook: any, props: any) => any;
  update: (patch: Record<string, unknown>) => any;
  flush: () => any;
  settle: () => Promise<any>;
  readonly value: any;
  fire: (ms: number) => any;
  countTimers: (ms: number) => number;
  unmount: () => void;
};

export function hookRuntime(): HookRuntime;
export function deferred<T = unknown>(): Deferred<T>;
export function loadTs(
  relativePath: string,
  imports?: Record<string, unknown>,
  globals?: Record<string, unknown>,
): Promise<any>;
