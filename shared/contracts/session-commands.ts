// Client-side built-ins backed by V2 session endpoints. They are not part of
// the server command catalog, so they are dispatched before session.command.
export const BUILTIN_SESSION_COMMANDS = ['compact', 'btw'] as const;

export type BuiltinSessionCommand = (typeof BUILTIN_SESSION_COMMANDS)[number];

export type SideQuestionAnswer = {
  question: string;
  answer: string;
};

export function isBuiltinSessionCommand(name: string): name is BuiltinSessionCommand {
  return (BUILTIN_SESSION_COMMANDS as readonly string[]).includes(name);
}

// Mirrors the TUI side question: session.generate exposes tools but runs no
// tool loop, so a tool call would surface as an empty answer.
const SIDE_QUESTION_INSTRUCTIONS = [
  'The user is asking a quick side question about the conversation so far.',
  'Answer directly and concisely in markdown from what you already know.',
  'Do not call any tools and do not take any actions.',
].join(' ');

export function buildSideQuestionPrompt(question: string): string {
  return [SIDE_QUESTION_INSTRUCTIONS, question.trim()].join('\n\n');
}
