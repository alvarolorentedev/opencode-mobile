import { fetch as expoFetch } from 'expo/fetch';

import { getConnectCredentialError } from '@/lib/connect';

import { createAuthHeader } from './fetch';
import { normalizeServerUrl } from './url';
import type { OpencodeConnectionSettings } from './types';

// Remote service management for a paired Cloud Link device. The connector
// serves this surface at the reserved `/_cloudlink` prefix on the OpenCode
// origin (never the `:8443` services origin) and authenticates it with the same
// HTTP Basic credential as OpenCode traffic. The wire contract is frozen in the
// connector's `protocol/README.md`; the validation below mirrors it so the UI
// can reject bad input before spending a round trip, but the stored response is
// always authoritative.

export type ServiceAccess = 'private' | 'public';

export type ManagedService = {
  id: string;
  name: string;
  path: string;
  target: string;
  enabled: boolean;
  access: ServiceAccess;
  strip_prefix: boolean;
};

// PUT body. `id` comes from the URL, so it is not part of the payload.
export type ServiceInput = {
  name?: string;
  path: string;
  target: string;
  enabled?: boolean;
  access?: ServiceAccess;
  strip_prefix?: boolean;
};

export type ServiceDraft = {
  id: string;
  name: string;
  path: string;
  target: string;
  enabled: boolean;
  access: ServiceAccess;
  stripPrefix: boolean;
};

export type ServiceFieldError =
  | 'required'
  | 'idFormat'
  | 'nameLength'
  | 'pathRoot'
  | 'pathReserved'
  | 'pathFormat'
  | 'targetFormat'
  | 'targetLoopback'
  | 'targetReserved'
  | 'targetPort';

export type ServiceDraftErrors = Partial<Record<'id' | 'name' | 'path' | 'target', ServiceFieldError>>;

export const MAX_MANAGED_SERVICES = 16;
export const SERVICES_PORT = 8443;
const MANAGEMENT_PREFIX = '/_cloudlink';
const MAX_SERVICE_NAME_LENGTH = 64;

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

export function canonicalizeServiceTarget(input: string): { target: string } | { error: ServiceFieldError } {
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
  if (port === SERVICES_PORT) return { error: 'targetReserved' };
  return { target: `${host === '::1' ? '[::1]' : host}:${port}` };
}

// Pure client-side mirror of the connector's canonicalization and validation.
// Returns the PUT body on success, or a per-field error map keyed by stable
// codes the UI maps to localized copy.
export function prepareServiceDraft(draft: ServiceDraft): { input?: ServiceInput; errors: ServiceDraftErrors } {
  const errors: ServiceDraftErrors = {};
  const id = draft.id.trim();
  if (!id) errors.id = 'required';
  else if (!isValidServiceId(id)) errors.id = 'idFormat';
  const name = draft.name.trim();
  const nameError = getServiceNameError(name);
  if (nameError) errors.name = nameError;
  const path = canonicalizeServicePath(draft.path);
  if ('error' in path) errors.path = path.error;
  const target = canonicalizeServiceTarget(draft.target);
  if ('error' in target) errors.target = target.error;
  if ('error' in path || 'error' in target || Object.keys(errors).length > 0) return { errors };
  return {
    errors,
    input: {
      ...(name ? { name } : {}),
      path: path.path,
      target: target.target,
      enabled: draft.enabled,
      access: draft.access,
      strip_prefix: draft.stripPrefix,
    },
  };
}

// `https://<server host>:8443<path>/`. The connector matches the path prefix
// before forwarding and re-prefixes redirects by default.
export function buildServiceShareUrl(serverUrl: string, path: string): string {
  const base = normalizeServerUrl(serverUrl);
  if (!base.valid) throw new Error('Add a valid server URL before sharing a service link.');
  const host = new URL(base.origin).hostname;
  const canonical = path.endsWith('/') ? path : `${path}/`;
  return `https://${host}:${SERVICES_PORT}${canonical}`;
}

// A management failure carrying the connector's HTTP status and message. The UI
// shows `message`; callers must not branch on its wording.
export class ServiceManagementError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'ServiceManagementError';
  }
}

function managementUrl(settings: OpencodeConnectionSettings, path: string) {
  const base = normalizeServerUrl(settings.serverUrl);
  if (!base.valid) throw new ServiceManagementError(0, 'Add a valid server URL before managing services.');
  return new URL(`${MANAGEMENT_PREFIX}${path}`, base.origin).toString();
}

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function describeError(body: unknown, fallback: string) {
  if (typeof body === 'string' && body.trim()) return body.trim();
  if (body && typeof body === 'object') {
    const record = body as { message?: unknown; error?: unknown };
    if (typeof record.message === 'string' && record.message.trim()) return record.message;
    if (typeof record.error === 'string' && record.error.trim()) return record.error;
  }
  return fallback;
}

async function managementRequest(
  settings: OpencodeConnectionSettings,
  path: string,
  init: RequestInit,
): Promise<{ status: number; value?: unknown }> {
  if (!settings.connect) {
    throw new ServiceManagementError(0, 'Service management is only available for Cloud Link connections.');
  }
  const credentialError = getConnectCredentialError(settings.connect, settings.password);
  if (credentialError) throw new ServiceManagementError(401, credentialError);
  const auth = createAuthHeader(settings);
  let response: Response;
  try {
    response = await expoFetch(managementUrl(settings, path), {
      ...init,
      redirect: 'error',
      headers: { ...(init.headers ?? {}), ...(auth ? { Authorization: auth } : {}) },
    });
  } catch {
    throw new ServiceManagementError(0, 'Could not reach the connector. Check the connection and try again.');
  }
  const body = await readBody(response);
  if (!response.ok) {
    const fallback = response.status === 401
      ? 'Cloud Link credentials were rejected. Reconnect and try again.'
      : 'The connector rejected the request.';
    throw new ServiceManagementError(response.status, describeError(body, fallback));
  }
  return { status: response.status, value: body };
}

function parseService(value: unknown): ManagedService {
  const record = value as Partial<ManagedService> | undefined;
  if (
    !record
    || typeof record.id !== 'string'
    || typeof record.name !== 'string'
    || typeof record.path !== 'string'
    || typeof record.target !== 'string'
    || typeof record.enabled !== 'boolean'
    || (record.access !== 'private' && record.access !== 'public')
    || typeof record.strip_prefix !== 'boolean'
  ) {
    throw new ServiceManagementError(0, 'The connector returned an invalid service.');
  }
  return {
    id: record.id,
    name: record.name,
    path: record.path,
    target: record.target,
    enabled: record.enabled,
    access: record.access,
    strip_prefix: record.strip_prefix,
  };
}

export async function listManagedServices(settings: OpencodeConnectionSettings): Promise<ManagedService[]> {
  const { value } = await managementRequest(settings, '/services', { method: 'GET' });
  const list = (value as { services?: unknown } | undefined)?.services;
  if (!Array.isArray(list)) throw new ServiceManagementError(0, 'The connector returned an invalid service list.');
  return list.map(parseService);
}

export async function putManagedService(
  settings: OpencodeConnectionSettings,
  id: string,
  input: ServiceInput,
): Promise<ManagedService> {
  const { value } = await managementRequest(settings, `/services/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return parseService((value as { service?: unknown } | undefined)?.service);
}

export async function deleteManagedService(settings: OpencodeConnectionSettings, id: string): Promise<void> {
  await managementRequest(settings, `/services/${encodeURIComponent(id)}`, { method: 'DELETE' });
}
