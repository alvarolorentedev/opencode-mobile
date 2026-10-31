import { describe, expect, it } from 'vitest';

import type { ConnectionProfile } from '@/shared/contracts/connection-profiles';
import { buildServiceMachines, chooseServiceTarget } from '@/features/cloud-link/model/services-target';

function connect(machineId: string) {
  return {
    controlPlaneUrl: 'https://api.opencodecloud.link',
    machineId,
    machineName: `Machine ${machineId}`,
    deviceId: `device-${machineId}`,
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  };
}

function machine(id: string): ConnectionProfile {
  return { id, name: `Name ${id}`, serverUrl: `https://${id}.opencodecloud.link`, username: `device-${id}`, connect: connect(id) };
}

const manual: ConnectionProfile = { id: 'manual', name: 'Office', serverUrl: 'http://127.0.0.1:4096', username: '' };

describe('services target resolution', () => {
  it('keeps the active Cloud Link connection as the target', () => {
    const profiles = [machine('a'), machine('b')];
    expect(chooseServiceTarget({ profiles, active: true, activeMachineId: 'a' })).toEqual({ kind: 'active' });
  });

  it('switches to another saved machine when one is selected', () => {
    const profiles = [machine('a'), machine('b')];
    expect(chooseServiceTarget({ profiles, active: true, activeMachineId: 'a', selectedProfileId: 'b' }))
      .toEqual({ kind: 'profile', profile: profiles[1] });
  });

  it('keeps the active connection when the selected profile is its own machine', () => {
    const profiles = [machine('a'), machine('b')];
    expect(chooseServiceTarget({ profiles, active: true, activeMachineId: 'a', selectedProfileId: 'a' }))
      .toEqual({ kind: 'active' });
  });

  it('targets the last-used saved machine for a manual active connection', () => {
    const profiles = [manual, machine('a'), machine('b')];
    expect(chooseServiceTarget({ profiles, active: false, preferredProfileId: 'b' }))
      .toEqual({ kind: 'profile', profile: profiles[2] });
  });

  it('prefers an explicit selection over the last-used machine', () => {
    const profiles = [machine('a'), machine('b')];
    expect(chooseServiceTarget({ profiles, active: false, selectedProfileId: 'a', preferredProfileId: 'b' }))
      .toEqual({ kind: 'profile', profile: profiles[0] });
  });

  it('falls back to the only saved machine without a preference', () => {
    const profiles = [manual, machine('a')];
    expect(chooseServiceTarget({ profiles, active: false })).toEqual({ kind: 'profile', profile: profiles[1] });
  });

  it('reports nothing to manage without a saved Cloud Link machine', () => {
    expect(chooseServiceTarget({ profiles: [manual], active: false })).toEqual({ kind: 'none' });
    expect(chooseServiceTarget({ profiles: [], active: false })).toEqual({ kind: 'none' });
  });

  it('ignores machines from the other subscription environment', () => {
    const staging = { ...machine('s'), connect: { ...connect('s'), controlPlaneUrl: 'https://apistaging.opencodecloud.link' } };
    const profiles = [machine('a'), staging];
    const production = 'https://api.opencodecloud.link';
    expect(chooseServiceTarget({ profiles, controlPlaneUrl: production, active: false }))
      .toEqual({ kind: 'profile', profile: profiles[0] });
    expect(chooseServiceTarget({ profiles, controlPlaneUrl: production, active: false, selectedProfileId: 's' }))
      .toEqual({ kind: 'profile', profile: profiles[0] });
    expect(buildServiceMachines(profiles, undefined, production)).toEqual([{ id: 'a', name: 'Machine a', isActive: false }]);
    expect(chooseServiceTarget({ profiles: [staging], controlPlaneUrl: production, active: false })).toEqual({ kind: 'none' });
  });

  it('lists saved machines with the active one marked and connect names preferred', () => {
    const renamed = { ...machine('a'), name: 'Renamed' };
    expect(buildServiceMachines([manual, renamed, machine('b')], 'b')).toEqual([
      { id: 'a', name: 'Machine a', isActive: false },
      { id: 'b', name: 'Machine b', isActive: true },
    ]);
  });
});
