import { normalizeServerUrl } from '@/shared/contracts/server-url';
import {
  isServiceShareExpired,
  resolveServiceExpiration,
  SERVICE_PASSWORD_MAX_LENGTH,
  SERVICE_PASSWORD_MIN_LENGTH,
  type ServiceAccessMode,
  type ServiceAccessPolicy,
  type ServiceExpirationChoice,
  type ServiceExpirationUnit,
  type ServicePolicyInput,
} from '@/shared/contracts/service-access';

// Remote service management for a paired Cloud Link device. The connector
// serves this surface at the reserved `/_cloudlink` prefix on the OpenCode
// origin (never a service port) and authenticates it with the same HTTP Basic
// credential as OpenCode traffic. The wire contract is frozen in the
// connector's `protocol/README.md`; the validation below mirrors it so the UI
// can reject bad input before spending a round trip, but the stored response is
// always authoritative.
//
// Management API revision 3 adds an additive `components` object. Treat any
// `api >= 2` as port-capable: every service has a dedicated `port` from the
// connector's pool and an optional `path`: no path means the service owns the
// port root, a path shares the port with other path services. Older clients may
// ignore unknown fields such as `components`. Revision 1 and pre-version
// connectors only support path services on the legacy `:8443` origin; those
// services carry an implicit port here so the rest of the app can build links
// and render addresses uniformly.
//
// Management API revision 4 (connector 0.20.0, capability `service-access-v1`)
// adds `access_policy`. It is absent for legacy services, where `access` stays
// the source of truth, and present on managed shares, where `access` is only a
// legacy projection. See service-access.ts and ADR 0041.

export type ServiceAccess = 'private' | 'public';

export type ManagedService = {
  id: string;
  name: string;
  port: number;
  path: string | null;
  target: string;
  enabled: boolean;
  access: ServiceAccess;
  strip_prefix: boolean;
  // Connector-managed sharing state; omitted on legacy services.
  access_policy?: ServiceAccessPolicy;
};

// PUT body. `id` comes from the URL, so it is not part of the payload. `port`
// is required by api >= 2 connectors and omitted only for legacy api 1
// connectors, which have no port concept. `access_policy` is only ever sent to
// a connector advertising `service-access-v1`.
export type ServiceInput = {
  name?: string;
  port?: number;
  path?: string | null;
  target: string;
  enabled?: boolean;
  access?: ServiceAccess;
  strip_prefix?: boolean;
  access_policy?: ServicePolicyInput;
};

// Editable form state. The path is a string in the UI; an empty path means the
// service owns the port root (api >= 2). `port` stays undefined on api 1.
//
// `accessMode` is the real mode, not the legacy projection. `legacy` marks a
// stored service with no policy: editing its name/target must stay legacy and
// must not mint a share token. `expiration: 'expired'` blocks Save until the
// user picks a new deadline or an explicit none. `password` is never prefilled.
export type ServiceDraft = {
  id: string;
  name: string;
  port?: number;
  path: string;
  target: string;
  enabled: boolean;
  accessMode: ServiceAccessMode;
  stripPrefix: boolean;
  expiration: ServiceExpirationChoice;
  customExpirationAmount: string;
  customExpirationUnit: ServiceExpirationUnit;
  password: string;
  passwordSet: boolean;
  hasPolicy: boolean;
  legacy: boolean;
  currentExpiresAt: number | null;
};

// Connector-reported management compatibility and port pool.
export type ServiceManagementVersion = {
  // Management API revision: 4 adds access policies, 2 supports ports and root
  // services; 1 is the legacy path-only surface.
  api: number;
  // Connector release version from the body or the version header. Documentation
  // only: feature gating never compares it.
  version?: string;
  // False when a pre-version connector answered `404` without a version header.
  // Those connectors are treated as api 1 and warned about, never blocked.
  known: boolean;
  // Selectable ports. Always `[8443]` on api 1.
  servicePorts: number[];
  // Additive feature list from api 4 on. Empty for every older connector.
  capabilities: string[];
};

export type ServiceFieldError =
  | 'required'
  | 'idFormat'
  | 'nameLength'
  | 'pathRoot'
  | 'pathReserved'
  | 'pathFormat'
  | 'portRequired'
  | 'portInvalid'
  | 'portInUse'
  | 'portPathInUse'
  | 'targetFormat'
  | 'targetLoopback'
  | 'targetReserved'
  | 'targetPort'
  | 'passwordRequired'
  | 'passwordLength'
  | 'expirationRequired'
  | 'expirationPast'
  | 'expirationRange'
  | 'expirationFormat'
  | 'accessUnsupported';

