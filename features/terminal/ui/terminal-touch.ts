import type { Terminal } from '@xterm/xterm';

// Touch gestures select/copy or scroll locally; they never emulate mouse clicks in the shell.
export function installTerminalTouch(element: HTMLElement, terminal: Terminal) {
  let start: { x: number; y: number; col: number; row: number } | undefined;
  let selecting = false, moved = false, lastY = 0, remainder = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const position = (touch: Touch) => {
    const screen = element.querySelector('.xterm-screen')!.getBoundingClientRect();
    return {
      x: touch.clientX, y: touch.clientY,
      col: Math.max(0, Math.min(terminal.cols - 1, Math.floor((touch.clientX - screen.left) / (screen.width / terminal.cols)))),
      row: terminal.buffer.active.viewportY + Math.max(0, Math.min(terminal.rows - 1, Math.floor((touch.clientY - screen.top) / (screen.height / terminal.rows)))),
    };
  };
  const begin = (event: TouchEvent) => {
    if (event.touches.length !== 1) { clearTimeout(timer); start = undefined; return; }
    event.stopImmediatePropagation();
    start = position(event.touches[0]); lastY = start.y; remainder = 0; moved = false; selecting = false;
    timer = setTimeout(() => {
      if (!start) return;
      const line = terminal.buffer.active.getLine(start.row);
      let left = start.col, right = left + 1;
      const isWord = (col: number) => /[\p{L}\p{N}_./~-]/u.test(line?.getCell(col)?.getChars() || '');
      if (line?.getCell(left)?.getWidth() === 0 && left > 0) left--;
      if (isWord(left)) {
        while (left > 0 && (isWord(left - 1) || line?.getCell(left - 1)?.getWidth() === 0)) left--;
        while (right < terminal.cols && (isWord(right) || line?.getCell(right)?.getWidth() === 0)) right++;
      }
      terminal.select(left, start.row, right - left);
      start.col = left; selecting = true;
    }, 450);
  };
  const move = (event: TouchEvent) => {
    if (!start || event.touches.length !== 1) return;
    event.stopImmediatePropagation(); event.preventDefault();
    const current = position(event.touches[0]);
    if (selecting) {
      const first = start.row * terminal.cols + start.col;
      const last = current.row * terminal.cols + current.col;
      const left = Math.min(first, last);
      terminal.select(left % terminal.cols, Math.floor(left / terminal.cols), Math.abs(last - first) + 1);
    } else if (Math.abs(current.y - start.y) + Math.abs(current.x - start.x) > 8) {
      moved = true; clearTimeout(timer);
      const screen = element.querySelector('.xterm-screen')!.getBoundingClientRect();
      remainder += lastY - current.y;
      const lines = Math.trunc(remainder / (screen.height / terminal.rows));
      if (lines) { terminal.scrollLines(lines); remainder -= lines * screen.height / terminal.rows; }
      lastY = current.y;
    }
  };
  const end = (event: TouchEvent) => {
    if (!start) return;
    clearTimeout(timer); event.stopImmediatePropagation();
    if (selecting || moved) event.preventDefault();
    else { terminal.clearSelection(); terminal.focus(); }
    start = undefined;
  };
  element.addEventListener('touchstart', begin, { capture: true, passive: false });
  element.addEventListener('touchmove', move, { capture: true, passive: false });
  element.addEventListener('touchend', end, { capture: true, passive: false });
  element.addEventListener('touchcancel', end, { capture: true, passive: false });
  return () => {
    clearTimeout(timer);
    element.removeEventListener('touchstart', begin, true); element.removeEventListener('touchmove', move, true);
    element.removeEventListener('touchend', end, true); element.removeEventListener('touchcancel', end, true);
  };
}
