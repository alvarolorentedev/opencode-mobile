import type { Terminal } from '@xterm/xterm';

export function installTerminalInput(terminal: Terminal) {
  const textarea = terminal.textarea!;
  let handledKey: string | undefined;
  let composing = false, imeKey = false;
  let compositionTimer: ReturnType<typeof setTimeout> | undefined;
  const key = terminal.onKey(({ key }) => { handledKey = key; });
  const keyDown = (event: KeyboardEvent) => { imeKey = event.keyCode === 229; };
  const keyUp = () => { handledKey = undefined; imeKey = false; };
  const compositionStart = () => { clearTimeout(compositionTimer); composing = true; };
  const compositionEnd = () => { compositionTimer = setTimeout(() => { composing = false; }, 0); };
  const input = (event: InputEvent) => {
    // xterm ignores insertText in screen-reader mode; its key and IME handlers still own their input.
    if (event.data && event.inputType === 'insertText' && !event.isComposing && !composing && !imeKey && event.data !== handledKey) {
      terminal.input(event.data, true);
    }
    handledKey = undefined;
  };
  textarea.addEventListener('keydown', keyDown);
  textarea.addEventListener('keyup', keyUp);
  textarea.addEventListener('compositionstart', compositionStart);
  textarea.addEventListener('compositionend', compositionEnd);
  textarea.addEventListener('input', input);
  return () => {
    clearTimeout(compositionTimer); key.dispose();
    textarea.removeEventListener('keydown', keyDown);
    textarea.removeEventListener('keyup', keyUp);
    textarea.removeEventListener('compositionstart', compositionStart);
    textarea.removeEventListener('compositionend', compositionEnd);
    textarea.removeEventListener('input', input);
  };
}