// Error keys are form field names, so the schema can attach each issue to the
// field that produced it.
export type ServiceDraftErrors = Partial<Record<'id' | 'name' | 'path' | 'port' | 'target' | 'accessMode' | 'expiration' | 'password', ServiceFieldError>>;

// Connector context the local validation mirror needs: the management revision
// in effect, its service port pool, the current stored list for the port and
// port/path uniqueness rules, whether `service-access-v1` is available, and the
// connector clock used to place expirations.
export type ServiceDraftContext = {
  api?: number;
  servicePorts?: number[];
  services?: ManagedService[];
  accessSupported?: boolean;
  serverTime?: number;
};

export type ServicePortOption = {
  port: number;
  usable: boolean;
  shared: boolean;
};

// `GET /_cloudlink/services` result. `serverTime` is the connector clock in
// Unix seconds and anchors every expiration countdown; connectors predating
// revision 4 omit it and the client falls back to its own clock, which only
// matters when no policy exists.
export type ManagedServiceList = {
  services: ManagedService[];
  serverTime: number;
};

export const MAX_MANAGED_SERVICES = 16;
export const DEFAULT_SERVICES_PORT = 8443;
export const MANAGEMENT_PREFIX = '/_cloudlink';
const MAX_SERVICE_NAME_LENGTH = 64;
export const TARGET_PORTS = [DEFAULT_SERVICES_PORT];

// Mirrors the connector's `valid_id`: 1-32 lowercase letters, digits or hyphens
// with an alphanumeric first and last character.
const SERVICE_ID = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/;
const PATH_SEGMENT = /^[A-Za-z0-9._~-]+$/;

export function isValidServiceId(id: string) {
  return SERVICE_ID.test(id);
}

export function getServiceNameError(name: string): ServiceFieldError | undefined {
  return name.trim().length > MAX_SERVICE_NAME_LENGTH ? 'nameLength' : undefined;
}

export function canonicalizeServicePath(input: string): { path: string } | { error: ServiceFieldError } {
  const trimmed = input.trim();
  if (!trimmed) return { error: 'required' };
  if (trimmed.includes('?') || trimmed.includes('#')) return { error: 'pathFormat' };
  const withLeading = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  const canonical = withLeading.replace(/\/+$/, '');
  if (!canonical) return { error: 'pathRoot' };
  if (canonical === MANAGEMENT_PREFIX || canonical.startsWith(`${MANAGEMENT_PREFIX}/`)) return { error: 'pathReserved' };
  for (const segment of canonical.split('/').slice(1)) {
    if (!segment || segment === '../client' || segment === '..' || !PATH_SEGMENT.test(segment)) return { error: 'pathFormat' };
  }
  return { path: canonical };
}

// Empty input means a root service (api >= 2): the service owns the whole
// port, which is what apps emitting absolute URLs need. Legacy connectors (api
// 1) require an explicit path.
export function canonicalizeOptionalServicePath(
  input: string,
  api = 2,
): { path: string | null } | { error: ServiceFieldError } {
  if (!input.trim()) return api >= 2 ? { path: null } : { error: 'required' };
  return canonicalizeServicePath(input);
}

export function canonicalizeServiceTarget(
  input: string,
  servicePorts: number[] = TARGET_PORTS,
): { target: string } | { error: ServiceFieldError } {
  const trimmed = input.trim();
  if (!trimmed) return { error: 'required' };
  const normalized = trimmed.startsWith('localhost:') ? `127.0.0.1:${trimmed.slice('localhost:'.length)}` : trimmed;
  const match = /^\[([0-9a-fA-F:]+)\]:(\d+)$/.exec(normalized) ?? /^(\d{1,3}(?:\.\d{1,3}){3}):(\d+)$/.exec(normalized);
  if (!match) return { error: 'targetFormat' };
  const host = match[1].toLowerCase();
  const port = Number(match[2]);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) return { error: 'targetPort' };
  if (host !== '127.0.0.1' && host !== '::1') return { error: 'targetLoopback' };
  if (port < 1024) return { error: 'targetPort' };
  if (servicePorts.includes(port)) return { error: 'targetReserved' };
  return { target: `${host === '::1' ? '[::1]' : host}:${port}` };
}

