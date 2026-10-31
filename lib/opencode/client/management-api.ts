import { fetch as expoFetch } from 'expo/fetch';

import { getConnectCredentialError } from '@/lib/connect';
import { createAuthHeader } from './fetch';
import { normalizeServerUrl } from './url';
import type { OpencodeConnectionSettings } from './types';
import { DEFAULT_SERVICES_PORT, MANAGEMENT_PREFIX, TARGET_PORTS, type ManagedService, type ServiceInput, type ServiceManagementVersion } from './management';

const VERSION_HEADER = 'x-cloudlink-connector-version';

// A management failure carrying the connector's HTTP status and message. The UI
// shows `message`; callers must not branch on its wording.
export class ServiceManagementError extends Error {
  constructor(public status: number, message: string, public connectorVersion?: string) {
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
): Promise<{ status: number; value?: unknown; connectorVersion?: string }> {
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
  const connectorVersion = response.headers.get(VERSION_HEADER) ?? undefined;
  const body = await readBody(response);
  if (!response.ok) {
    const fallback = response.status === 401
      ? 'Cloud Link credentials were rejected. Reconnect and try again.'
      : 'The connector rejected the request.';
    throw new ServiceManagementError(response.status, describeError(body, fallback), connectorVersion);
  }
  return { status: response.status, value: body, connectorVersion };
}

function parseServicePorts(value: unknown): number[] {
  if (!Array.isArray(value)) return TARGET_PORTS;
  const ports = value.filter((entry): entry is number => Number.isInteger(entry) && entry > 0 && entry <= 65_535);
  return ports.length > 0 ? ports : TARGET_PORTS;
}

// Read the connector's management revision and port pool. A pre-version
// connector answers `404` without a version header: that is a warning, not a
// failure, so it degrades to the legacy api 1 contract.
export async function getServiceManagementVersion(
  settings: OpencodeConnectionSettings,
  signal?: AbortSignal,
): Promise<ServiceManagementVersion> {
  try {
    const { value, connectorVersion } = await managementRequest(settings, '/version', { method: 'GET', signal });
    const body = (value ?? {}) as { api?: unknown; service_ports?: unknown; version?: unknown };
    const version = typeof body.version === 'string' && body.version.trim() ? body.version.trim() : connectorVersion;
    const api = typeof body.api === 'number' && Number.isInteger(body.api) && body.api >= 0 ? body.api : 1;
    return {
      api,
      version,
      known: true,
      servicePorts: api >= 2 ? parseServicePorts(body.service_ports) : TARGET_PORTS,
    };
  } catch (error) {
    if (error instanceof ServiceManagementError && error.status === 404) {
      return {
        api: 1,
        version: error.connectorVersion,
        known: Boolean(error.connectorVersion),
        servicePorts: TARGET_PORTS,
      };
    }
    throw error;
  }
}

function parseService(value: unknown): ManagedService {
  const record = value as Partial<ManagedService> | undefined;
  const port = record?.port;
  if (
    !record
    || typeof record.id !== 'string'
    || typeof record.name !== 'string'
    || (record.path !== null && typeof record.path !== 'string')
    || typeof record.target !== 'string'
    || typeof record.enabled !== 'boolean'
    || (record.access !== 'private' && record.access !== 'public')
    || typeof record.strip_prefix !== 'boolean'
    || (port !== undefined && (typeof port !== 'number' || !Number.isInteger(port) || port <= 0 || port > 65_535))
  ) {
    throw new ServiceManagementError(0, 'The connector returned an invalid service.');
  }
  return {
    id: record.id,
    name: record.name,
    // Pre-port connectors store no port; their services all lived on 8443, so
    // the legacy origin is implicit here and in links.
    port: port ?? DEFAULT_SERVICES_PORT,
    path: record.path ?? null,
    target: record.target,
    enabled: record.enabled,
    access: record.access,
    strip_prefix: record.strip_prefix,
  };
}

export async function listManagedServices(settings: OpencodeConnectionSettings, signal?: AbortSignal): Promise<ManagedService[]> {
  const { value } = await managementRequest(settings, '/services', { method: 'GET', signal });
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
