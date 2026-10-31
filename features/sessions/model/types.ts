import type { Session, SessionStatus } from '@/shared/protocol/opencode/types';

import type { SavedPermissionRule } from '@/shared/protocol/opencode/client';

import type { SessionDeepLinkTarget , FavoriteSession , ActiveSessionItem } from '@/shared/contracts/domain';

export type CurrentSessionContextValue = {
  currentSessionId?: string;
  activeSession?: Session;
  // Grouped so the connection-wide snapshot, its refresh, and the
  // library-visibility signal for polling share one context member.
  activeSessions: {
    list: ActiveSessionItem[];
    refresh: () => Promise<void>;
    setVisible: (visible: boolean) => void;
  };
  ensureActiveSession: () => Promise<string | undefined>;
  openDeepLinkSession: (target: SessionDeepLinkTarget, signal?: AbortSignal) => Promise<{ ok: boolean; error?: string }>;
  openSession: (sessionId: string) => Promise<void>;
  createSession: (title?: string) => Promise<Session>;
};

export type SessionLibraryContextValue = {
  sessions: Session[];
  sessionStatuses: Record<string, SessionStatus>;
  favoriteSessions: FavoriteSession[];
  toggleFavoriteSession: (sessionId: string, projectPath: string, title?: string) => void;
  isFavoriteSession: (sessionId: string) => boolean;
  clearFavoriteSession: (sessionId: string) => void;
  sessionPreviewById: Record<string, string>;
  refreshSessions: () => Promise<Session[]>;
  deleteSession: (sessionId: string) => Promise<void>;
  renameSession: (sessionId: string, title: string) => Promise<void>;
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
