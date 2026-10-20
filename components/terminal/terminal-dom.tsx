'use dom';

import { useEffect, useRef, useState, type Ref } from 'react';
import { useDOMImperativeHandle, type DOMImperativeFactory, type DOMProps } from 'expo/dom';
import { Terminal, type ITheme } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import './terminal.css';

import type { TerminalInstance } from '@/providers/terminal-types';
import { TerminalAccessory, useTerminalModifiers, type AccessoryLabels } from './terminal-accessory';
import { encodeTerminalKey } from './terminal-keys';
import { installTerminalTouch } from './terminal-touch';
import { installTerminalInput } from './terminal-input';

type JSONValue = Parameters<DOMImperativeFactory[string]>[number];

export type TerminalDOMRef = {
  write: (id: JSONValue, text: JSONValue, acknowledgement: JSONValue) => void;
  paste: (id: JSONValue, text: JSONValue) => void;
};
type Props = {
  ref?: Ref<TerminalDOMRef>; dom?: DOMProps;
  instances: TerminalInstance[]; activeId?: string; visible: boolean; slim: boolean;
  theme: ITheme; labels: AccessoryLabels;
  onReady: (id: string) => Promise<void>;
  onWritten: (id: string, acknowledgement: number) => Promise<void>;
  onInput: (id: string, data: string, generation: number) => Promise<void>;
  onResize: (id: string, cols: number, rows: number) => Promise<void>;
  onPaste: (id: string, text?: string) => Promise<void>;
  onCopy: (text: string) => Promise<void>;
  onError: (message: string) => Promise<void>;
};
type Display = { terminal: Terminal; fit: FitAddon; paste: (text: string) => void; dispose: () => void };

