import type { ConnectionProfile } from '@/lib/connection-profiles';
import type { ServiceManagementMachine } from '@/providers/opencode-provider-types';

// Pure target resolution for the Cloud Link services surface. Services belong
// to one Cloud Link machine; managing them never requires that machine to be
// the active connection, because the connector's management API is
// device-authenticated on the machine's own origin. Only machines of the
// resolved subscription environment are candidates: a subscription never grants
// access to the other environment's machines.
function machinesOf(profiles: ConnectionProfile[], controlPlaneUrl?: string) {
  return profiles.filter((profile) => profile.connect && (!controlPlaneUrl || profile.connect.controlPlaneUrl === controlPlaneUrl));
}

export function buildServiceMachines(profiles: ConnectionProfile[], activeMachineId?: string, controlPlaneUrl?: string): ServiceManagementMachine[] {
  return machinesOf(profiles, controlPlaneUrl).map((profile) => ({
    id: profile.id,
    name: profile.connect!.machineName.trim() || profile.name,
    isActive: Boolean(activeMachineId && profile.connect!.machineId === activeMachineId),
  }));
}

export type ServiceTargetChoice =
  | { kind: 'none' }
  | { kind: 'active' }
  | { kind: 'profile'; profile: ConnectionProfile };

// Resolution order:
// 1. An active Cloud Link connection is the target unless another saved machine
//    was explicitly selected.
// 2. Otherwise the selected saved machine, then the last-used one, then the
//    only/first saved machine.
// 3. No saved Cloud Link machine means there is nothing to manage.
export function chooseServiceTarget({ profiles, controlPlaneUrl, active, activeMachineId, selectedProfileId, preferredProfileId }: {
  profiles: ConnectionProfile[];
  controlPlaneUrl?: string;
  active: boolean;
  activeMachineId?: string;
  selectedProfileId?: string;
  preferredProfileId?: string;
}): ServiceTargetChoice {
  const candidates = machinesOf(profiles, controlPlaneUrl);
  if (active) {
    const selected = selectedProfileId ? candidates.find((profile) => profile.id === selectedProfileId) : undefined;
    if (selected && (!activeMachineId || selected.connect!.machineId !== activeMachineId)) {
      return { kind: 'profile', profile: selected };
    }
    return { kind: 'active' };
  }
  if (candidates.length === 0) return { kind: 'none' };
  const profile = candidates.find((entry) => entry.id === selectedProfileId)
    ?? candidates.find((entry) => entry.id === preferredProfileId)
    ?? candidates[0];
  return { kind: 'profile', profile };
}
