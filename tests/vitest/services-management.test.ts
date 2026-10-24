import { afterEach, describe, expect, it, vi } from 'vitest';

import type { OpencodeConnectionSettings } from '@/lib/opencode/client/types';
import {
  DEFAULT_SERVICES_PORT,
  buildServiceShareUrl,
  canonicalizeOptionalServicePath,
  canonicalizeServicePath,
  canonicalizeServiceTarget,
  formatServiceAddress,
  getServicePortOptions,
  isValidServiceId,
  prepareServiceDraft,
  type ManagedService,
} from '@/lib/opencode/client/management';
import {
  ServiceManagementError,
  deleteManagedService,
  getServiceManagementVersion,
  listManagedServices,
  putManagedService,
} from '@/lib/opencode/client/management-api';

const h = vi.hoisted(() => ({ credentialError: undefined as string | undefined }));
vi.mock('@/lib/connect', () => ({ getConnectCredentialError: () => h.credentialError }));
vi.mock('@/lib/opencode/data-usage', () => ({ recordBytes: vi.fn(), recordRequest: vi.fn() }));
vi.mock('@/lib/opencode/client/types', () => ({ defaultConnectionSettings: { serverUrl: 'http://127.0.0.1:4096' } }));
vi.mock('expo/fetch', () => ({ fetch: (...args: unknown[]) => (globalThis.fetch as unknown as (...a: unknown[]) => Response)(...args) }));

const settings: OpencodeConnectionSettings = {
  serverUrl: 'https://m-opaque.opencodecloud.link',
  username: 'device-1',
  password: 'device-secret',
  directory: '',
  connect: {
    controlPlaneUrl: 'https://api.opencodecloud.link',
    machineId: 'machine-1',
    machineName: 'Mac',
    deviceId: 'device-1',
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  },
};

const SERVICE_PORTS = [8443, 2053, 2083, 2087, 2096];

function service(overrides: Record<string, unknown> = {}): ManagedService {
  return { id: 'api', name: 'API', port: 8443, path: '/test/api', target: '127.0.0.1:3000', enabled: false, access: 'private', strip_prefix: true, ...overrides };
}

function jsonResponse(payload: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json', ...headers } });
}

afterEach(() => {
  h.credentialError = undefined;
  vi.unstubAllGlobals();
});

