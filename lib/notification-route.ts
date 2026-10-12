// Parses the non-secret routing payload carried by local completion and
// attention notifications. Keeping it pure lets the routing host stay a thin
// adapter over the existing session deep-link resolver.
export type NotificationRoute = {
  sessionId: string;
  projectPath?: string;
  connectionScope?: string;
};

export function parseNotificationRoute(data: unknown): NotificationRoute | undefined {
  if (typeof data !== 'object' || data === null) return undefined;
  const { sessionId, projectPath, connectionScope } = data as Record<string, unknown>;
  if (typeof sessionId !== 'string' || !sessionId.trim()) return undefined;
  return {
    sessionId: sessionId.trim(),
    ...(typeof projectPath === 'string' && projectPath.trim() ? { projectPath: projectPath.trim() } : {}),
    ...(typeof connectionScope === 'string' && connectionScope.trim() ? { connectionScope: connectionScope.trim() } : {}),
  };
}
