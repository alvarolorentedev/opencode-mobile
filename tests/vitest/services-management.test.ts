import { afterEach, describe, expect, it, vi } from 'vitest';

import type { OpencodeConnectionSettings } from '@/lib/opencode/client/types';
import {
  ServiceManagementError,
  buildServiceShareUrl,
  canonicalizeServicePath,
  canonicalizeServiceTarget,
  deleteManagedService,
  isValidServiceId,
  listManagedServices,
  prepareServiceDraft,
  putManagedService,
} from '@/lib/opencode/client/management';

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

function service(overrides: Record<string, unknown> = {}) {
  return { id: 'api', name: 'API', path: '/test/api', target: '127.0.0.1:3000', enabled: false, access: 'private', strip_prefix: true, ...overrides };
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

  it('canonicalizes targets and enforces loopback and reserved ports', () => {
    expect(canonicalizeServiceTarget('localhost:3000')).toEqual({ target: '127.0.0.1:3000' });
    expect(canonicalizeServiceTarget('[::1]:3000')).toEqual({ target: '[::1]:3000' });
    expect(canonicalizeServiceTarget('10.0.0.1:3000')).toEqual({ error: 'targetLoopback' });
    expect(canonicalizeServiceTarget('127.0.0.1:8443')).toEqual({ error: 'targetReserved' });
    expect(canonicalizeServiceTarget('127.0.0.1:80')).toEqual({ error: 'targetPort' });
    expect(canonicalizeServiceTarget('nope')).toEqual({ error: 'targetFormat' });
  });

  it('builds a PUT body with connector defaults', () => {
    const prepared = prepareServiceDraft({ id: 'api', name: '', path: 'test/api/', target: 'localhost:3000', enabled: false, access: 'private', stripPrefix: true });
    expect(prepared.errors).toEqual({});
    expect(prepared.input).toEqual({ path: '/test/api', target: '127.0.0.1:3000', enabled: false, access: 'private', strip_prefix: true });
  });

  it('returns per-field errors without an input', () => {
    const prepared = prepareServiceDraft({ id: 'API', name: '', path: '/', target: '10.0.0.1:70000', enabled: true, access: 'public', stripPrefix: false });
    expect(prepared.input).toBeUndefined();
    expect(prepared.errors).toEqual({ id: 'idFormat', path: 'pathRoot', target: 'targetPort' });
  });

  it('builds a shareable services-origin link', () => {
    expect(buildServiceShareUrl('https://m-opaque.opencodecloud.link', '/test/api')).toBe('https://m-opaque.opencodecloud.link:8443/test/api/');
  });
});

describe('service management requests', () => {
  it('lists services with the device Basic credential', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ services: [service()] }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetch);
    await expect(listManagedServices(settings)).resolves.toEqual([service()]);
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://m-opaque.opencodecloud.link/_cloudlink/services');
    expect(init.method).toBe('GET');
    expect((init.headers as Record<string, string>).Authorization).toBe(`Basic ${Buffer.from('device-1:device-secret').toString('base64')}`);
    expect(init.redirect).toBe('error');
  });

  it('creates and replaces a service from the returned canonical value', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ service: service({ path: '/test/api' }) }), { status: 201, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetch);
    await expect(putManagedService(settings, 'api', { path: '/test/api', target: '127.0.0.1:3000' })).resolves.toEqual(service());
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://m-opaque.opencodecloud.link/_cloudlink/services/api');
    expect(init.method).toBe('PUT');
    expect(init.body).toBe(JSON.stringify({ path: '/test/api', target: '127.0.0.1:3000' }));
  });

  it('deletes a service', async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetch);
    await expect(deleteManagedService(settings, 'api')).resolves.toBeUndefined();
    expect((fetch.mock.calls[0] as [string, RequestInit])[1].method).toBe('DELETE');
  });

  it('surfaces the connector message and status on failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('invalid service: bad target', { status: 400 })));
    await expect(putManagedService(settings, 'api', { path: '/x', target: 'bad' })).rejects.toMatchObject({
      name: 'ServiceManagementError',
      status: 400,
      message: 'invalid service: bad target',
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