describe('service validation mirror', () => {
  it('accepts connector-valid ids and rejects malformed ones', () => {
    expect(isValidServiceId('api')).toBe(true);
    expect(isValidServiceId('api-2')).toBe(true);
    expect(isValidServiceId('API')).toBe(false);
    expect(isValidServiceId('-api')).toBe(false);
    expect(isValidServiceId('api-')).toBe(false);
    expect(isValidServiceId('a'.repeat(33))).toBe(false);
  });

  it('canonicalizes paths and reports the connector error class', () => {
    expect(canonicalizeServicePath('test/api/')).toEqual({ path: '/test/api' });
    expect(canonicalizeServicePath('/')).toEqual({ error: 'pathRoot' });
    expect(canonicalizeServicePath('/_cloudlink/x')).toEqual({ error: 'pathReserved' });
    expect(canonicalizeServicePath('/a/%20/b')).toEqual({ error: 'pathFormat' });
    expect(canonicalizeServicePath('/a/../b')).toEqual({ error: 'pathFormat' });
    expect(canonicalizeServicePath('')).toEqual({ error: 'required' });
  });

  it('treats an empty path as the port root on api 2 and rejects it on api 1', () => {
    expect(canonicalizeOptionalServicePath('')).toEqual({ path: null });
    expect(canonicalizeOptionalServicePath('  ', 2)).toEqual({ path: null });
    expect(canonicalizeOptionalServicePath('', 1)).toEqual({ error: 'required' });
    expect(canonicalizeOptionalServicePath('test/api/')).toEqual({ path: '/test/api' });
    expect(canonicalizeOptionalServicePath('/')).toEqual({ error: 'pathRoot' });
  });

  it('canonicalizes targets and enforces loopback and reserved ports', () => {
    expect(canonicalizeServiceTarget('localhost:3000')).toEqual({ target: '127.0.0.1:3000' });
    expect(canonicalizeServiceTarget('[::1]:3000')).toEqual({ target: '[::1]:3000' });
    expect(canonicalizeServiceTarget('10.0.0.1:3000')).toEqual({ error: 'targetLoopback' });
    expect(canonicalizeServiceTarget('127.0.0.1:8443')).toEqual({ error: 'targetReserved' });
    expect(canonicalizeServiceTarget('127.0.0.1:2053')).toEqual({ target: '127.0.0.1:2053' });
    expect(canonicalizeServiceTarget('127.0.0.1:2053', [2053, 2083])).toEqual({ error: 'targetReserved' });
    expect(canonicalizeServiceTarget('127.0.0.1:2053', [8443])).toEqual({ target: '127.0.0.1:2053' });
    expect(canonicalizeServiceTarget('127.0.0.1:80')).toEqual({ error: 'targetPort' });
    expect(canonicalizeServiceTarget('nope')).toEqual({ error: 'targetFormat' });
  });

  it('builds a legacy PUT body without a port on api 1', () => {
    const prepared = prepareServiceDraft({ id: 'api', name: '', path: 'test/api/', target: 'localhost:3000', enabled: false, access: 'private', stripPrefix: true });
    expect(prepared.errors).toEqual({});
    expect(prepared.input).toEqual({ path: '/test/api', target: '127.0.0.1:3000', enabled: false, access: 'private', strip_prefix: true });
  });

  it('builds an api 2 path body with the port and prefix toggle', () => {
    const prepared = prepareServiceDraft(
      { id: 'api', name: 'API', port: 2053, path: 'test/api/', target: 'localhost:3000', enabled: true, access: 'public', stripPrefix: false },
      { api: 2, servicePorts: SERVICE_PORTS, services: [] },
    );
    expect(prepared.errors).toEqual({});
    expect(prepared.input).toEqual({ name: 'API', port: 2053, path: '/test/api', strip_prefix: false, target: '127.0.0.1:3000', enabled: true, access: 'public' });
  });

  it('builds an api 2 root body without strip_prefix and requires a port', () => {
    const prepared = prepareServiceDraft(
      { id: 'app', name: '', port: 2053, path: '', target: '127.0.0.1:3000', enabled: false, access: 'private', stripPrefix: true },
      { api: 2, servicePorts: SERVICE_PORTS, services: [] },
    );
    expect(prepared.errors).toEqual({});
    expect(prepared.input).toEqual({ port: 2053, path: null, target: '127.0.0.1:3000', enabled: false, access: 'private' });
    const missing = prepareServiceDraft(
      { id: 'app', name: '', path: '', target: '127.0.0.1:3000', enabled: false, access: 'private', stripPrefix: true },
      { api: 2, servicePorts: SERVICE_PORTS, services: [] },
    );
    expect(missing.input).toBeUndefined();
    expect(missing.errors).toEqual({ port: 'portRequired' });
  });

  it('mirrors the port rules: root owns a port, path services share one', () => {
    const root = service({ id: 'site', port: 2053, path: null });
    const path = service({ id: 'api', port: 8443, path: '/test/api' });
    const services = [root, path];
    const rootDraft = { id: 'other', name: '', port: 2053, path: '', target: '127.0.0.1:3000', enabled: false, access: 'private' as const, stripPrefix: true };
    expect(prepareServiceDraft(rootDraft, { api: 2, servicePorts: SERVICE_PORTS, services }).errors).toEqual({ port: 'portInUse' });
    expect(prepareServiceDraft({ ...rootDraft, port: 8443 }, { api: 2, servicePorts: SERVICE_PORTS, services }).errors).toEqual({ port: 'portInUse' });
    // Path services may share 8443 with another path service, but not a port
    // owned by a root service.
    expect(prepareServiceDraft({ ...rootDraft, port: 8443, path: '/other' }, { api: 2, servicePorts: SERVICE_PORTS, services }).errors).toEqual({});
    expect(prepareServiceDraft({ ...rootDraft, port: 2053, path: '/other' }, { api: 2, servicePorts: SERVICE_PORTS, services }).errors).toEqual({ port: 'portInUse' });
    // The same port/path pair is unique.
    expect(prepareServiceDraft({ ...rootDraft, port: 8443, path: '/test/api' }, { api: 2, servicePorts: SERVICE_PORTS, services }).errors).toEqual({ path: 'portPathInUse' });
    // Editing a service ignores its own stored entry.
    expect(prepareServiceDraft({ ...rootDraft, id: 'api', port: 8443, path: '/test/api' }, { api: 2, servicePorts: SERVICE_PORTS, services }).errors).toEqual({});
    // A port outside the connector's pool is rejected before the round trip.
    expect(prepareServiceDraft({ ...rootDraft, port: 9999 }, { api: 2, servicePorts: SERVICE_PORTS, services }).errors).toEqual({ port: 'portInvalid' });
  });

  it('returns per-field errors without an input', () => {
    const prepared = prepareServiceDraft({ id: 'API', name: '', path: '/', target: '10.0.0.1:70000', enabled: true, access: 'public', stripPrefix: false });
    expect(prepared.input).toBeUndefined();
    expect(prepared.errors).toEqual({ id: 'idFormat', path: 'pathRoot', target: 'targetPort' });
    expect(prepareServiceDraft({ id: 'api', name: '', path: '', target: '127.0.0.1:3000', enabled: false, access: 'private', stripPrefix: true }).errors).toEqual({ path: 'required' });
  });

  it('computes selectable ports for root and path modes', () => {
    const services = [service({ id: 'site', port: 2053, path: null }), service({ id: 'api', port: 8443, path: '/test/api' })];
    expect(getServicePortOptions({ path: null, servicePorts: SERVICE_PORTS, services })).toEqual([
      { port: 8443, usable: false, shared: true },
      { port: 2053, usable: false, shared: false },
      { port: 2083, usable: true, shared: false },
      { port: 2087, usable: true, shared: false },
      { port: 2096, usable: true, shared: false },
    ]);
    expect(getServicePortOptions({ path: '/other', servicePorts: SERVICE_PORTS, services })).toEqual([
      { port: 8443, usable: true, shared: true },
      { port: 2053, usable: false, shared: false },
      { port: 2083, usable: true, shared: false },
      { port: 2087, usable: true, shared: false },
      { port: 2096, usable: true, shared: false },
    ]);
    // The service being edited never blocks its own port.
    expect(getServicePortOptions({ editingId: 'site', path: null, servicePorts: SERVICE_PORTS, services })[1]).toEqual({ port: 2053, usable: true, shared: false });
  });

  it('builds shareable links for root, path and legacy services', () => {
    expect(buildServiceShareUrl('https://m-opaque.opencodecloud.link', { port: 2053, path: null })).toBe('https://m-opaque.opencodecloud.link:2053/');
    expect(buildServiceShareUrl('https://m-opaque.opencodecloud.link', { port: 2083, path: '/test/api' })).toBe('https://m-opaque.opencodecloud.link:2083/test/api/');
    expect(buildServiceShareUrl('https://m-opaque.opencodecloud.link', { port: DEFAULT_SERVICES_PORT, path: '/test/api' })).toBe('https://m-opaque.opencodecloud.link:8443/test/api/');
    expect(formatServiceAddress({ port: 2053, path: null })).toBe(':2053');
    expect(formatServiceAddress({ port: 8443, path: '/test/api' })).toBe(':8443/test/api');
  });
});

