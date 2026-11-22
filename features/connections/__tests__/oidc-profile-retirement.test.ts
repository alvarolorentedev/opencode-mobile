// @vitest-environment happy-dom

import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { ConnectionProfile } from '@/shared/contracts/connection-profiles';
import { renderHook } from '../../../tests/helpers/render-hook';

async function profiles() {
  const profile = { id: 'victim', name: 'OIDC', serverUrl: 'https://server.test', username: '', oidc: { issuer: 'https://idp.test', clientId: 'app', scopes: 'openid', tokenHeader: 'X-Token' } };
  let stored = [profile];
  const passwords = new Map([[profile.id, 'previous-password']]);
  const saveHeaders = vi.fn(async () => {});
  const signOut = vi.fn(async () => {}), deletePassword = vi.fn(async () => {});
  vi.resetModules();
  vi.doMock('@/shared/storage/connection-profiles', () => ({
    loadConnectionProfiles: async () => stored, createProfileId: () => 'new',
    mutateConnectionProfiles: async (operation: (previous: ConnectionProfile[], save: (next: typeof stored) => Promise<void>) => Promise<unknown>) =>
      operation(stored, async (next) => { stored = next; }),
    getProfilePassword: async (id: string) => passwords.get(id) ?? '',
    saveProfilePassword: async (id: string, value: string) => { passwords.set(id, value); },
    deleteProfilePassword: deletePassword,
  }));
  vi.doMock('@/shared/storage/connection-headers', () => ({ getProfileHeaders: async () => ({}), saveProfileHeaders: saveHeaders, deleteProfileHeaders: async () => {} }));
  vi.doMock('@/shared/storage/connection-certificates', () => ({ getProfileCertificate: async () => undefined, saveProfileCertificate: async () => {}, deleteProfileCertificate: async () => {} }));
  vi.doMock('@/shared/platform/tls-trust', () => ({ connectionOrigin: () => undefined, releaseHostTrust: async () => {} }));
  vi.doMock('@/shared/protocol/opencode/client/probe', () => ({}));
  vi.doMock('@/shared/protocol/opencode/pairing', () => ({}));
  vi.doMock('@/shared/auth/oidc/session', () => ({ signOutOidc: signOut }));
  vi.doMock('react-native', () => ({ Platform: { OS: 'web' } }));
  vi.doMock('expo-constants', () => ({ default: { expoConfig: { extra: {} } } }));
  const { useConnectionProfiles } = await import('@/features/connections/state/use-connection-profiles');
  const input: Parameters<typeof useConnectionProfiles>[0] = {
    settings: { serverUrl: 'https://active.test', username: '', password: '', directory: '' },
    profiles: stored, setProfiles: vi.fn(), clearCapabilitiesSnapshots: async () => {},
    switchConnection: vi.fn(), updateSettings: vi.fn(),
  };
  const driver = renderHook(useConnectionProfiles, input);
  await act(async () => {});
  return { driver, profile, signOut, deletePassword, saveHeaders, passwords, stored: () => stored };
}

describe('OIDC profile retirement', () => {
  it('retires the session before later credential cleanup can fail', async () => {
    const view = await profiles(); view.deletePassword.mockRejectedValueOnce(new Error('SecureStore unavailable'));
    await expect(view.driver.result.current.remove('victim')).rejects.toThrow('SecureStore unavailable');
    expect(view.signOut).toHaveBeenCalledExactlyOnceWith(view.profile, view.profile.oidc);
    expect(view.signOut.mock.invocationCallOrder[0]).toBeLessThan(view.deletePassword.mock.invocationCallOrder[0]);
  });
  it('keeps metadata available for retry when encrypted-session deletion fails', async () => {
    const view = await profiles(); view.signOut.mockRejectedValueOnce(new Error('Encrypted storage unavailable'));
    await expect(view.driver.result.current.remove('victim')).rejects.toThrow('Encrypted storage unavailable');
    expect(view.stored()).toEqual([view.profile]); expect(view.deletePassword).not.toHaveBeenCalled();
    await view.driver.result.current.remove('victim'); expect(view.stored()).toEqual([]);
  });
  it('retires the old session when a profile changes server scope', async () => {
    const view = await profiles();
    await view.driver.result.current.save({ ...view.profile, serverUrl: 'https://replacement.test', password: '', headers: {} }, 'victim');
    expect(view.signOut).toHaveBeenCalledExactlyOnceWith({ serverUrl: view.profile.serverUrl, username: '' }, view.profile.oidc);
  });
  it('keeps the previous profile and its credentials when a later write fails', async () => {
    const view = await profiles();
    view.saveHeaders.mockRejectedValueOnce(new Error('SecureStore unavailable'));
    await expect(view.driver.result.current.save({ ...view.profile, serverUrl: 'https://replacement.test', password: 'new-password', headers: { 'X-Token': 'new' } }, 'victim')).rejects.toThrow('SecureStore unavailable');
    expect(view.stored()).toEqual([view.profile]);
    expect(view.passwords.get('victim')).toBe('previous-password');
    expect(view.signOut).not.toHaveBeenCalled();
  });

});
