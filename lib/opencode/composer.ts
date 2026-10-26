import type { PromptContextItem, PromptMention } from './prompt-inbox';

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

export type ResolvedPromptContext = {
  files: { uri: string; name: string; mention: PromptMention }[];
  agents: { name: string; mention: PromptMention }[];
  skills: { id: string; mention: PromptMention }[];
};

// Mentions are resolved from the final draft rather than tracked as live
// offsets. Editing, deleting, or duplicating a token therefore cannot leave a
// stale range behind; a removed token simply stops resolving.
export function resolvePromptContext(text: string, items: PromptContextItem[] | undefined): ResolvedPromptContext {
  const result: ResolvedPromptContext = { files: [], agents: [], skills: [] };
  if (!items?.length) return result;

  let searchFrom = 0;
  for (const item of items) {
    let start = text.indexOf(item.token, searchFrom);
    if (start === -1) start = text.indexOf(item.token);
    if (start === -1) continue;
    searchFrom = start + item.token.length;
    const mention = { start, end: start + item.token.length, text: item.token };

    if (item.kind === 'file') {
      result.files.push({ uri: `file://${item.path}`, name: item.token.slice(1), mention });
    } else if (item.kind === 'agent') {
      result.agents.push({ name: item.name, mention });
    } else {
      result.skills.push({ id: item.id, mention });
    }
  }

  return result;
}
