// Prompt and parsing rules shared by the on-device classifier and the
// OpenCode classifier call. The classifier must return one of three labels; the
// router never guesses a tier when the classifier is unavailable.

export const MODEL_COMPLEXITIES = ['simple', 'standard', 'complex'] as const;
export type ModelComplexity = (typeof MODEL_COMPLEXITIES)[number];

export const AUTO_MODEL_CLASSIFIER_GRAMMAR = 'root ::= "simple" | "standard" | "complex"';
export const AUTO_MODEL_MAX_PROMPT_CHARS = 4_000;
export const AUTO_MODEL_MAX_CONTEXT_TOKENS = 2_048;
export const AUTO_MODEL_OUTPUT_TOKENS = 4;

export type AutoModelClassifierInput = {
  prompt: string;
  sessionTitle?: string;
  contextTokens?: number;
  attachments?: { mime?: string; filename?: string }[];
};

const SYSTEM_PROMPT = [
  'You classify the complexity of the user\'s next message for a coding assistant.',
  '',
  'Return exactly one word, with no punctuation or explanation:',
  'simple - a short, single-step request, lookup, definition, formatting change, typo, or direct question.',
  'standard - a normal coding task, explanation, or change involving one or two files and moderate reasoning.',
  'complex - multi-step debugging, architecture, migration, repository-wide work, performance, security, or long-context reasoning.',
].join('\n');

function attachmentSummary(attachments?: AutoModelClassifierInput['attachments']) {
  if (!attachments?.length) {
    return 'none';
  }

  const types = attachments.map((attachment) => attachment.mime || attachment.filename || 'file');
  return `${attachments.length} (${types.join(', ')})`;
}

export function buildAutoModelClassifierInput(input: AutoModelClassifierInput) {
  const session = input.sessionTitle?.trim();
  const context = typeof input.contextTokens === 'number' && input.contextTokens > 0
    ? `Context tokens so far: ${Math.round(input.contextTokens)}`
    : undefined;
  const user = [
    session ? `Session: ${session}` : undefined,
    context,
    `Attachments: ${attachmentSummary(input.attachments)}`,
    'Message:',
    '"""',
    input.prompt,
    '"""',
  ].filter((line): line is string => line !== undefined).join('\n');

  return { system: SYSTEM_PROMPT, user };
}

export function buildAutoModelClassifierPrompt(input: AutoModelClassifierInput) {
  const { system, user } = buildAutoModelClassifierInput(input);
  return `${system}\n\n${user}`;
}

export function isAutoModelPromptWithinLimit(prompt: string) {
  return prompt.length > 0 && prompt.length <= AUTO_MODEL_MAX_PROMPT_CHARS;
}

export function parseAutoModelTier(value: string | undefined): ModelComplexity | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = value
    .trim()
    .toLocaleLowerCase()
    .replace(/^[`'"\s]+|[`'"\s.!?,;:]+$/g, '');
  const match = normalized.match(/\b(simple|standard|complex)\b/);
  return match?.[1] as ModelComplexity | undefined;
}
