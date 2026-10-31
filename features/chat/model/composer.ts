

// Composer parsing is deliberately independent of the wire format: the same
// draft may be edited for a long time before it becomes a prompt payload.

export type ComposerTrigger = {
  kind: 'command' | 'context';
  start: number;
  end: number;
  query: string;
};

export function findComposerTrigger(text: string, cursor: number): ComposerTrigger | undefined {
  const position = Math.max(0, Math.min(cursor, text.length));
  let start = position;
  while (start > 0 && !/\s/.test(text[start - 1])) start -= 1;
  const token = text.slice(start, position);
  if (!token) return undefined;

  if (token.startsWith('/') && start === 0 && !/\s/.test(text.slice(0, position))) {
    return { kind: 'command', start, end: position, query: token.slice(1) };
  }

  if (token.startsWith('@') && (start === 0 || /\s/.test(text[start - 1]))) {
    return { kind: 'context', start, end: position, query: token.slice(1) };
  }

  return undefined;
}

export function replaceComposerTrigger(
  text: string,
  trigger: ComposerTrigger,
  replacement: string,
): { text: string; cursor: number } {
  const next = `${text.slice(0, trigger.start)}${replacement}${text.slice(trigger.end)}`;
  return { text: next, cursor: trigger.start + replacement.length };
}

/** Returns the command after a leading `!`, or undefined for a normal prompt. */
export function parseShellCommand(text: string): string | undefined {
  const match = text.match(/^!\s*([\s\S]*)$/);
  if (!match) return undefined;
  const command = match[1].trim();
  return command || undefined;
}
