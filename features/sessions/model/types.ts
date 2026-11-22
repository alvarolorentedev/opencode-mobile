import type { Session, SessionStatus } from '@/shared/protocol/opencode/types';

import type { SavedPermissionRule } from '@/shared/protocol/opencode/client';

export type SessionDeepLinkTarget = {
  sessionId: string;
  projectPath?: string;
  connectionScope?: string;
};

// Explicit persisted model for a pinned session. `sessionId` and `projectPath`
// are the identifiers required to reopen it; `connectionScope` says which
// server + user owns it, so identical paths or session IDs on another server
// never collide. `title` is retained because it cannot be reconstructed for
// cross-project favorites without a server call. The project label is
// derived from `projectPath` at render time and is never persisted.
export type FavoriteSession = {
  sessionId: string;
  connectionScope: string;
  projectPath: string;
  title?: string;
  favoritedAt: number;
};

export const FAVORITE_SESSIONS_MAX = 50;

// A session outside the active project, surfaced in the Chat Library "Active"
// group. `projectPath` is the server directory used to switch projects; the
// status drives the running indicator and ordering.
export type ActiveSessionItem = {
  connectionScope?: string;
  sessionId: string;
  projectPath: string;
  title?: string;
  status: SessionStatus;
  isCurrent: boolean;
  updatedAt: number;
};

export type CurrentSessionContextValue = {
  currentSessionId?: string;
  activeSession?: Session;
  ensureActiveSession: () => Promise<string | undefined>;
  openDeepLinkSession: (target: SessionDeepLinkTarget, signal?: AbortSignal) => Promise<{ ok: boolean; error?: string }>;
  openSession: (sessionId: string) => Promise<void>;
  createSession: (title?: string) => Promise<Session>;
};

export type SessionLibraryContextValue = {
  sessions: Session[];
  sessionStatuses: Record<string, SessionStatus>;
  forkSession: (sessionId: string, messageId?: string) => Promise<Session>;
  revertSession: (sessionId: string, messageId: string) => Promise<void>;
  unrevertSession: (sessionId: string) => Promise<void>;
  openSessionInProject: (projectPath: string, sessionId: string, connectionScope?: string) => Promise<void>;
};

// Server-originated approval interactions grouped so the domain surface does
// not grow one member per concern. Kept out of ChatContext so approval
// consumers do not re-render on every transcript update.
export type ApprovalsContextValue = {
  approvals: {
    mcpAuth?: { mcpName: string; url: string };
    dismissMcpAuth: () => void;
    savedPermissions: SavedPermissionRule[];
    refreshSavedPermissions: () => Promise<void>;
    removeSavedPermission: (id: string) => Promise<void>;
  };
};
