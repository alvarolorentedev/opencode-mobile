import { normalizeServerUrl } from './url';

// Remote service management for a paired Cloud Link device. The connector
// serves this surface at the reserved `/_cloudlink` prefix on the OpenCode
// origin (never a service port) and authenticates it with the same HTTP Basic
// credential as OpenCode traffic. The wire contract is frozen in the
// connector's `protocol/README.md`; the validation below mirrors it so the UI
// can reject bad input before spending a round trip, but the stored response is
// always authoritative.
//
// Management API revision 2 (connector 0.1.14+) gives every service a dedicated
// `port` from the connector's pool and an optional `path`: no path means the
// service owns the port root, a path shares the port with other path services.
// Revision 1 and pre-version connectors only support path services on the
// legacy `:8443` origin; those services carry an implicit port here so the rest
// of the app can build links and render addresses uniformly.

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
};

// PUT body. `id` comes from the URL, so it is not part of the payload. `port`
// is required by api 2 connectors and omitted only for legacy api 1 connectors,
// which have no port concept.
export type ServiceInput = {
  name?: string;
  port?: number;
  path?: string | null;
  target: string;
  enabled?: boolean;
  access?: ServiceAccess;
  strip_prefix?: boolean;
};

// Editable form state. The path is a string in the UI; an empty path means the
// service owns the port root (api 2 only). `port` stays undefined on api 1.
export type ServiceDraft = {
  id: string;
  name: string;
  port?: number;
  path: string;
  target: string;
  enabled: boolean;
  access: ServiceAccess;
  stripPrefix: boolean;
};

// Connector-reported management compatibility and port pool.
export type ServiceManagementVersion = {
  // Management API revision: 2 supports ports and root services; 1 is the
  // legacy path-only surface.
  api: number;
  // Connector release version from the body or the version header.
  version?: string;
  // False when a pre-version connector answered `404` without a version header.
  // Those connectors are treated as api 1 and warned about, never blocked.
  known: boolean;
  // Selectable ports. Always `[8443]` on api 1.
  servicePorts: number[];
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
  | 'targetPort';

export type ServiceDraftErrors = Partial<Record<'id' | 'name' | 'path' | 'port' | 'target', ServiceFieldError>>;

// Connector context the local validation mirror needs: the management revision
// in effect, its service port pool, and the current stored list for the port
// and port/path uniqueness rules.
export type ServiceDraftContext = {
  api?: number;
  servicePorts?: number[];
  services?: ManagedService[];
};

export type ServicePortOption = {
  port: number;
  usable: boolean;
  shared: boolean;
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
    if (!segment || segment === '.' || segment === '..' || !PATH_SEGMENT.test(segment)) return { error: 'pathFormat' };
  }
  return { path: canonical };
}

// Empty input means a root service (api 2 only): the service owns the whole
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

// Pure client-side mirror of the connector's canonicalization and validation.
// Returns the PUT body on success, or a per-field error map keyed by stable
// codes the UI maps to localized copy. The body omits `port` on api 1, whose
// connector predates service ports.
export function prepareServiceDraft(
  draft: ServiceDraft,
  context: ServiceDraftContext = {},
): { input?: ServiceInput; errors: ServiceDraftErrors } {
  const api = context.api ?? 1;
  const servicePorts = context.servicePorts?.length ? context.servicePorts : TARGET_PORTS;
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
  if (Object.keys(errors).length > 0) return { errors };
  const input: ServiceInput = {
    ...(name ? { name } : {}),
    target: (targetResult as { target: string }).target,
    enabled: draft.enabled,
    access: draft.access,
  };
  if (api >= 2) {
    input.port = port;
    input.path = canonicalPath ?? null;
    if (canonicalPath !== null) input.strip_prefix = draft.stripPrefix;
  } else {
    input.path = canonicalPath as string;
    input.strip_prefix = draft.stripPrefix;
  }
  return { errors, input };
}

// `https://<server host>:<port>/` for a root service, or
// `https://<server host>:<port><path>/` for a path service. Legacy api 1
// services carry the implicit 8443 port, so their existing links stay valid.
export function buildServiceShareUrl(serverUrl: string, service: Pick<ManagedService, 'port' | 'path'>): string {
  const base = normalizeServerUrl(serverUrl);
  if (!base.valid) throw new Error('Add a valid server URL before sharing a service link.');
  const host = new URL(base.origin).hostname;
  const path = service.path && !service.path.endsWith('/') ? `${service.path}/` : service.path;
  return `https://${host}:${service.port}${path || '/'}`;
}

// `:2053` for a root service, `:8443/app` for a path service.
export function formatServiceAddress(service: Pick<ManagedService, 'port' | 'path'>): string {
  return `:${service.port}${service.path ?? ''}`;
}

