export type OidcAuthErrorCode =
  | 'discovery'
  | 'network'
  | 'refresh-token-invalid'
  | 'provider-unavailable'
  | 'timeout'
  | 'sign-in-required'
  | 'sign-in-cancelled'
  | 'sign-in-failed'
  | 'unsupported';

// A typed authorization error so callers can distinguish "the user must sign in
// again" from a transport problem without matching message text. The message is
// still written so the connection classifier treats it as an auth failure.
export class OidcAuthError extends Error {
  readonly code: OidcAuthErrorCode;

  constructor(code: OidcAuthErrorCode, message: string) {
    super(message);
    this.name = 'OidcAuthError';
    this.code = code;
  }
}

export function isOidcAuthError(error: unknown): error is OidcAuthError {
  return error instanceof OidcAuthError;
}

export const OIDC_SIGN_IN_REQUIRED_MESSAGE = 'Sign in with OpenID Connect to use this server.';

export const OIDC_SIGN_IN_REJECTED_MESSAGE = 'OpenID Connect authentication was rejected. Sign in again to continue.';

export function oidcErrorMessageKey(error: unknown) {
  if (!isOidcAuthError(error)) return undefined;
  switch (error.code) {
    case 'provider-unavailable': return 'settings:connection.errors.oidcUnavailable';
    case 'network': return 'settings:connection.errors.oidcNetwork';
    case 'timeout': return 'settings:connection.errors.oidcTimeout';
    default: return undefined;
  }
}
