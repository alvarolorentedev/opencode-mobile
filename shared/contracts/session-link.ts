// Canonical deep link for one OpenCode session. The payload is non-secret and
// matches what features/sessions/ui/session-link-screen.tsx consumes (session id, optional project path
// and connection scope), so notifications, quick actions, and home widgets all
// reopen a session through the same resolver.
export type SessionLinkInput = {
  sessionId: string;
  projectPath: string;
  connectionScope: string;
};

export function buildSessionLink(input: SessionLinkInput, scheme = 'opencodemobile') {
  if (!/^[a-z][a-z0-9+.-]*$/i.test(scheme)) throw new Error('Invalid app URL scheme.');
  const sessionId = encodeURIComponent(input.sessionId);
  const projectPath = encodeURIComponent(input.projectPath);
  const connectionScope = encodeURIComponent(input.connectionScope);
  return `${scheme}://session/${sessionId}?project=${projectPath}&connectionScope=${connectionScope}`;
}