// Port picker state for the mode being edited. A root service needs a port no
// other service uses; a path service may share a port with other path services
// but not with a root service. The connector re-validates.
export function getServicePortOptions({
  editingId,
  path,
  servicePorts,
  services,
}: {
  editingId?: string;
  path: string | null;
  servicePorts: number[];
  services: ManagedService[];
}): ServicePortOption[] {
  const others = services.filter((service) => service.id !== editingId);
  const rootPorts = new Set(others.filter((service) => service.path === null).map((service) => service.port));
  const pathPorts = new Set(others.filter((service) => service.path !== null).map((service) => service.port));
  return servicePorts.map((port) => ({
    port,
    usable: path === null ? !rootPorts.has(port) && !pathPorts.has(port) : !rootPorts.has(port),
    shared: pathPorts.has(port),
  }));
}

// Initial form state for one service. A saved password is never prefilled: the
// field starts empty and an empty value means "keep the stored password".
export function serviceDraftFor(service: ManagedService | undefined, serverTime = Math.floor(Date.now() / 1000)): ServiceDraft {
  if (!service) {
    // A brand-new external service starts private; once the user picks an
    // external mode it shares for an hour unless they change it.
    return {
      id: '',
      name: '',
      port: undefined,
      path: '',
      target: '',
      enabled: false,
      accessMode: 'private',
      stripPrefix: true,
      expiration: '1h',
      customExpirationAmount: '1',
      customExpirationUnit: 'hours',
      password: '',
      passwordSet: false,
      hasPolicy: false,
      legacy: false,
      currentExpiresAt: null,
    };
  }
  const policy = service.access_policy;
  const expired = policy ? isServiceShareExpired(policy, serverTime) : false;
  // An expired share never lands on "keep": the stored deadline is in the past
  // and must be replaced explicitly rather than silently extended.
  const expiration: ServiceExpirationChoice = !policy || policy.mode === 'private' || policy.expires_at === null
    ? 'none'
    : expired ? 'expired' : 'keep';
  return {
    id: service.id,
    name: service.name,
    port: service.port,
    path: service.path ?? '',
    target: service.target,
    enabled: service.enabled,
    accessMode: policy ? policy.mode : service.access,
    stripPrefix: service.strip_prefix,
    expiration,
    customExpirationAmount: '1',
    customExpirationUnit: 'hours',
    password: '',
    passwordSet: policy?.password_set ?? false,
    hasPolicy: Boolean(policy),
    legacy: !policy,
    currentExpiresAt: policy?.expires_at ?? null,
  };
}

