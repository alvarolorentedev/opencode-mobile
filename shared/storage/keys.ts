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
// mistaken for a pre-onboarding upgrade. See features/onboarding/model/onboarding-state.ts.
export const ONBOARDING_VERSION_STORAGE_KEY = 'opencode-mobile.onboarding-version';
export const PENDING_NOTIFICATION_SESSIONS_STORAGE_KEY = 'opencode-mobile.pending-notification-sessions';
export const FAVORITE_SESSIONS_STORAGE_KEY = 'opencode-mobile.favorite-sessions';
// Device-local project archive markers, keyed by connection scope. An entry
// only hides a matching server catalog path; it never creates a project row.
export const HIDDEN_PROJECTS_STORAGE_KEY = 'opencode-mobile.hidden-projects';
// Retired keys. Older builds persisted the device-local opened-project list
// and last session per project here; the server catalogs are the source of
// truth now. New writes never happen; hydrate removes any stored values once.
export const PROJECTS_STORAGE_KEY = 'opencode-mobile.projects';
export const LAST_SESSION_BY_PROJECT_STORAGE_KEY = 'opencode-mobile.last-session-by-project';
// Bounded, non-secret task snapshot for the Android home widget. The widget
// handler runs headless without provider state, so the app writes this on
// confirmed provider changes and the handler renders from it. See
// features/widgets/model/widget-snapshot.ts.
export const WIDGET_SNAPSHOT_STORAGE_KEY = 'opencode-mobile.widget-snapshot';
// Per-day network usage diagnostic (requests + bytes). See
// shared/network/data-usage.ts.
export const DATA_USAGE_STORAGE_KEY = 'opencode-mobile.data-usage';

// Diagnostic file written synchronously by the global JS error handler; it
// cannot use AsyncStorage because the process may die before a write flushes.
export const LAST_JS_ERROR_FILENAME = 'opencode-mobile.last-js-error.json';
// Marks the last crash already copied into the bounded local diagnostics
// stream. It prevents re-ingesting the same last-error file on every launch.
export const LAST_JS_ERROR_INGESTED_STORAGE_KEY = 'opencode-mobile.last-js-error-ingested';

// Server-derived persisted state is always scoped by connection AND project.
// The connection scope is the password-free identity from
// shared/contracts/connection-scope.ts; project paths are server-local, so two servers
// exposing the same path must never share cache entries.
//
// Per-project session list cache. Hydrated on app open and on every project
// switch so the project chat list paints without waiting for the server;
// rewritten only from confirmed fetch results in
// runtime/workspace/use-project-refresh-actions.ts refreshSessions. See features/sessions/services/session-cache.ts.
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
