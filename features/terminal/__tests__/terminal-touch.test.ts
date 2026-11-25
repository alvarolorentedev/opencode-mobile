// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Terminal } from '@xterm/xterm';
import { installTerminalTouch } from '@/features/terminal/ui/terminal-touch';

const LINE_HEIGHT = 10;

function setup(type: 'normal' | 'alternate') {
  const container = document.createElement('div');
  container.innerHTML = '<div class="xterm"><div class="xterm-screen"></div></div>';
  const screen = container.querySelector<HTMLElement>('.xterm-screen')!;
  screen.getBoundingClientRect = () => new DOMRect(0, 0, 400, 24 * LINE_HEIGHT);
  const element = container.querySelector<HTMLElement>('.xterm')!;
  const wheel = vi.fn();
  element.addEventListener('wheel', wheel);
  const terminal = {
    cols: 40, rows: 24, element,
    buffer: { active: { type, viewportY: 0 } },
    scrollLines: vi.fn(), select: vi.fn(), clearSelection: vi.fn(), focus: vi.fn(),
  } as unknown as Terminal;
  const dispose = installTerminalTouch(container, terminal);
  const fire = (name: string, clientY: number) => {
    const event = new Event(name, { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'touches', { value: [{ clientX: 40, clientY }] });
    container.dispatchEvent(event);
  };
  const swipe = (from: number, to: number) => { fire('touchstart', from); fire('touchmove', to); fire('touchend', to); };
  return { terminal, wheel, swipe, dispose };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('terminal touch scrolling', () => {
  it('scrolls the normal buffer locally', () => {
    const { terminal, wheel, swipe, dispose } = setup('normal');
    swipe(200, 170);
    expect(terminal.scrollLines).toHaveBeenCalledWith(3);
    expect(wheel).not.toHaveBeenCalled();
    dispose();
  });

  it('forwards alternate-screen rows as wheel events for mouse-reporting programs', () => {
    const { terminal, wheel, swipe, dispose } = setup('alternate');
    swipe(200, 170);
    expect(terminal.scrollLines).not.toHaveBeenCalled();
    expect(wheel).toHaveBeenCalledTimes(3);
    for (const [event] of wheel.mock.calls) expect(event).toMatchObject({ deltaY: 1, deltaMode: WheelEvent.DOM_DELTA_LINE });
    swipe(170, 200);
    expect(wheel).toHaveBeenCalledTimes(6);
    for (const [event] of wheel.mock.calls.slice(3)) expect(event).toMatchObject({ deltaY: -1 });
    dispose();
  });
});
