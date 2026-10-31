import { z } from 'zod';

import { ACTIVE_PROJECT_STORAGE_KEY, CONNECTION_PROFILES_STORAGE_KEY, ONBOARDING_VERSION_STORAGE_KEY, SETTINGS_STORAGE_KEY } from '@/shared/storage/keys';
import type { PersistenceStorage } from '@/shared/storage/persistence-hydration';

// Bump this when the first-run setup flow changes in a way that should re-run
// for users who have not completed the current flow.
//
// This value represents completion ONLY. Connection settings stay in
// `opencode-mobile.settings`, passwords in SecureStore, the active project in
// `opencode-mobile.active-project`, chat preferences in
// `opencode-mobile.chat-preferences`, and notification/microphone state in the
// OS. The assistant must never mirror those values here.
export const CURRENT_ONBOARDING_VERSION = 1;

// 0 means "onboarding started but not completed". Version 1 means completed.
export const ONBOARDING_VERSION_IN_PROGRESS = 0;

/**
 * Parses the persisted onboarding record. Throws on malformed input so the
 * caller can remove the key and fall back to the migration decision, matching
 * the repo-wide fail-safe persistence convention.
 *
 * Both a bare number and a `{ version }` envelope are accepted so the marker
 * can gain fields later without breaking older clients.
 */
const OnboardingVersionSchema = z.union([
  z.number().finite().nonnegative(),
  z.object({ version: z.number().finite().nonnegative() }),
]).transform((value) => Math.floor(typeof value === 'number' ? value : value.version));

export function parseOnboardingVersion(raw: string): number {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Malformed onboarding version.');
  }

  const result = OnboardingVersionSchema.safeParse(parsed);
  if (!result.success) throw new Error('Invalid onboarding version.');
  return result.data;
}

export function serializeOnboardingVersion(version: number) {
  return JSON.stringify({ version });
}

export function isOnboardingComplete(version: number | undefined) {
  return typeof version === 'number' && version >= CURRENT_ONBOARDING_VERSION;
}

type ExistingConfiguration = {
  hasStoredSettings: boolean;
  hasStoredProfiles: boolean;
  hasActiveProject: boolean;
};

export function hasExistingConfiguration({ hasStoredSettings, hasStoredProfiles, hasActiveProject }: ExistingConfiguration) {
  return hasStoredSettings || hasStoredProfiles || hasActiveProject;
}

type ResolvedOnboardingStatus = {
  completed: boolean;
  version: number;
};

/**
 * Pure one-time migration decision.
 *
 * When no version marker exists yet:
 * - an installation that already has any configuration is treated as completed,
 *   so upgrading users never see the assistant;
 * - a fresh installation starts the assistant.
 *
 * The resolved marker is written back once persistence has hydrated (see
 * `use-opencode-persistence.ts`), which makes the decision sticky even after the
 * settings write effect later creates `opencode-mobile.settings`.
 */
export function resolveOnboardingStatus(
  storedVersion: number | undefined,
  existing: ExistingConfiguration,
): ResolvedOnboardingStatus {
  if (typeof storedVersion === 'number') {
    return { completed: isOnboardingComplete(storedVersion), version: storedVersion };
  }

  const completed = hasExistingConfiguration(existing);
  return {
    completed,
    version: completed ? CURRENT_ONBOARDING_VERSION : ONBOARDING_VERSION_IN_PROGRESS,
  };
}

async function readVersion(storage: PersistenceStorage): Promise<{ storedVersion?: number; readFailed: boolean }> {
  let raw: string | null;
  try {
    raw = await storage.getItem(ONBOARDING_VERSION_STORAGE_KEY);
  } catch {
    return { readFailed: true };
  }

  if (raw === null) {
    return { readFailed: false };
  }

  try {
    return { storedVersion: parseOnboardingVersion(raw), readFailed: false };
  } catch {
    await storage.removeItem(ONBOARDING_VERSION_STORAGE_KEY).catch(() => undefined);
    return { readFailed: false };
  }
}

// `true` means the key exists, `false` means it is absent, and `undefined`
// marks a read failure that must not be interpreted as "absent".
async function readKeyPresence(storage: PersistenceStorage, key: string): Promise<boolean | undefined> {
  try {
    return (await storage.getItem(key)) !== null;
  } catch {
    return undefined;
  }
}

/**
 * Resolves completion for boot. Storage failures never onboard an existing
 * user: they report completed, so a transient failure cannot gate the app.
 */
export async function loadOnboardingStatus(storage: PersistenceStorage): Promise<ResolvedOnboardingStatus> {
  const versionRead = await readVersion(storage);
  if (versionRead.readFailed) {
    return { completed: true, version: CURRENT_ONBOARDING_VERSION };
  }

  if (versionRead.storedVersion !== undefined) {
    return resolveOnboardingStatus(versionRead.storedVersion, {
      hasStoredSettings: false,
      hasStoredProfiles: false,
      hasActiveProject: false,
    });
  }

  const [hasStoredSettings, hasStoredProfiles, hasActiveProject] = await Promise.all([
    readKeyPresence(storage, SETTINGS_STORAGE_KEY),
    readKeyPresence(storage, CONNECTION_PROFILES_STORAGE_KEY),
    readKeyPresence(storage, ACTIVE_PROJECT_STORAGE_KEY),
  ]);

  if (hasStoredSettings === undefined || hasStoredProfiles === undefined || hasActiveProject === undefined) {
    return { completed: true, version: CURRENT_ONBOARDING_VERSION };
  }

  return resolveOnboardingStatus(undefined, { hasStoredSettings, hasStoredProfiles, hasActiveProject });
}
