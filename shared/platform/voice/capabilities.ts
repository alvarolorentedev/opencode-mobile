import { getVoiceInputPermissionAsync, type VoiceInputPermission } from '@/shared/platform/voice/permissions';
import { readVoiceCapabilityFlags } from '@/shared/platform/voice/voice-capability-read';

export type VoiceCapabilities = {
  permission: VoiceInputPermission;
  recognitionAvailable: boolean;
  onDeviceSupported: boolean;
};

/**
 * Read-only snapshot of the device's voice-input capabilities, used by the
 * onboarding step and the Settings voice check. Never prompts.
 */
export async function getVoiceCapabilitiesAsync(): Promise<VoiceCapabilities> {
  const permission = await getVoiceInputPermissionAsync();
  return { permission, ...readVoiceCapabilityFlags() };
}
