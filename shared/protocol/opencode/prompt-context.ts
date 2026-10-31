import type { PromptContextItem, PromptMention } from '@/shared/protocol/opencode/prompt-inbox';

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
