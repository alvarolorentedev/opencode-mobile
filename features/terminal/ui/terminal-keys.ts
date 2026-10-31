export type Modifiers = { ctrl: boolean; alt: boolean; shift: boolean };
export const NO_MODIFIERS: Modifiers = { ctrl: false, alt: false, shift: false };

export function encodeTerminalKey(key: string, modifiers: Modifiers, applicationCursor = false): string | undefined {
  const { ctrl, alt, shift } = modifiers;
  const parameter = 1 + Number(shift) + 2 * Number(alt) + 4 * Number(ctrl);
  const arrows: Record<string, string> = { ArrowUp: 'A', ArrowDown: 'B', ArrowRight: 'C', ArrowLeft: 'D', Home: 'H', End: 'F' };
  if (arrows[key]) return parameter > 1 ? `\x1b[1;${parameter}${arrows[key]}` : `\x1b${applicationCursor ? 'O' : '['}${arrows[key]}`;
  const numbered: Record<string, number> = { Insert: 2, Delete: 3, PageUp: 5, PageDown: 6, F5: 15, F6: 17, F7: 18, F8: 19, F9: 20, F10: 21, F11: 23, F12: 24 };
  if (numbered[key]) return `\x1b[${numbered[key]}${parameter > 1 ? `;${parameter}` : ''}~`;
  if (/^F[1-4]$/.test(key)) {
    const suffix = 'PQRS'[Number(key.slice(1)) - 1];
    return parameter > 1 ? `\x1b[1;${parameter}${suffix}` : `\x1bO${suffix}`;
  }
  if (key === 'Tab') return shift ? '\x1b[Z' : alt ? '\x1b\t' : '\t';
  if (key === 'Escape') return '\x1b';
  if (key === 'Enter') return alt ? '\x1b\r' : '\r';
  if (key === 'Backspace') return `${alt ? '\x1b' : ''}${ctrl ? '\b' : '\x7f'}`;
  if (key.length !== 1 || key.charCodeAt(0) < 32 || key.charCodeAt(0) > 126) return undefined;
  let text = shift ? key.toUpperCase() : key;
  if (ctrl) {
    const upper = key.toUpperCase().charCodeAt(0);
    if (key === ' ' || key === '2' || key === '@') text = '\0';
    else if (key === '?' || key === '8') text = '\x7f';
    else if (upper >= 64 && upper <= 95) text = String.fromCharCode(upper - 64);
    else return undefined;
  }
  return `${alt ? '\x1b' : ''}${text}`;
}

export function pasteNeedsConfirmation(text: string) {
  return /[\x00-\x1f\x7f]/.test(text);
}
