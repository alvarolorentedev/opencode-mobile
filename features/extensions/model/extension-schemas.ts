import { z } from 'zod';
import { assertSkillId } from '@/shared/protocol/opencode/extensions/skills';
import { slugifySkillId } from '@/shared/contracts/skill-id';

const required = z.string().refine((value) => Boolean(value.trim()), 'common:validation.required');
export const mcpSchema = z.object({ name: required, type: z.enum(['local', 'remote']), target: required }).superRefine((draft, context) => {
  if (draft.type !== 'local') return;
  try {
    const parts: unknown = JSON.parse(draft.target);
    if (Array.isArray(parts) && parts.length && parts.every((part) => typeof part === 'string')) return;
  } catch { /* Report the same field error for malformed JSON and malformed command arrays. */ }
  context.addIssue({ code: 'custom', path: ['target'], message: 'common:validation.invalid' });
});
export const skillSchema = z.object({ id: z.string(), name: z.string(), description: z.string(), instructions: required, autoinvoke: z.boolean() }).superRefine((draft, context) => {
  try { assertSkillId(draft.id.trim() || slugifySkillId(draft.name)); }
  catch { context.addIssue({ code: 'custom', path: ['id'], message: 'common:validation.invalid' }); }
});
export const commandSchema = z.object({ name: required, description: z.string(), template: required });

export type McpDraft = z.infer<typeof mcpSchema>;
export type SkillDraft = z.infer<typeof skillSchema>;
export type CommandDraft = z.infer<typeof commandSchema>;
