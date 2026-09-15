export const SETTINGS_STORAGE_KEY = 'opencode-mobile.settings';
export const CHAT_PREFERENCES_STORAGE_KEY = 'opencode-mobile.chat-preferences';
export const ACTIVE_PROJECT_STORAGE_KEY = 'opencode-mobile.active-project';
export const LAST_SESSION_BY_PROJECT_STORAGE_KEY = 'opencode-mobile.last-session-by-project';
export const PENDING_NOTIFICATION_SESSIONS_STORAGE_KEY = 'opencode-mobile.pending-notification-sessions';

// Per-project session list cache. Hydrated on app open and on every project
// switch so the workspace chat list paints without waiting for the server;
// rewritten only from confirmed fetch results in
// providers/opencode-provider.tsx fetchSessions. See providers/session-cache.ts.
export function sessionsCacheKey(projectPath: string) {
  return `opencode-mobile.sessions.${projectPath}`;
}

export function sessionStatusesCacheKey(projectPath: string) {
  return `opencode-mobile.session-statuses.${projectPath}`;
}
