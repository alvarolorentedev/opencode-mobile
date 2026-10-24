export const SETTINGS_STORAGE_KEY = 'opencode-mobile.settings';
export const APP_UPDATES_STORAGE_KEY = 'opencode-mobile.app-updates';
export const CONNECT_CONTROL_PLANE_STORAGE_KEY = 'opencode-mobile.connect-control-plane';
export const CONNECTION_PROFILES_STORAGE_KEY = 'opencode-mobile.connection-profiles';
export const CHAT_PREFERENCES_STORAGE_KEY = 'opencode-mobile.chat-preferences';
export const ACTIVE_PROJECT_STORAGE_KEY = 'opencode-mobile.active-project';
// Completion-only first-run setup marker. It never stores connection,
// project, preference, or permission values; those stay in their existing
// stores. A value below CURRENT_ONBOARDING_VERSION means the assistant should
// run; version 0 marks "started but not completed" so a relaunch is not
// mistaken for a pre-onboarding upgrade. See providers/onboarding-state.ts.
export const ONBOARDING_VERSION_STORAGE_KEY = 'opencode-mobile.onboarding-version';
export const LAST_SESSION_BY_PROJECT_STORAGE_KEY = 'opencode-mobile.last-session-by-project';
export const PENDING_NOTIFICATION_SESSIONS_STORAGE_KEY = 'opencode-mobile.pending-notification-sessions';
export const FAVORITE_SESSIONS_STORAGE_KEY = 'opencode-mobile.favorite-sessions';
// Opened projects per connection scope (most-recent-first directory paths).
// Mirrors the desktop Home list: the picker shows projects the user opened on
// this device, while `project.list()` only enriches them. See
// providers/projects-storage.ts.
export const PROJECTS_STORAGE_KEY = 'opencode-mobile.projects';
// Bounded, non-secret task snapshot for the Android home widget. The widget
// handler runs headless without provider state, so the app writes this on
// confirmed provider changes and the handler renders from it. See
// providers/widget-snapshot.ts.
export const WIDGET_SNAPSHOT_STORAGE_KEY = 'opencode-mobile.widget-snapshot';
// Per-day network usage diagnostic (requests + bytes). See
// lib/opencode/data-usage.ts.
export const DATA_USAGE_STORAGE_KEY = 'opencode-mobile.data-usage';

// Diagnostic file written synchronously by the global JS error handler; it
// cannot use AsyncStorage because the process may die before a write flushes.
export const LAST_JS_ERROR_FILENAME = 'opencode-mobile.last-js-error.json';

// Server-derived persisted state is always scoped by connection AND project.
// The connection scope is the password-free identity from
// lib/connection-scope.ts; project paths are server-local, so two servers
// exposing the same path must never share cache entries.
//
// Per-project session list cache. Hydrated on app open and on every project
// switch so the project chat list paints without waiting for the server;
// rewritten only from confirmed fetch results in
// providers/use-project-refresh-actions.ts refreshSessions. See providers/session-cache.ts.
export function sessionsCacheKey(connectionScope: string, projectPath: string) {
  return `opencode-mobile.sessions.${connectionScope}.${projectPath}`;
}

export function sessionStatusesCacheKey(connectionScope: string, projectPath: string) {
  return `opencode-mobile.session-statuses.${connectionScope}.${projectPath}`;
}

// Bounded transcript tail used to paint a chat during a cold start on a slow
// link. It is server-derived, connection- and project-scoped, and expires with
// the same policy as the session list cache.
export function transcriptCacheKey(connectionScope: string, projectPath: string, sessionId: string) {
  return `opencode-mobile.transcript.${connectionScope}.${projectPath}.${sessionId}`;
}

// Last-known model/provider/agent catalog so an offline cold start can still
// render the composer and queue a prompt. It contains no credentials.
export function capabilitiesCacheKey(connectionScope: string, projectPath: string) {
  return `opencode-mobile.capabilities.${connectionScope}.${projectPath}`;
}