export default function TerminalDOM({ ref, instances, activeId, visible, slim, theme, labels, onReady, onWritten, onInput, onResize, onPaste, onCopy, onError }: Props) {
  const displays = useRef(new Map<string, Display>());
  const root = useRef<HTMLDivElement>(null);
  const callbacks = useRef({ onReady, onWritten, onInput, onResize, onPaste, onCopy, onError });
  const active = useRef(activeId);
  const isVisible = useRef(visible);
  const versions = useRef(new Map<string, number>());
  const accessory = useTerminalModifiers();
  const controls = useRef(accessory);
  const [expanded, setExpanded] = useState(false);
  const [selected, setSelected] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const inputQueue = useRef(Promise.resolve());

  useEffect(() => { callbacks.current = { onReady, onWritten, onInput, onResize, onPaste, onCopy, onError }; }, [onReady, onWritten, onInput, onResize, onPaste, onCopy, onError]);
  useEffect(() => { controls.current = accessory; });

  useDOMImperativeHandle<TerminalDOMRef>(ref ?? null, () => ({
    write(id, text, acknowledgement) {
      if (typeof id !== 'string' || typeof text !== 'string' || typeof acknowledgement !== 'number') return;
      const display = displays.current.get(id);
      if (!display) { void callbacks.current.onError('Terminal renderer is unavailable.'); return; }
      display.terminal.write(text, () => { void callbacks.current.onWritten(id, acknowledgement); });
    },
    paste(id, text) {
      if (typeof id !== 'string' || typeof text !== 'string') return;
      const display = displays.current.get(id);
      if (!display || display.terminal.options.disableStdin) return;
      display.paste(text); display.terminal.focus();
    },
  }), []);

  function consumeModifiers() {
    const state = controls.current;
    state.consume();
    for (const key of ['ctrl', 'alt', 'shift'] as const) if (state.states[key] === 'armed') state.modifiers[key] = false;
  }

  function send(id: string, data: string) {
    // Native actions are asynchronous: preserve keystroke order across the bridge.
    const generation = versions.current.get(id) ?? -1;
    inputQueue.current = inputQueue.current.then(() => callbacks.current.onInput(id, data, generation)).catch((error) => callbacks.current.onError(error instanceof Error ? error.message : String(error)));
  }

  useEffect(() => {
    const owned = displays.current;
    for (const entry of instances) {
      versions.current.set(entry.id, entry.generation);
      let display = owned.get(entry.id);
      if (!display) {
        const container = root.current?.querySelector<HTMLElement>(`[data-pty="${CSS.escape(entry.id)}"]`);
        if (!container) continue;
        const terminal = new Terminal({
          theme, fontSize: 14, fontFamily: 'Menlo, Consolas, monospace', scrollback: 10000,
          screenReaderMode: true, convertEol: false, cursorBlink: true, minimumContrastRatio: 4.5,
          disableStdin: entry.status !== 'connected',
        });
        const fit = new FitAddon(); terminal.loadAddon(fit); terminal.open(container);
        let composing = false, pasting = false;
        let compositionTimer: ReturnType<typeof setTimeout> | undefined;
        const subscriptions = [
          terminal.onData((data) => {
            if (!isVisible.current) return;
            const modifiers = controls.current.modifiers;
            if (entry.id === active.current && !composing && !pasting && data.length === 1 && data.charCodeAt(0) >= 32 && data.charCodeAt(0) <= 126 && (modifiers.ctrl || modifiers.alt || modifiers.shift)) {
              const encoded = encodeTerminalKey(data, modifiers);
              if (encoded !== undefined) { send(entry.id, encoded); consumeModifiers(); return; }
            }
            send(entry.id, data);
          }),
          terminal.onResize(({ cols, rows }) => { if (isVisible.current && entry.id === active.current) void callbacks.current.onResize(entry.id, cols, rows); }),
          terminal.onScroll(() => { if (entry.id === active.current) setScrolled(terminal.buffer.active.viewportY < terminal.buffer.active.baseY); }),
          terminal.onSelectionChange(() => { if (entry.id === active.current) setSelected(terminal.hasSelection()); }),
        ];
        terminal.attachCustomKeyEventHandler((event) => {
          if (event.type !== 'keydown' || composing || entry.id !== active.current || terminal.options.disableStdin) return true;
          const modifiers = controls.current.modifiers;
          if (!modifiers.ctrl && !modifiers.alt && (!modifiers.shift || event.key.length === 1)) return true;
          const encoded = encodeTerminalKey(event.key, { ctrl: modifiers.ctrl || event.ctrlKey, alt: modifiers.alt || event.altKey, shift: modifiers.shift || event.shiftKey }, terminal.modes.applicationCursorKeysMode);
          if (encoded === undefined) return true;
          event.preventDefault(); send(entry.id, encoded); consumeModifiers(); return false;
        });
        const textarea = terminal.textarea!;
        textarea.setAttribute('aria-label', labels.input); textarea.setAttribute('autocorrect', 'off');
        textarea.setAttribute('autocapitalize', 'off'); textarea.spellcheck = false;
        const compositionStart = () => { clearTimeout(compositionTimer); composing = true; };
        const compositionEnd = () => { compositionTimer = setTimeout(() => { composing = false; }, 0); };
        const paste = (event: ClipboardEvent) => {
          if (terminal.options.disableStdin) return;
          event.preventDefault(); event.stopImmediatePropagation(); pasting = true;
          void callbacks.current.onPaste(entry.id, event.clipboardData?.getData('text/plain') || '');
          setTimeout(() => { pasting = false; }, 0);
        };
        textarea.addEventListener('compositionstart', compositionStart); textarea.addEventListener('compositionend', compositionEnd);
        container.addEventListener('paste', paste, true);
        const removeTouch = installTerminalTouch(container, terminal);
        const removeInput = installTerminalInput(terminal);
        display = { terminal, fit, paste: (text) => { pasting = true; terminal.paste(text); pasting = false; }, dispose: () => {
          clearTimeout(compositionTimer); removeTouch(); removeInput(); subscriptions.forEach((subscription) => subscription.dispose());
          textarea.removeEventListener('compositionstart', compositionStart); textarea.removeEventListener('compositionend', compositionEnd);
          container.removeEventListener('paste', paste, true); terminal.dispose();
        } };
        owned.set(entry.id, display);
        void callbacks.current.onReady(entry.id);
      }
      display.terminal.options.disableStdin = entry.status !== 'connected' || !visible;
      display.terminal.options.theme = theme;
      display.terminal.textarea?.setAttribute('aria-label', labels.input);
    }
    for (const [id, display] of owned) if (!instances.some((entry) => entry.id === id)) { display.dispose(); owned.delete(id); }
  }, [instances, theme, labels.input, visible]);

  useEffect(() => {
    active.current = activeId;
    isVisible.current = visible;
    controls.current.clear();
    const display = activeId ? displays.current.get(activeId) : undefined;
    setSelected(display?.terminal.hasSelection() ?? false);
    setScrolled(display ? display.terminal.buffer.active.viewportY < display.terminal.buffer.active.baseY : false);
    if (!visible) { display?.terminal.blur(); return; }
    if (!display) return;
    const fit = () => {
      if (root.current && root.current.clientWidth > 0 && root.current.clientHeight > 0) {
        display.fit.fit();
        void callbacks.current.onResize(activeId!, display.terminal.cols, display.terminal.rows);
      }
    };
    const observer = new ResizeObserver(fit); observer.observe(root.current!);
    const frame = requestAnimationFrame(fit);
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, [activeId, visible, expanded, instances.length]);

  useEffect(() => {
    const owned = displays.current;
    return () => { for (const display of owned.values()) display.dispose(); owned.clear(); };
  }, []);

  const getDisplay = () => activeId ? displays.current.get(activeId) : undefined;
  const disabled = instances.find((entry) => entry.id === activeId)?.status !== 'connected';
  function accessoryKey(key: string) {
    const display = getDisplay();
    if (!display || disabled || !activeId || activeId !== active.current || !isVisible.current) return;
    const data = encodeTerminalKey(key, controls.current.modifiers, display.terminal.modes.applicationCursorKeysMode);
    if (data !== undefined) { send(activeId, data); consumeModifiers(); display.terminal.focus(); }
  }
  return <div className={`terminal-surface${slim ? ' terminal-slim' : ''}`} aria-hidden={!visible} inert={!visible} style={{ background: theme.background, color: theme.foreground, visibility: visible ? 'visible' : 'hidden' }}>
    <div ref={root} className="terminal-displays" data-testid="terminal-displays">
      {instances.map((entry) => <div key={entry.id} data-pty={entry.id} data-testid={visible && entry.id === activeId ? 'terminal-output' : undefined} className="terminal-display" style={{ display: entry.id === activeId ? 'block' : 'none' }} />)}
      {scrolled && <button className="terminal-latest" type="button" onClick={() => getDisplay()?.terminal.scrollToBottom()}>{labels.latest}</button>}
    </div>
    <TerminalAccessory state={accessory} labels={labels} disabled={disabled} expanded={expanded} onExpand={() => setExpanded((value) => !value)} onKey={accessoryKey} selected={selected} onInteract={() => getDisplay()?.terminal.focus()} onCopy={() => { const display = getDisplay(); if (display) void callbacks.current.onCopy(display.terminal.getSelection()); }} onPaste={() => { if (activeId) void callbacks.current.onPaste(activeId); }} />
  </div>;
}
