import { useEffect, useRef, useState, type PointerEvent } from 'react';
import type { Modifiers } from './terminal-keys';

export type AccessoryLabels = {
  paste: string; copy: string; latest: string; input: string; more: string;
  armed: string; locked: string; off: string;
};
type ModifierState = 'off' | 'armed' | 'locked';
export type AccessoryState = {
  modifiers: Modifiers;
  consume: () => void;
  clear: () => void;
  toggle: (key: keyof Modifiers) => void;
  states: Record<keyof Modifiers, ModifierState>;
};

export function useTerminalModifiers(): AccessoryState {
  const [states, setStates] = useState<Record<keyof Modifiers, ModifierState>>({ ctrl: 'off', alt: 'off', shift: 'off' });
  const lastTap = useRef({ key: '', time: 0 });
  return {
    states,
    modifiers: { ctrl: states.ctrl !== 'off', alt: states.alt !== 'off', shift: states.shift !== 'off' },
    consume: () => setStates((current) => Object.fromEntries(Object.entries(current).map(([key, state]) => [key, state === 'armed' ? 'off' : state])) as typeof states),
    clear: () => { setStates({ ctrl: 'off', alt: 'off', shift: 'off' }); lastTap.current = { key: '', time: 0 }; },
    toggle: (key) => {
      const now = Date.now();
      const double = lastTap.current.key === key && now - lastTap.current.time < 300;
      setStates((current) => ({ ...current, [key]: current[key] === 'locked' ? 'off' : double && current[key] === 'armed' ? 'locked' : current[key] === 'off' ? 'armed' : 'off' }));
      lastTap.current = { key, time: now };
    },
  };
}

export function TerminalAccessory({ state, labels, disabled, expanded, onExpand, onKey, onPaste, onCopy, selected }: {
  state: AccessoryState; labels: AccessoryLabels; disabled: boolean; expanded: boolean;
  onExpand: () => void; onKey: (key: string) => void; onPaste: () => void; onCopy: () => void; selected: boolean;
}) {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const keepFocus = (event: PointerEvent<HTMLButtonElement>) => { if (event.pointerType !== 'mouse' || event.button === 0) event.preventDefault(); };
  const repeat = (event: PointerEvent<HTMLButtonElement>, key: string) => {
    keepFocus(event);
    if (!/^Arrow/.test(key)) return;
    const element = event.currentTarget;
    timer.current = setTimeout(function tick() { onKey(key); timer.current = setTimeout(tick, 80); }, 450);
    element.setPointerCapture(event.pointerId);
  };
  const button = (key: string, title = key) => <button key={key} type="button" disabled={disabled} aria-label={key} onPointerDown={(event) => repeat(event, key)} onPointerUp={() => clearTimeout(timer.current)} onPointerCancel={() => clearTimeout(timer.current)} onClick={() => onKey(key)}>{title}</button>;
  return <div className="terminal-accessory" data-testid="terminal-accessory">
    <div className="terminal-key-row">
      {button('ArrowUp', '↑')}{button('ArrowDown', '↓')}{button('ArrowLeft', '←')}{button('ArrowRight', '→')}
      {button('Tab')}{button('Escape', 'Esc')}
      {(['ctrl', 'alt', 'shift'] as const).map((key) => <button type="button" key={key} disabled={disabled} aria-label={`${key[0].toUpperCase()}${key.slice(1)}, ${labels[state.states[key]]}`} aria-pressed={state.modifiers[key]} data-state={state.states[key]} onPointerDown={keepFocus} onClick={() => state.toggle(key)}>{key[0].toUpperCase()}{key.slice(1)}{state.states[key] === 'locked' ? ' •' : ''}</button>)}
      <button type="button" aria-label={labels.more} aria-expanded={expanded} onPointerDown={keepFocus} onClick={onExpand}>Fn</button>
      {selected && <button type="button" onPointerDown={keepFocus} onClick={onCopy}>{labels.copy}</button>}
    </div>
    {expanded && <div className="terminal-key-row">
      {Array.from({ length: 12 }, (_, i) => button(`F${i + 1}`))}
      {['Home', 'End', 'PageUp', 'PageDown', 'Insert', 'Delete'].map((key) => button(key))}
      <button type="button" disabled={disabled} onPointerDown={keepFocus} onClick={onPaste}>{labels.paste}</button>
    </div>}
    <span role="status" className="terminal-sr-only">{Object.entries(state.states).filter(([, value]) => value !== 'off').map(([key, value]) => `${key} ${labels[value as ModifierState]}`).join(', ')}</span>
  </div>;
}
