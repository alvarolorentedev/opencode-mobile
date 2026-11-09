import { describe, expect, it, vi } from 'vitest';

import {
  buildServiceShareUrl,
  prepareServiceDraft,
  serviceDraftFor,
  type ManagedService,
  type ServiceDraft,
  type ServiceDraftContext,
} from '@/shared/contracts/service-management';
import {
  SERVICE_ACCESS_CAPABILITY,
  formatServiceRemaining,
  getServiceAccessMode,
  getServiceRemainingSeconds,
  getServiceServerNow,
  isServiceShareExpired,
  resolveServiceExpiration,
  supportsServiceAccess,
  type ServiceAccessPolicy,
} from '@/shared/contracts/service-access';

// `service-management` reaches `server-url` → `client/types`, which pulls in
// the native module registry; the contract itself only needs the default URL.
vi.mock('react-native', () => ({ Platform: { OS: 'web' } }));
vi.mock('@/shared/protocol/opencode/client/types', () => ({ defaultConnectionSettings: { serverUrl: 'http://127.0.0.1:4096' } }));

const SERVER_TIME = 1_760_000_000;
const SERVICE_PORTS = [8443, 2053, 2083, 2087, 2096];

function policy(overrides: Partial<ServiceAccessPolicy> = {}): ServiceAccessPolicy {
  return { mode: 'public', expires_at: SERVER_TIME + 3600, expired: false, password_set: false, share_token: 'share-token', revision: 2, ...overrides };
}

function service(overrides: Record<string, unknown> = {}): ManagedService {
  return { id: 'api', name: 'API', port: 8443, path: '/test/api', target: '127.0.0.1:3000', enabled: true, access: 'public', strip_prefix: true, ...overrides };
}

function context(overrides: ServiceDraftContext = {}): ServiceDraftContext {
  return { api: 2, servicePorts: SERVICE_PORTS, services: [], accessSupported: true, serverTime: SERVER_TIME, ...overrides };
}

// A brand-new service still needs the fields the connector requires; the UI
// supplies the id/target before Save, the port default comes from the picker.
function newDraft(overrides: Partial<ServiceDraft> = {}): ServiceDraft {
  return { ...serviceDraftFor(undefined, SERVER_TIME), id: 'site', port: 2053, path: '', target: '127.0.0.1:3000', ...overrides };
}

describe('access capability gate', () => {
  it('unlocks only on the capability, never on the release string', () => {
    expect(supportsServiceAccess({ capabilities: [SERVICE_ACCESS_CAPABILITY] })).toBe(true);
    // A backported build with the capability works.
    expect(supportsServiceAccess({ version: '0.19.9', capabilities: [SERVICE_ACCESS_CAPABILITY] } as { capabilities?: readonly string[] })).toBe(true);
    // A 0.20.0 build without the capability stays legacy.
    expect(supportsServiceAccess({ version: '0.20.0', capabilities: [] } as { capabilities?: readonly string[] })).toBe(false);
    expect(supportsServiceAccess(undefined)).toBe(false);
    expect(supportsServiceAccess({})).toBe(false);
  });

  it('reads the real mode from the policy, not the legacy projection', () => {
    expect(getServiceAccessMode(service({ access: 'public', access_policy: policy({ mode: 'password' }) }))).toBe('password');
    expect(getServiceAccessMode(service({ access: 'public', access_policy: policy({ mode: 'private' }) }))).toBe('private');
    expect(getServiceAccessMode(service({ access: 'public' }))).toBe('public');
    expect(getServiceAccessMode(service({ access: 'private' }))).toBe('private');
  });
});

describe('service drafts', () => {
  it('starts a new external service private with a one-hour share', () => {
    expect(serviceDraftFor(undefined, SERVER_TIME)).toMatchObject({
      id: '',
      accessMode: 'private',
      expiration: '1h',
      password: '',
      passwordSet: false,
      hasPolicy: false,
      legacy: false,
      currentExpiresAt: null,
    });
  });

  it('keeps a legacy service legacy and never prefills a password', () => {
    const legacy = serviceDraftFor(service({ access: 'public' }), SERVER_TIME);
    expect(legacy).toMatchObject({ accessMode: 'public', expiration: 'none', legacy: true, hasPolicy: false, password: '', passwordSet: false });
    const managed = serviceDraftFor(service({ access: 'public', access_policy: policy({ mode: 'password', password_set: true }) }), SERVER_TIME);
    expect(managed).toMatchObject({ accessMode: 'password', expiration: 'keep', legacy: false, hasPolicy: true, password: '', passwordSet: true });
  });

  it('forces a new deadline on an expired share instead of extending it', () => {
    const expired = serviceDraftFor(service({ access: 'public', access_policy: policy({ mode: 'public', expires_at: SERVER_TIME - 60 }) }), SERVER_TIME);
    expect(expired.expiration).toBe('expired');
    expect(expired.currentExpiresAt).toBe(SERVER_TIME - 60);
    const sticky = serviceDraftFor(service({ access: 'public', access_policy: policy({ expired: true }) }), SERVER_TIME);
    expect(sticky.expiration).toBe('expired');
    const openEnded = serviceDraftFor(service({ access: 'public', access_policy: policy({ expires_at: null }) }), SERVER_TIME);
    expect(openEnded.expiration).toBe('none');
  });
});

