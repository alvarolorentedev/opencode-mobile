// Connector-enforced access policy for exposed services (management API 4,
// capability `service-access-v1`). See ADR 0041.
//
// The connector owns enforcement: it issues a share capability, a write-only
// password and a deadline, and re-checks them on every visitor request. This
// file only mirrors the wire shape and the arithmetic the editor needs before
// spending a round trip; the stored response stays authoritative.
//
// Backward compatibility is explicit here: a connector without the capability
// keeps the pre-policy contract, so `access` remains the source of truth and no
// policy field is ever sent to it. The capability, never the release string, is
// what unlocks the new surface.

export type ServiceAccessMode = 'private' | 'public' | 'password';

// Stored policy for one service. Omitted entirely for legacy services.
export type ServiceAccessPolicy = {
  mode: ServiceAccessMode;
  // Absolute Unix seconds, or null when the share never expires.
  expires_at: number | null;
  // Sticky: once the connector observes the deadline it stays true, so a
  // wall-clock rollback cannot revive a share.
  expired: boolean;
  // Whether a password exists. The hash is never returned by any response.
  password_set: boolean;
  // Capability embedded in the share URL; null for private services and after
  // revocation.
  share_token: string | null;
  revision: number;
};

// PUT fragment. `password` is write-only: omit it to keep an existing password.
export type ServicePolicyInput = {
  mode: ServiceAccessMode;
  // Omitted/null means no expiration; only valid for public/password modes.
  expires_at?: number | null;
  password?: string;
};

// Editor expiration choices. `expired` is a transient state for a stored share
// that has already passed its deadline: the user must pick a new deadline or
// an explicit "no expiration" instead of silently extending the old one.
export type ServiceExpirationChoice = 'keep' | 'expired' | 'none' | '15m' | '1h' | '24h' | 'custom';
export type ServiceExpirationUnit = 'minutes' | 'hours' | 'days';

export type ServiceExpirationError = 'expirationRequired' | 'expirationPast' | 'expirationRange' | 'expirationFormat';

// Capability advertised by `GET /_cloudlink/version` from connector 0.20.0 on.
// The release string is documentation only: gate on this value.
export const SERVICE_ACCESS_CAPABILITY = 'service-access-v1';
export const SERVICE_ACCESS_CONNECTOR_VERSION = '0.20.0';

export const SERVICE_PASSWORD_MIN_LENGTH = 8;
export const SERVICE_PASSWORD_MAX_LENGTH = 128;
// Bounds for the custom expiration field: 1 minute through 366 days.
export const MIN_SERVICE_EXPIRATION_SECONDS = 60;
export const MAX_SERVICE_EXPIRATION_SECONDS = 366 * 24 * 60 * 60;

const PRESET_EXPIRATION_SECONDS: Record<'15m' | '1h' | '24h', number> = { '15m': 900, '1h': 3600, '24h': 86400 };
const UNIT_EXPIRATION_SECONDS: Record<ServiceExpirationUnit, number> = { minutes: 60, hours: 3600, days: 86_400 };

// The capability decides, never `version`. A backported build with the
// capability works; a 0.20.0 build without it stays legacy.
export function supportsServiceAccess(version?: { capabilities?: readonly string[] } | null): boolean {
  return Boolean(version?.capabilities?.includes(SERVICE_ACCESS_CAPABILITY));
}

// The real mode. `access` is only a legacy projection (public/password both
// report `public`), so a policy always wins over it.
export function getServiceAccessMode(service: { access: 'private' | 'public'; access_policy?: ServiceAccessPolicy }): ServiceAccessMode {
  return service.access_policy?.mode ?? service.access;
}

// The connector clock advanced by the local time elapsed since the list was
// read, so a long-lived editor or a suspended app keeps counting from
// `server_time` instead of the phone clock.
export function getServiceServerNow(serverTime?: number, serverTimeAt?: number, now = Date.now()): number {
  if (serverTime === undefined) return Math.floor(now / 1000);
  const elapsed = serverTimeAt ? Math.max(0, now - serverTimeAt) : 0;
  return Math.floor(serverTime + elapsed / 1000);
}

export function isServiceShareExpired(policy: Pick<ServiceAccessPolicy, 'expires_at' | 'expired'>, serverNow: number): boolean {
  if (policy.expired) return true;
  return policy.expires_at !== null && policy.expires_at <= serverNow;
}

// Seconds left before the share stops working. `0` means already due, `null`
// means the share has no deadline (or none applies).
export function getServiceRemainingSeconds(
  policy: Pick<ServiceAccessPolicy, 'expires_at' | 'expired'> | null | undefined,
  serverNow: number,
): number | null {
  if (!policy || policy.expires_at === null) return null;
  if (policy.expired) return 0;
  return Math.max(0, policy.expires_at - serverNow);
}

// Resolve an expiration choice to an absolute Unix deadline anchored on the
// connector clock. Returns a stable error code the UI maps to localized copy.
export function resolveServiceExpiration({
  choice,
  currentExpiresAt,
  serverTime,
  amount = '1',
  unit = 'hours',
}: {
  choice: ServiceExpirationChoice;
  currentExpiresAt?: number | null;
  serverTime: number;
  amount?: string;
  unit?: ServiceExpirationUnit;
}): { expiresAt: number | null } | { error: ServiceExpirationError } {
  if (choice === 'expired') return { error: 'expirationRequired' };
  if (choice === 'none') return { expiresAt: null };
  if (choice === 'keep') {
    if (currentExpiresAt === null || currentExpiresAt === undefined) return { error: 'expirationRequired' };
    if (currentExpiresAt <= serverTime) return { error: 'expirationPast' };
    return { expiresAt: currentExpiresAt };
  }
  if (choice === 'custom') {
    const digits = amount.trim();
    if (!/^\d+$/.test(digits)) return { error: 'expirationFormat' };
    const seconds = Number(digits) * UNIT_EXPIRATION_SECONDS[unit];
    if (!Number.isSafeInteger(seconds) || seconds < MIN_SERVICE_EXPIRATION_SECONDS || seconds > MAX_SERVICE_EXPIRATION_SECONDS) {
      return { error: 'expirationRange' };
    }
    return { expiresAt: serverTime + seconds };
  }
  return { expiresAt: serverTime + PRESET_EXPIRATION_SECONDS[choice] };
}

// Compact remaining time for list rows: `45s`, `59m`, `1h 5m`, `1d 3h`.
// Unit symbols stay as-is in every language, matching `formatDuration`.
export function formatServiceRemaining(seconds: number): string {
  const total = Math.max(0, Math.ceil(seconds));
  if (total < 60) return `${total}s`;
  const days = Math.floor(total / 86_400);
  const hours = Math.floor((total % 86_400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  return `${minutes}m`;
}