// Pure client-side mirror of the connector's canonicalization and validation.
// Returns the PUT body on success, or a per-field error map keyed by stable
// codes the UI maps to localized copy. The body omits `port` on api 1, whose
// connector predates service ports.
//
// `access_policy` is included only when the connector advertises
// `service-access-v1` and the draft actually needs one: a stored policy is
// always re-sent (omitting it is a 409), a legacy service only gains one when
// the user switches to password or picks a non-legacy expiration, and a new
// external service gains one with its default hour.
export function prepareServiceDraft(
  draft: ServiceDraft,
  context: ServiceDraftContext = {},
): { input?: ServiceInput; errors: ServiceDraftErrors } {
  const api = context.api ?? 1;
  const servicePorts = context.servicePorts?.length ? context.servicePorts : TARGET_PORTS;
  const accessSupported = context.accessSupported === true;
  const serverTime = context.serverTime ?? Math.floor(Date.now() / 1000);
  const errors: ServiceDraftErrors = {};
  const id = draft.id.trim();
  if (!id) errors.id = 'required';
  else if (!isValidServiceId(id)) errors.id = 'idFormat';
  const name = draft.name.trim();
  const nameError = getServiceNameError(name);
  if (nameError) errors.name = nameError;
  const pathResult = canonicalizeOptionalServicePath(draft.path, api);
  const canonicalPath = 'error' in pathResult ? undefined : pathResult.path;
  if ('error' in pathResult) errors.path = pathResult.error;
  const targetResult = canonicalizeServiceTarget(draft.target, servicePorts);
  if ('error' in targetResult) errors.target = targetResult.error;
  let port: number | undefined;
  if (api >= 2) {
    if (draft.port === undefined || !Number.isInteger(draft.port)) errors.port = 'portRequired';
    else if (!servicePorts.includes(draft.port)) errors.port = 'portInvalid';
    else port = draft.port;
  }
  if (canonicalPath !== undefined && port !== undefined) {
    const others = (context.services ?? []).filter((service) => service.id !== id);
    if (canonicalPath === null) {
      if (others.some((service) => service.port === port)) errors.port = 'portInUse';
    } else if (others.some((service) => service.port === port && service.path === null)) {
      errors.port = 'portInUse';
    } else if (others.some((service) => service.port === port && service.path === canonicalPath)) {
      errors.path = 'portPathInUse';
    }
  }

  // A protected service on a connector without the capability must not be
  // rewritten with a legacy body: that is exactly what silently clears a
  // password, deadline or share token.
  if (draft.hasPolicy && !accessSupported) errors.accessMode = 'accessUnsupported';
  if (draft.accessMode === 'password' && !accessSupported) errors.accessMode = 'accessUnsupported';
  const policyRequired = accessSupported
    && (draft.hasPolicy || (draft.accessMode !== 'private' && (!draft.legacy || draft.expiration !== 'none')));
  let expiresAt: number | null | undefined;
  if (policyRequired && draft.accessMode !== 'private') {
    const resolved = resolveServiceExpiration({
      choice: draft.expiration,
      currentExpiresAt: draft.currentExpiresAt,
      serverTime,
      amount: draft.customExpirationAmount,
      unit: draft.customExpirationUnit,
    });
    if ('error' in resolved) errors.expiration = resolved.error;
    else expiresAt = resolved.expiresAt;
  }
  if (policyRequired && draft.accessMode === 'password') {
    if (!draft.password) {
      if (!draft.passwordSet) errors.password = 'passwordRequired';
    } else if (draft.password.length < SERVICE_PASSWORD_MIN_LENGTH || draft.password.length > SERVICE_PASSWORD_MAX_LENGTH) {
      errors.password = 'passwordLength';
    }
  }

  if (Object.keys(errors).length > 0) return { errors };
  const input: ServiceInput = {
    ...(name ? { name } : {}),
    target: (targetResult as { target: string }).target,
    enabled: draft.enabled,
    // Legacy projection: password shares report public, exactly as the
    // connector does. The policy below carries the real mode.
    access: draft.accessMode === 'private' ? 'private' : 'public',
  };
  if (api >= 2) {
    input.port = port;
    input.path = canonicalPath ?? null;
    if (canonicalPath !== null) input.strip_prefix = draft.stripPrefix;
  } else {
    input.path = canonicalPath as string;
    input.strip_prefix = draft.stripPrefix;
  }
  if (policyRequired) {
    input.access_policy = {
      mode: draft.accessMode,
      ...(draft.accessMode === 'private' ? {} : { expires_at: expiresAt ?? null }),
      // Omitting the password keeps the stored one; entering a new value
      // replaces it. It never travels back to the client.
      ...(draft.accessMode === 'password' && draft.password ? { password: draft.password } : {}),
    };
  }
  return { errors, input };
}

// `https://<server host>:<port>/` for a root service, or
// `https://<server host>:<port><path>/` for a path service. Legacy api 1
// services carry the implicit 8443 port, so their existing links stay valid.
// A managed share appends its capability: the tokenized URL is the only one
// worth copying, and a share without a token is not shareable at all.
export function buildServiceShareUrl(serverUrl: string, service: Pick<ManagedService, 'port' | 'path' | 'access_policy'>): string {
  const base = normalizeServerUrl(serverUrl);
  if (!base.valid) throw new Error('Add a valid server URL before sharing a service link.');
  const host = new URL(base.origin).hostname;
  const path = service.path && !service.path.endsWith('/') ? `${service.path}/` : service.path;
  const url = `https://${host}:${service.port}${path || '/'}`;
  const policy = service.access_policy;
  if (policy && policy.mode !== 'private') {
    if (!policy.share_token) throw new Error('This service has no share link to copy.');
    return `${url}?cl_share=${encodeURIComponent(policy.share_token)}`;
  }
  return url;
}

// `:2053` for a root service, `:8443/app` for a path service.
export function formatServiceAddress(service: Pick<ManagedService, 'port' | 'path'>): string {
  return `:${service.port}${service.path ?? ''}`;
}

