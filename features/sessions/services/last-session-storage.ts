import { z } from 'zod';

// Remembered session map: connection scope -> project path -> session ID.
// Two servers exposing the same project path remember independent sessions.
export type LastSessionByConnection = Record<string, Record<string, string>>;

const LastSessionByConnectionSchema = z.record(z.string().min(1), z.record(z.string(), z.string()));

/**
 * Validates the persisted map. The legacy flat `{ projectPath: sessionId }`
 * shape had no way to say which server a session belonged to, so it fails here
 * and the caller removes the key instead of guessing.
 */
export function parseLastSessionByConnection(raw: string): LastSessionByConnection {
  const parsed = LastSessionByConnectionSchema.parse(JSON.parse(raw));
  return parsed;
}

export function serializeLastSessionByConnection(value: LastSessionByConnection): string {
  return JSON.stringify(value);
}
