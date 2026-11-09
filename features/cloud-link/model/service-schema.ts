import { z } from 'zod';

// The form's value shape. Connector rules (ids, ports, access policy,
// expiration, password) are mirrored by `prepareServiceDraft`, which the editor
// runs in the submit handler with the current connector context — never through
// a resolver, because React Compiler memoizes render-scoped values and a
// resolver captured at mount would keep validating against a version answer
// that had not landed yet.
export function serviceSchema() {
  return z.object({
    id: z.string(), name: z.string(), port: z.number().optional(), path: z.string(), target: z.string(),
    accessMode: z.enum(['private', 'public', 'password']), enabled: z.boolean(), stripPrefix: z.boolean(),
    expiration: z.enum(['keep', 'expired', 'none', '15m', '1h', '24h', 'custom']),
    customExpirationAmount: z.string(), customExpirationUnit: z.enum(['minutes', 'hours', 'days']),
    password: z.string(), passwordSet: z.boolean(), hasPolicy: z.boolean(), legacy: z.boolean(),
    currentExpiresAt: z.number().nullable(),
  });
}