describe('access policy payloads', () => {
  it('re-sends a stored policy on a plain edit and keeps the password', () => {
    const stored = service({ access: 'public', access_policy: policy({ mode: 'password', password_set: true }) });
    const prepared = prepareServiceDraft(
      { ...serviceDraftFor(stored, SERVER_TIME), name: 'Renamed' },
      context({ services: [stored] }),
    );
    expect(prepared.errors).toEqual({});
    expect(prepared.input?.access).toBe('public');
    expect(prepared.input?.access_policy).toEqual({ mode: 'password', expires_at: SERVER_TIME + 3600 });
    // The write-only password never travels back to the client.
    expect(prepared.input?.access_policy).not.toHaveProperty('password');
  });

  it('clears protection when the mode becomes private', () => {
    const stored = service({ access: 'public', access_policy: policy({ mode: 'password', password_set: true }) });
    const prepared = prepareServiceDraft(
      { ...serviceDraftFor(stored, SERVER_TIME), accessMode: 'private' },
      context({ services: [stored] }),
    );
    expect(prepared.errors).toEqual({});
    expect(prepared.input?.access).toBe('private');
    expect(prepared.input?.access_policy).toEqual({ mode: 'private' });
  });

  it('requires a password only when none is stored', () => {
    const fresh = serviceDraftFor(service({ access: 'public', access_policy: policy({ mode: 'password', password_set: false, expires_at: null }) }), SERVER_TIME);
    const missing = prepareServiceDraft(fresh, context());
    expect(missing.input).toBeUndefined();
    expect(missing.errors).toEqual({ password: 'passwordRequired' });
    const tooShort = prepareServiceDraft({ ...fresh, password: 'short' }, context());
    expect(tooShort.errors).toEqual({ password: 'passwordLength' });
    const tooLong = prepareServiceDraft({ ...fresh, password: 'x'.repeat(129) }, context());
    expect(tooLong.errors).toEqual({ password: 'passwordLength' });
    const typed = prepareServiceDraft({ ...fresh, password: 'correct horse battery staple' }, context());
    expect(typed.input?.access_policy).toEqual({ mode: 'password', expires_at: null, password: 'correct horse battery staple' });
    const full = prepareServiceDraft({ ...fresh, password: 'x'.repeat(128) }, context());
    expect(full.errors).toEqual({});
  });

  it('rejects past, unknown and out-of-range deadlines before sending', () => {
    const stored = serviceDraftFor(service({ access: 'public', access_policy: policy({ mode: 'public' }) }), SERVER_TIME);
    expect(prepareServiceDraft({ ...stored, expiration: 'expired' }, context()).errors).toEqual({ expiration: 'expirationRequired' });
    expect(prepareServiceDraft({ ...stored, expiration: 'keep' }, context({ serverTime: SERVER_TIME + 7200 })).errors).toEqual({ expiration: 'expirationPast' });
    expect(prepareServiceDraft({ ...stored, expiration: 'custom', customExpirationAmount: '0', customExpirationUnit: 'minutes' }, context()).errors).toEqual({ expiration: 'expirationRange' });
    expect(prepareServiceDraft({ ...stored, expiration: 'custom', customExpirationAmount: '527041', customExpirationUnit: 'minutes' }, context()).errors).toEqual({ expiration: 'expirationRange' });
    expect(prepareServiceDraft({ ...stored, expiration: 'custom', customExpirationAmount: 'abc', customExpirationUnit: 'days' }, context()).errors).toEqual({ expiration: 'expirationFormat' });
    expect(prepareServiceDraft({ ...stored, expiration: 'custom', customExpirationAmount: '527040', customExpirationUnit: 'minutes' }, context()).input?.access_policy)
      .toEqual({ mode: 'public', expires_at: SERVER_TIME + 366 * 86_400 });
    expect(prepareServiceDraft({ ...stored, expiration: 'none' }, context()).input?.access_policy).toEqual({ mode: 'public', expires_at: null });
    expect(prepareServiceDraft({ ...stored, expiration: '15m' }, context()).input?.access_policy).toEqual({ mode: 'public', expires_at: SERVER_TIME + 900 });
  });

  it('keeps a legacy service legacy through a plain edit', () => {
    const legacy = serviceDraftFor(service({ access: 'public' }), SERVER_TIME);
    const prepared = prepareServiceDraft({ ...legacy, name: 'Renamed', target: '127.0.0.1:3001' }, context({ services: [service()] }));
    expect(prepared.errors).toEqual({});
    expect(prepared.input).toEqual({
      name: 'Renamed', port: 8443, path: '/test/api', target: '127.0.0.1:3001', enabled: true, access: 'public', strip_prefix: true,
    });
    expect(prepared.input?.access_policy).toBeUndefined();
    // An unchanged legacy private service stays private too.
    expect(prepareServiceDraft(serviceDraftFor(service({ access: 'private' }), SERVER_TIME), context()).input?.access_policy).toBeUndefined();
  });

  it('mints a policy only for password or a non-legacy expiration', () => {
    const legacy = serviceDraftFor(service({ access: 'public' }), SERVER_TIME);
    expect(prepareServiceDraft({ ...legacy, expiration: '1h' }, context()).input?.access_policy).toEqual({ mode: 'public', expires_at: SERVER_TIME + 3600 });
    expect(prepareServiceDraft({ ...legacy, accessMode: 'password', expiration: '1h', password: 'correct horse battery staple' }, context()).input?.access_policy)
      .toEqual({ mode: 'password', expires_at: SERVER_TIME + 3600, password: 'correct horse battery staple' });
    // A new external service shares for an hour by default.
    const fresh = newDraft();
    expect(prepareServiceDraft(fresh, context()).input?.access_policy).toBeUndefined();
    expect(prepareServiceDraft({ ...fresh, accessMode: 'public' }, context()).input?.access_policy)
      .toEqual({ mode: 'public', expires_at: SERVER_TIME + 3600 });
    // Staying private never creates a policy.
    expect(prepareServiceDraft({ ...fresh, accessMode: 'private', expiration: '24h' }, context()).input?.access_policy).toBeUndefined();
  });

  it('never sends a policy to a connector without the capability', () => {
    const unsupported = { api: 2, servicePorts: SERVICE_PORTS, services: [], accessSupported: false, serverTime: SERVER_TIME } satisfies ServiceDraftContext;
    const legacy = prepareServiceDraft(serviceDraftFor(service({ access: 'public' }), SERVER_TIME), unsupported);
    expect(legacy.input?.access).toBe('public');
    expect(legacy.input?.access_policy).toBeUndefined();
    const fresh = newDraft();
    const created = prepareServiceDraft({ ...fresh, accessMode: 'public' }, unsupported);
    expect(created.input?.access).toBe('public');
    expect(created.input?.access_policy).toBeUndefined();
    const protectedService = prepareServiceDraft(serviceDraftFor(service({ access: 'public', access_policy: policy() }), SERVER_TIME), unsupported);
    expect(protectedService.input).toBeUndefined();
    expect(protectedService.errors).toEqual({ accessMode: 'accessUnsupported' });
    const password = prepareServiceDraft({ ...fresh, accessMode: 'password', password: 'correct horse battery staple' }, unsupported);
    expect(password.errors).toEqual({ accessMode: 'accessUnsupported' });
  });
});