describe('service management requests', () => {
  it('lists services with the device Basic credential', async () => {
    const fetch = vi.fn(async () => jsonResponse({ services: [service()] }));
    vi.stubGlobal('fetch', fetch);
    await expect(listManagedServices(settings)).resolves.toEqual([service()]);
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://m-opaque.opencodecloud.link/_cloudlink/services');
    expect(init.method).toBe('GET');
    expect((init.headers as Record<string, string>).Authorization).toBe(`Basic ${Buffer.from('device-1:device-secret').toString('base64')}`);
    expect(init.redirect).toBe('error');
  });

  it('decodes both stored shapes: a path string and a null path', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ services: [
      service({ id: 'app', port: 2053, path: null }),
      service({ id: 'api', port: 8443, path: '/test/api' }),
    ] })));
    await expect(listManagedServices(settings)).resolves.toEqual([
      service({ id: 'app', port: 2053, path: null }),
      service({ id: 'api', port: 8443, path: '/test/api' }),
    ]);
  });

  it('defaults pre-port list entries to the legacy 8443 origin', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ services: [
      { id: 'api', name: 'API', path: '/test/api', target: '127.0.0.1:3000', enabled: false, access: 'private', strip_prefix: true },
    ] })));
    await expect(listManagedServices(settings)).resolves.toEqual([service({ port: 8443, path: '/test/api' })]);
  });

  it('reads the api 2 version response with its service port pool', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ version: '0.1.14', api: 2, service_ports: SERVICE_PORTS }, 200, { 'x-cloudlink-connector-version': '0.1.14' })));
    await expect(getServiceManagementVersion(settings)).resolves.toEqual({ api: 2, version: '0.1.14', known: true, servicePorts: SERVICE_PORTS });
  });

  it('reads an api 1 version response without a port pool', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ version: '0.1.14-dev', api: 1 }, 200, { 'x-cloudlink-connector-version': '0.1.14-dev' })));
    await expect(getServiceManagementVersion(settings)).resolves.toEqual({ api: 1, version: '0.1.14-dev', known: true, servicePorts: [DEFAULT_SERVICES_PORT] });
  });

  it('treats a 404 without a version header as an unknown older connector', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not found', { status: 404 })));
    await expect(getServiceManagementVersion(settings)).resolves.toEqual({ api: 1, version: undefined, known: false, servicePorts: [DEFAULT_SERVICES_PORT] });
  });

  it('falls back to the version header when the body omits it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ api: 2, service_ports: [8443] }, 200, { 'x-cloudlink-connector-version': '0.1.14' })));
    await expect(getServiceManagementVersion(settings)).resolves.toEqual({ api: 2, version: '0.1.14', known: true, servicePorts: [8443] });
  });

  it('creates a root service with the api 2 PUT body', async () => {
    const fetch = vi.fn(async () => jsonResponse({ service: service({ id: 'app', port: 2053, path: null }) }, 201));
    vi.stubGlobal('fetch', fetch);
    await expect(putManagedService(settings, 'app', { port: 2053, path: null, target: '127.0.0.1:3000' })).resolves.toEqual(service({ id: 'app', port: 2053, path: null }));
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://m-opaque.opencodecloud.link/_cloudlink/services/app');
    expect(init.method).toBe('PUT');
    expect(init.body).toBe(JSON.stringify({ port: 2053, path: null, target: '127.0.0.1:3000' }));
  });

  it('sends the legacy PUT body without a port on api 1', async () => {
    const fetch = vi.fn(async () => jsonResponse({ service: { id: 'api', name: 'API', path: '/test/api', target: '127.0.0.1:3000', enabled: false, access: 'private', strip_prefix: true } }, 201));
    vi.stubGlobal('fetch', fetch);
    await expect(putManagedService(settings, 'api', { path: '/test/api', target: '127.0.0.1:3000' })).resolves.toEqual(service());
    expect((fetch.mock.calls[0] as [string, RequestInit])[1].body).toBe(JSON.stringify({ path: '/test/api', target: '127.0.0.1:3000' }));
  });

  it('deletes a service', async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetch);
    await expect(deleteManagedService(settings, 'api')).resolves.toBeUndefined();
    expect((fetch.mock.calls[0] as [string, RequestInit])[1].method).toBe('DELETE');
  });

  it('surfaces the connector message and status on failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('invalid service: missing field `port`', { status: 400 })));
    await expect(putManagedService(settings, 'api', { path: '/x', target: 'bad' })).rejects.toMatchObject({
      name: 'ServiceManagementError',
      status: 400,
      message: 'invalid service: missing field `port`',
    });
  });

  it('rejects management without a Cloud Link connection', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await expect(listManagedServices({ ...settings, connect: undefined })).rejects.toBeInstanceOf(ServiceManagementError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('refuses to send with an expired credential', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    h.credentialError = 'Cloud Link credentials expired.';
    await expect(listManagedServices(settings)).rejects.toMatchObject({ status: 401, message: 'Cloud Link credentials expired.' });
    expect(fetch).not.toHaveBeenCalled();
  });
});
