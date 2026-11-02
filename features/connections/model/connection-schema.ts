import { z } from 'zod';
import { parseConnectionHeaders, type ConnectionHeaderError } from '@/shared/contracts/connection-headers';
import { isSecureOidcUrl, oidcConfigError, type OidcConfigError } from '@/shared/contracts/connection-oidc';
import { isValidServerUrl, normalizeServerUrl } from '@/shared/contracts/server-url';

const headerErrors: Record<ConnectionHeaderError, string> = {
  name: 'headerName', value: 'headerValue', duplicate: 'headerDuplicate', reserved: 'headerReserved', limit: 'headerLimit',
};
const oidcErrors: Record<OidcConfigError, string> = {
  issuer: 'oidcIssuer', clientId: 'oidcClientId', scopes: 'oidcScopes', tokenHeader: 'oidcTokenHeader', redirectUri: 'oidcRedirectUri',
};
export const connectionSchema = z.object({
  name: z.string(), serverUrl: z.string(), username: z.string(), password: z.string(),
  headers: z.array(z.object({ name: z.string(), value: z.string() })),
  // The editor always carries the OIDC block; only an enabled block is
  // validated and only an enabled block is saved onto the connection.
  oidc: z.object({
    enabled: z.boolean(), issuer: z.string(), clientId: z.string(), scopes: z.string(), tokenHeader: z.string(), redirectUri: z.string(),
  }),
}).superRefine((draft, context) => {
  if (!draft.serverUrl.trim() || !isValidServerUrl(draft.serverUrl)) context.addIssue({
    code: 'custom', path: ['serverUrl'], message: `settings:connection.errors.${draft.serverUrl.trim() ? 'invalidUrl' : 'serverUrl'}`,
  });
  const parsed = parseConnectionHeaders(draft.headers);
  if (parsed.error) context.addIssue({ code: 'custom', path: ['headers'], message: `settings:connection.errors.${headerErrors[parsed.error]}` });
  if (draft.oidc.enabled) {
    if (!isSecureOidcUrl(normalizeServerUrl(draft.serverUrl).displayUrl)) context.addIssue({
      code: 'custom', path: ['serverUrl'], message: 'settings:connection.errors.oidcSecureUrl',
    });
    const error = oidcConfigError(draft.oidc);
    if (error) context.addIssue({ code: 'custom', path: ['oidc'], message: `settings:connection.errors.${oidcErrors[error]}` });
  }
});
export type ConnectionDraft = z.infer<typeof connectionSchema>;
