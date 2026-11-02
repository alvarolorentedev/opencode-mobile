import { z } from 'zod';
import { assertSkillId } from '@/shared/protocol/opencode/extensions/skills';
import { assertAgentName } from '@/shared/protocol/opencode/extensions/jsonc';
import { modelSelectionSchema } from '@/shared/protocol/opencode/extensions/contract';
import { slugifySkillId } from '@/shared/contracts/skill-id';

const required = z.string().refine((value) => Boolean(value.trim()), 'common:validation.required');
export const pluginSchema = z.object({ target: required });
export const mcpEditorSchema = z.object({
  name: required, type: z.enum(['local', 'remote']), url: z.string(), executable: z.string(), arguments: z.array(z.object({ value: z.string() })),
}).superRefine((draft, context) => {
  const key = draft.type === 'remote' ? 'url' : 'executable';
  if (!draft[key].trim()) context.addIssue({ code: 'custom', path: [key], message: 'common:validation.required' });
  if (draft.type === 'remote' && draft.url.trim()) {
    try { const url = new URL(draft.url); if (!['http:', 'https:'].includes(url.protocol)) throw new Error(); }
    catch { context.addIssue({ code: 'custom', path: ['url'], message: 'common:validation.invalid' }); }
  }
});
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
export const commandSchema = z.object({ name: required, description: z.string(), template: required, format: z.enum(['markdown', 'jsonc']) });
export const agentSchema = z.object({
  id: required,
  description: z.string(),
  mode: z.enum(['primary', 'subagent', 'all']),
  model: z.string(),
  permissions: z.string(),
  instructions: required,
  advancedFrontmatter: z.string(),
  format: z.enum(['markdown', 'jsonc']),
}).superRefine((draft, context) => {
  try { assertAgentName(draft.id.trim()); }
  catch { context.addIssue({ code: 'custom', path: ['id'], message: 'common:validation.invalid' }); }
  if (draft.model.trim() && !modelSelectionSchema.safeParse(draft.model.trim()).success) {
    context.addIssue({ code: 'custom', path: ['model'], message: 'common:validation.invalid' });
  }
  if (draft.advancedFrontmatter.includes('---')) {
    context.addIssue({ code: 'custom', path: ['advancedFrontmatter'], message: 'common:validation.invalid' });
  }
});

export type McpDraft = z.infer<typeof mcpSchema>;
export type McpEditorDraft = z.infer<typeof mcpEditorSchema>;
export type SkillDraft = z.infer<typeof skillSchema>;
export type CommandDraft = z.infer<typeof commandSchema>;
export type AgentDraft = z.infer<typeof agentSchema>;
