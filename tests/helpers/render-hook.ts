import { act, createElement, useLayoutEffect, type ComponentType, type PropsWithChildren } from 'react';
import { createRoot } from 'react-dom/client';
import { onTestFinished } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Mount a hook using React's real commit, effects and subscription lifecycle. */
export function renderHook<Props, Value>(useValue: (props: Props) => Value, initialProps: Props,
  Wrapper?: ComponentType<PropsWithChildren>) {
  const host = document.createElement('div');
  const root = createRoot(host);
  const result = { current: undefined as Value | undefined };
  let mounted = true;
  function Probe({ value }: { value: Props }) {
    const rendered = useValue(value);
    useLayoutEffect(() => { result.current = rendered; }, [rendered]);
    return null;
  }
  function rerender(value: Props) {
    const probe = createElement(Probe, { value });
    act(() => root.render(Wrapper ? createElement(Wrapper, null, probe) : probe));
  }
  function unmount() {
    if (!mounted) return;
    mounted = false;
    act(() => root.unmount());
  }
  onTestFinished(unmount);
  rerender(initialProps);
  return { result: result as { current: Value }, rerender, unmount };
}