describe('share links and connector clock', () => {
  it('appends the capability to a managed share and keeps bare links bare', () => {
    expect(buildServiceShareUrl('https://m-opaque.opencodecloud.link', service({ port: 2053, path: null })))
      .toBe('https://m-opaque.opencodecloud.link:2053/');
    expect(buildServiceShareUrl('https://m-opaque.opencodecloud.link', service({ port: 8443, path: '/test/api' })))
      .toBe('https://m-opaque.opencodecloud.link:8443/test/api/');
    expect(buildServiceShareUrl('https://m-opaque.opencodecloud.link', service({ port: 2053, path: null, access_policy: policy() })))
      .toBe('https://m-opaque.opencodecloud.link:2053/?cl_share=share-token');
    expect(buildServiceShareUrl('https://m-opaque.opencodecloud.link', service({ port: 8443, path: '/test/api', access_policy: policy({ mode: 'password', share_token: 'a b/c+d' }) })))
      .toBe('https://m-opaque.opencodecloud.link:8443/test/api/?cl_share=a%20b%2Fc%2Bd');
    // A private policy has nothing to share, so the clean link stays.
    expect(buildServiceShareUrl('https://m-opaque.opencodecloud.link', service({ access_policy: policy({ mode: 'private', share_token: null }) })))
      .toBe('https://m-opaque.opencodecloud.link:8443/test/api/');
    // An external share without a token must not silently fall back to a bare
    // link that nobody outside the pair can open.
    expect(() => buildServiceShareUrl('https://m-opaque.opencodecloud.link', service({ access_policy: policy({ share_token: null }) }))).toThrow();
  });

  it('counts down from the connector clock, not the phone clock', () => {
    // `serverTimeAt` is the local time (ms) the list arrived.
    expect(getServiceServerNow(SERVER_TIME, SERVER_TIME * 1000, SERVER_TIME * 1000)).toBe(SERVER_TIME);
    expect(getServiceServerNow(SERVER_TIME, SERVER_TIME * 1000, SERVER_TIME * 1000 + 90_000)).toBe(SERVER_TIME + 90);
    expect(getServiceServerNow(undefined, undefined, SERVER_TIME * 1000)).toBe(SERVER_TIME);
    expect(getServiceRemainingSeconds(policy(), SERVER_TIME)).toBe(3600);
    expect(getServiceRemainingSeconds(policy({ expires_at: SERVER_TIME - 30 }), SERVER_TIME)).toBe(0);
    expect(getServiceRemainingSeconds(policy({ expired: true }), SERVER_TIME)).toBe(0);
    expect(getServiceRemainingSeconds(policy({ expires_at: null }), SERVER_TIME)).toBeNull();
    expect(getServiceRemainingSeconds(undefined, SERVER_TIME)).toBeNull();
    expect(isServiceShareExpired(policy({ expires_at: SERVER_TIME }), SERVER_TIME)).toBe(true);
    expect(isServiceShareExpired(policy({ expires_at: SERVER_TIME + 1 }), SERVER_TIME)).toBe(false);
  });

  it('resolves presets, custom durations and the connector clock anchor', () => {
    expect(resolveServiceExpiration({ choice: 'none', serverTime: SERVER_TIME })).toEqual({ expiresAt: null });
    expect(resolveServiceExpiration({ choice: '1h', serverTime: SERVER_TIME })).toEqual({ expiresAt: SERVER_TIME + 3600 });
    expect(resolveServiceExpiration({ choice: '24h', serverTime: SERVER_TIME })).toEqual({ expiresAt: SERVER_TIME + 86_400 });
    expect(resolveServiceExpiration({ choice: 'keep', currentExpiresAt: SERVER_TIME + 600, serverTime: SERVER_TIME })).toEqual({ expiresAt: SERVER_TIME + 600 });
    expect(resolveServiceExpiration({ choice: 'keep', currentExpiresAt: null, serverTime: SERVER_TIME })).toEqual({ error: 'expirationRequired' });
    expect(resolveServiceExpiration({ choice: 'keep', currentExpiresAt: SERVER_TIME, serverTime: SERVER_TIME })).toEqual({ error: 'expirationPast' });
    expect(resolveServiceExpiration({ choice: 'custom', amount: '90', unit: 'minutes', serverTime: SERVER_TIME })).toEqual({ expiresAt: SERVER_TIME + 5400 });
    expect(resolveServiceExpiration({ choice: 'expired', serverTime: SERVER_TIME })).toEqual({ error: 'expirationRequired' });
  });

  it('formats remaining time compactly', () => {
    expect(formatServiceRemaining(45)).toBe('45s');
    expect(formatServiceRemaining(3599)).toBe('59m');
    expect(formatServiceRemaining(3600)).toBe('1h');
    expect(formatServiceRemaining(3900)).toBe('1h 5m');
    expect(formatServiceRemaining(86_400)).toBe('1d');
    expect(formatServiceRemaining(90_000)).toBe('1d 1h');
    expect(formatServiceRemaining(0)).toBe('0s');
  });
});

describe('draft validation integration', () => {
  it('reports access, expiration and password errors on their own fields', () => {
    const draft: ServiceDraft = newDraft({ accessMode: 'password' });
    const errors = prepareServiceDraft(draft, context());
    expect(errors.input).toBeUndefined();
    expect(errors.errors).toEqual({ password: 'passwordRequired' });
    expect(prepareServiceDraft({ ...draft, password: 'correct horse battery staple' }, context()).errors).toEqual({});
    expect(prepareServiceDraft({ ...draft, password: 'correct horse battery staple' }, context()).input?.access_policy)
      .toEqual({ mode: 'password', expires_at: SERVER_TIME + 3600, password: 'correct horse battery staple' });
  });
});
