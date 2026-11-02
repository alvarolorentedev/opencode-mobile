import { describe, expect, it, vi } from 'vitest';
import { hookRuntime, loadTs } from '../../../tests/helpers/runtime.mjs';

async function profiles() {
  const driver = hookRuntime();
  const profile = { id: 'victim', name: 'OIDC', serverUrl: 'https://server.test', username: '', oidc: { issuer: 'https://idp.test', clientId: 'app', scopes: 'openid', tokenHeader: 'X-Token' } };
  let stored = [profile];
  const signOut = vi.fn(async () => {}), deletePassword = vi.fn(async () => {});
  const { useConnectionProfiles } = await loadTs('features/connections/state/use-connection-profiles.ts', {
    react: driver.react,
    '@/shared/storage/connection-profiles': {
      loadConnectionProfiles: async () => stored, createProfileId: () => 'new',
      mutateConnectionProfiles: async (operation: any) => operation(stored, async (next: any) => { stored = next; }),
      getProfilePassword: async () => '', saveProfilePassword: async () => {}, deleteProfilePassword: deletePassword,
    },
    '@/shared/storage/connection-headers': { getProfileHeaders: async () => ({}), saveProfileHeaders: async () => {}, deleteProfileHeaders: async () => {} },
    '@/shared/storage/connection-certificates': { getProfileCertificate: async () => undefined, saveProfileCertificate: async () => {}, deleteProfileCertificate: async () => {} },
    '@/shared/platform/tls-trust': { connectionOrigin: () => undefined, releaseHostTrust: async () => {} },
    '@/shared/contracts/connection-profiles': { findMatchingProfile: () => undefined },
    '@/shared/contracts/connection-scope': { getConnectionScope: (value: any) => `${value.serverUrl}:${value.username}` },
    '@/shared/contracts/server-url': { normalizeServerUrl: () => ({ valid: true }), getServerHostname: () => 'server.test' },
    '@/shared/protocol/opencode/client/probe': {}, '@/shared/protocol/opencode/pairing': {},
    '@/shared/auth/oidc/session': { signOutOidc: signOut },
  }, driver.globals);
  driver.mount(() => useConnectionProfiles({ settings: { serverUrl: 'https://active.test', username: '' }, profiles: stored, setProfiles: vi.fn(), clearCapabilitiesSnapshots: async () => {} }), {});
  await driver.settle();
  return { driver, profile, signOut, deletePassword, stored: () => stored };
}

describe('OIDC profile retirement', () => {
  it('retires the session before later credential cleanup can fail', async () => {
    const view = await profiles(); view.deletePassword.mockRejectedValueOnce(new Error('SecureStore unavailable'));
    await expect(view.driver.value.remove('victim')).rejects.toThrow('SecureStore unavailable');
    expect(view.signOut).toHaveBeenCalledExactlyOnceWith(view.profile, view.profile.oidc);
    expect(view.signOut.mock.invocationCallOrder[0]).toBeLessThan(view.deletePassword.mock.invocationCallOrder[0]);
  });
  it('keeps metadata available for retry when encrypted-session deletion fails', async () => {
    const view = await profiles(); view.signOut.mockRejectedValueOnce(new Error('Encrypted storage unavailable'));
    await expect(view.driver.value.remove('victim')).rejects.toThrow('Encrypted storage unavailable');
    expect(view.stored()).toEqual([view.profile]); expect(view.deletePassword).not.toHaveBeenCalled();
    await view.driver.value.remove('victim'); expect(view.stored()).toEqual([]);
  });
  it('retires the old session when a profile changes server scope', async () => {
    const view = await profiles();
    await view.driver.value.save({ ...view.profile, serverUrl: 'https://replacement.test', password: '', headers: {} }, 'victim');
    expect(view.signOut).toHaveBeenCalledExactlyOnceWith({ serverUrl: view.profile.serverUrl, username: '' }, view.profile.oidc);
  });
});
