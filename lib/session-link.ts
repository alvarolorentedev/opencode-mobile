// Canonical deep link for one OpenCode session. The payload is non-secret and
// matches what app/session/[id].tsx consumes (session id, optional project path
// and connection scope), so notifications, quick actions, and home widgets all
// reopen a session through the same resolver.
export type SessionLinkInput = {
  sessionId: string;
  projectPath: string;
  connectionScope: string;
};

export function buildSessionLink(input: SessionLinkInput) {
  const sessionId = encodeURIComponent(input.sessionId);
  const projectPath = encodeURIComponent(input.projectPath);
  const connectionScope = encodeURIComponent(input.connectionScope);
  return `opencodemobile://session/${sessionId}?project=${projectPath}&connectionScope=${connectionScope}`;
}
