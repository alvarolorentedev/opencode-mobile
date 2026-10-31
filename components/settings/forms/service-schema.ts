import { z } from 'zod';
import { prepareServiceDraft } from '@/lib/opencode/client';

export function serviceSchema(context: Parameters<typeof prepareServiceDraft>[1]) {
  return z.object({
    id: z.string(), name: z.string(), port: z.number().optional(), path: z.string(), target: z.string(),
    access: z.enum(['private', 'public']), enabled: z.boolean(), stripPrefix: z.boolean(),
  }).superRefine((draft, validation) => {
    const result = prepareServiceDraft(draft, context);
    for (const [field, error] of Object.entries(result.errors)) if (error) validation.addIssue({ code: 'custom', path: [field], message: `settings:services.errors.${error}` });
  });
}
