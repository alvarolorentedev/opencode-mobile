import { z } from 'zod';
import { parseConnectionHeaders, type ConnectionHeaderError } from '@/lib/connection-headers';
import { isValidServerUrl } from '@/lib/opencode/client/url';

const headerErrors: Record<ConnectionHeaderError, string> = {
  name: 'headerName', value: 'headerValue', duplicate: 'headerDuplicate', reserved: 'headerReserved', limit: 'headerLimit',
};
export const connectionSchema = z.object({
  name: z.string(), serverUrl: z.string(), username: z.string(), password: z.string(),
  headers: z.array(z.object({ name: z.string(), value: z.string() })),
}).superRefine((draft, context) => {
  if (!draft.serverUrl.trim() || !isValidServerUrl(draft.serverUrl)) context.addIssue({
    code: 'custom', path: ['serverUrl'], message: `settings:connection.errors.${draft.serverUrl.trim() ? 'invalidUrl' : 'serverUrl'}`,
  });
  const parsed = parseConnectionHeaders(draft.headers);
  if (parsed.error) context.addIssue({ code: 'custom', path: ['headers'], message: `settings:connection.errors.${headerErrors[parsed.error]}` });
});
export type ConnectionDraft = z.infer<typeof connectionSchema>;
