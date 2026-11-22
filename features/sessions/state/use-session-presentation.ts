import { useMemo } from 'react';

import type { ActiveSessionItem , CurrentSessionContextValue, SessionLibraryContextValue } from '@/features/sessions/model/types';
import type { SessionMessageRecord } from '@/shared/presentation/format';

import { getSessionPreviewById } from '../model/selectors';

type SessionPresentationInput = Omit<CurrentSessionContextValue, 'activeSessions' | 'activeSession'>
  & Omit<SessionLibraryContextValue, 'sessionPreviewById'>
  & {
    activeSessions: ActiveSessionItem[];
    refreshActiveSessions: () => Promise<void>;
    setActiveSessionsVisible: (visible: boolean) => void;
    messagesBySession: Record<string, SessionMessageRecord[]>;
  };

export function useSessionPresentation({
  activeSessions, refreshActiveSessions, setActiveSessionsVisible, sessions, sessionStatuses, currentSessionId,
  ensureActiveSession, openDeepLinkSession, openSession, createSession, favoriteSessions, toggleFavoriteSession,
  isFavoriteSession, clearFavoriteSession, refreshSessions, deleteSession, renameSession, forkSession,
  revertSession, unrevertSession, openSessionInProject, messagesBySession,
}: SessionPresentationInput) {
  const activeSession = useMemo(
    () => sessions.find((session) => session.id === currentSessionId),
    [currentSessionId, sessions],
  );

  const sessionPreviewById = useMemo(() => getSessionPreviewById(messagesBySession), [messagesBySession]);
  const activeSessionsValue = useMemo(
    () => ({ list: activeSessions, refresh: refreshActiveSessions, setVisible: setActiveSessionsVisible }),
    [activeSessions, refreshActiveSessions, setActiveSessionsVisible],
  );
  const currentSessionValue = useMemo(
    () => ({ activeSessions: activeSessionsValue, ensureActiveSession, openDeepLinkSession, openSession, createSession }),
    [activeSessionsValue, ensureActiveSession, openDeepLinkSession, openSession, createSession],
  );
  const sessionLibraryValue = useMemo<SessionLibraryContextValue>(
    () => ({ sessions, sessionStatuses, favoriteSessions, toggleFavoriteSession, isFavoriteSession, clearFavoriteSession, sessionPreviewById, refreshSessions, deleteSession, renameSession, forkSession, revertSession, unrevertSession, openSessionInProject }),
    [sessions, sessionStatuses, favoriteSessions, toggleFavoriteSession, isFavoriteSession, clearFavoriteSession, sessionPreviewById, refreshSessions, deleteSession, renameSession, forkSession, revertSession, unrevertSession, openSessionInProject],
  );

  return { activeSession, currentSessionValue, sessionLibraryValue };
}
