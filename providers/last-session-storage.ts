// Remembered session map: connection scope -> project path -> session ID.
// Two servers exposing the same project path remember independent sessions.
export type LastSessionByConnection = Record<string, Record<string, string>>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Validates the persisted map. The legacy flat `{ projectPath: sessionId }`
 * shape had no way to say which server a session belonged to, so it fails here
 * and the caller removes the key instead of guessing.
 */
export function parseLastSessionByConnection(raw: string): LastSessionByConnection {
  const value: unknown = JSON.parse(raw);
  if (!isRecord(value)) {
    throw new Error('Expected a last-session map.');
  }

  const parsed: LastSessionByConnection = {};
  for (const [connectionScope, byProject] of Object.entries(value)) {
    if (!connectionScope || !isRecord(byProject)) {
      throw new Error('Expected last-session entries to be nested by connection scope.');
    }
    const projects: Record<string, string> = {};
    for (const [projectPath, sessionId] of Object.entries(byProject)) {
      if (typeof sessionId !== 'string') {
        throw new Error('Expected session IDs to be strings.');
      }
      projects[projectPath] = sessionId;
    }
    parsed[connectionScope] = projects;
  }
  return parsed;
}

export function serializeLastSessionByConnection(value: LastSessionByConnection): string {
  return JSON.stringify(value);
}
