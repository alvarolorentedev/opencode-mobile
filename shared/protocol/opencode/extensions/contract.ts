import { z } from 'zod';

/**
 * Local mirrors of the V2 configuration fields the app writes. The official
 * `@opencode/schema` definitions remain the contract oracle in tests; keeping
 * the runtime schema small avoids pulling the server's Effect runtime into the
 * mobile bundle.
 */

export const modelSelectionSchema = z.union([
  z.string().regex(/^[^/#\s]+\/[^#\s]+(?:#[^#\s]+)?$/),
  z.object({
    providerID: z.string().min(1),
    model: z.string().min(1),
    variant: z.string().min(1).optional(),
  }),
]);

export const permissionEffectSchema = z.enum(['allow', 'deny', 'ask']);
export const permissionRuleSchema = z.object({
  action: z.string(),
  resource: z.string(),
  effect: permissionEffectSchema,
});
export const permissionRulesetSchema = z.array(permissionRuleSchema);

const legacyPermissionValueSchema = z.union([
  permissionEffectSchema,
  z.record(z.string(), permissionEffectSchema),
]);
export const legacyPermissionSchema = z.record(z.string(), legacyPermissionValueSchema);

export const agentDefinitionSchema = z.object({
  model: modelSelectionSchema.optional(),
  system: z.string().optional(),
  description: z.string().optional(),
  mode: z.enum(['subagent', 'primary', 'all']).optional(),
  hidden: z.boolean().optional(),
  steps: z.number().int().positive().optional(),
  disabled: z.boolean().optional(),
  permissions: permissionRulesetSchema.optional(),
}).passthrough();

export const commandDefinitionSchema = z.object({
  template: z.string().min(1),
  description: z.string().optional(),
  agent: z.string().optional(),
  model: modelSelectionSchema.optional(),
  subagent: z.boolean().optional(),
  subtask: z.boolean().optional(),
}).passthrough();

export function firstIssue(result: z.ZodSafeParseResult<unknown>) {
  if (result.success) return undefined;
  const issue = result.error.issues[0];
  return issue ? `${issue.path.join('.') || 'value'}: ${issue.message}` : 'Invalid value.';
}

export function parsePermissionJson(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error('Permissions must be valid JSON.');
  }
  const result = permissionRulesetSchema.safeParse(parsed);
  if (!result.success) throw new Error(firstIssue(result) ?? 'Permissions must be an array of rules.');
  return result.data;
}
