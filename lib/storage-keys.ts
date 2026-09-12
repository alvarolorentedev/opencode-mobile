export const SETTINGS_STORAGE_KEY = 'opencode-mobile.settings';
export const CHAT_PREFERENCES_STORAGE_KEY = 'opencode-mobile.chat-preferences';
export const ACTIVE_PROJECT_STORAGE_KEY = 'opencode-mobile.active-project';
export const LAST_SESSION_BY_PROJECT_STORAGE_KEY = 'opencode-mobile.last-session-by-project';
export const PENDING_NOTIFICATION_SESSIONS_STORAGE_KEY = 'opencode-mobile.pending-notification-sessions';

// Per-project session list cache. Hydrated instantly on app open / project
// switch so the workspace chat list paints without waiting for the server.
// Refreshed in the background after connect; see providers/opencode-provider.tsx
// refreshSessions + providers/use-opencode-persistence.ts hydration.
export function sessionsCacheKey(projectPath: string) {
  return `opencode-mobile.sessions.${projectPath}`;
}

export function sessionStatusesCacheKey(projectPath: string) {
  return `opencode-mobile.session-statuses.${projectPath}`;
}
