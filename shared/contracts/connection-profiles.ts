import { z } from 'zod';

import { parseConnectMetadata, type ConnectMetadata } from '@/shared/contracts/cloud-link';

import { getConnectionScope, type ConnectionIdentity } from '@/shared/contracts/connection-scope';

import { normalizeAutoModelPreferences } from '@/shared/preferences/auto-model';

import type { ChatPreferences } from '@/shared/preferences/opencode-preferences';

import { stripServerUrlCredentials } from '@/shared/contracts/server-url';

// Saved connection metadata is non-secret and lives in AsyncStorage. Passwords
// are stored per profile in SecureStore and are never part of this model.
type ProfileModelPreferences = Pick<
  ChatPreferences,
  'providerId' | 'modelId' | 'enabledModelIds' | 'providerModelSelections' | 'modelVariantSelections'
  | 'recentModelIds' | 'mode' | 'autoApprove' | 'autoModel'
>;

export type ConnectionProfile = {
  id: string;
  name: string;
  serverUrl: string;
  username: string;
  connect?: ConnectMetadata;
  // Partial because older writes may not carry every field; unknown fields are
  // ignored and each present field is validated before it is applied.
  modelPreferences?: Partial<ProfileModelPreferences>;
};

export function pickModelPreferences(preferences: ChatPreferences): ProfileModelPreferences {
  return {
    providerId: preferences.providerId,
    modelId: preferences.modelId,
    enabledModelIds: [...preferences.enabledModelIds],
    providerModelSelections: { ...preferences.providerModelSelections },
    modelVariantSelections: { ...preferences.modelVariantSelections },
    recentModelIds: [...preferences.recentModelIds],
    mode: preferences.mode,
    autoApprove: preferences.autoApprove,
    autoModel: {
      ...preferences.autoModel,
      tiers: { ...preferences.autoModel.tiers },
    },
  };
}

const ProfileModelPreferencesSchema = z.object({
  providerId: z.string().optional(),
  modelId: z.string().optional(),
  enabledModelIds: z.array(z.string()).nullish().transform((value) => value ?? undefined),
  providerModelSelections: z.record(z.string(), z.string()).nullish().transform((value) => value ?? undefined),
  modelVariantSelections: z.record(z.string(), z.union([z.string(), z.null()])).nullish().transform((value) => value ?? undefined),
  recentModelIds: z.array(z.string()).nullish().transform((value) => value ?? undefined),
  mode: z.string().optional(),
  autoApprove: z.boolean().optional(),
  autoModel: z.unknown().optional().transform((value) => (
    value === undefined ? undefined : normalizeAutoModelPreferences(value)
  )),
});

const ConnectionProfileSchema = z.object({
  id: z.string().refine((value) => value.trim().length > 0),
  name: z.string().refine((value) => value.trim().length > 0),
  serverUrl: z.string().refine((value) => value.trim().length > 0),
  username: z.string(),
  connect: z.unknown().optional(),
  modelPreferences: ProfileModelPreferencesSchema.nullish().transform((value) => value ?? undefined),
});

// Validates the whole persisted DTO, including model preferences. Unknown
// fields are ignored; an entry with any malformed known field is dropped so a
// corrupt value can never hydrate a partial profile.
export function toConnectionProfile(value: unknown): ConnectionProfile | undefined {
  const parsed = ConnectionProfileSchema.safeParse(value);
  if (!parsed.success) return undefined;

  const { id, name, serverUrl, username, modelPreferences, connect } = parsed.data;
  const trimmedUsername = username.trim();
  const parsedConnect = connect === undefined ? undefined : parseConnectMetadata(connect);
  if (connect !== undefined && (!parsedConnect || parsedConnect.deviceId !== trimmedUsername)) return undefined;

  const parsedPreferences = modelPreferences && Object.keys(modelPreferences).length > 0
    ? modelPreferences as Partial<ProfileModelPreferences>
    : undefined;

  return {
    id: id.trim(),
    name: name.trim(),
    serverUrl: stripServerUrlCredentials(serverUrl),
    username: trimmedUsername,
    ...(parsedConnect ? { connect: parsedConnect } : {}),
    ...(parsedPreferences ? { modelPreferences: parsedPreferences } : {}),
  };
}

export function findProfileByConnectionScope(profiles: ConnectionProfile[], connectionScope: string) {
  return profiles.find((profile) => getConnectionScope(profile) === connectionScope);
}

export function findMatchingProfile(profiles: ConnectionProfile[], identity: ConnectionIdentity & { connect?: ConnectMetadata }) {
  if (identity.connect) {
    return profiles.find((profile) => profile.connect?.controlPlaneUrl === identity.connect!.controlPlaneUrl
      && profile.connect.machineId === identity.connect!.machineId);
  }
  return findProfileByConnectionScope(profiles, getConnectionScope(identity));
}
